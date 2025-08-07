import { SerialPort, ReadlineParser } from 'serialport';
import adc from 'mcp-spi-adc';
import config from '../config/app-config.js';
import { EventEmitter } from 'events';

class CS125Sensor extends EventEmitter {
  constructor(controlPort = null) {
    super();
    
    this.config = config.get('cs125');
    this.adcConfig = config.get('adc');
    this.serialConfig = config.get('serialPorts');
    
    this.controlPort = controlPort; // PIC24 control port
    this.dataPort = null;
    this.currentADC = null;
    
    this.status = {
      isOn: false,
      hoodHeaterOn: false,
      lastUpdate: 0
    };
    
    this.data = {
      current: 0,
      visibility: 0,
      synop: 0,
      temperature: 0,
      humidity: 0,
      lastReading: 0
    };

    this.isInitialized = false;
    this.retryCount = 0;
    this.maxRetries = this.config.retryAttempts || 3;
  }

  async initialize() {
    if (this.isInitialized) return;

    try {
      // Initialize serial port for CS125 data
      await this.initializeDataPort();
      
      // Initialize ADC for current measurement
      await this.initializeCurrentADC();
      
      this.isInitialized = true;
      console.log('CS125 Sensor initialized');
      
      // Start periodic current readings
      this.startCurrentMonitoring();
      
      // Start connection monitoring
      this.startConnectionMonitoring();
      
    } catch (error) {
      console.error('CS125 Sensor initialization failed:', error);
      throw error;
    }
  }

  async initializeDataPort() {
    return new Promise((resolve, reject) => {
      this.dataPort = new SerialPort({
        path: this.serialConfig.cs125,
        baudRate: this.config.baudRate || 9600
      }, (err) => {
        if (err) {
          console.error('CS125 serial port error:', err);
          reject(err);
          return;
        }
      });

      const parser = this.dataPort.pipe(new ReadlineParser({ delimiter: '\r\n' }));
      
      parser.on('data', (data) => {
        this.handleSerialData(data);
      });

      this.dataPort.on('error', (err) => {
        console.error('CS125 serial port error:', err);
        this.emit('error', err);
      });

      this.dataPort.on('open', () => {
        console.log('CS125 data port opened');
        resolve();
      });
    });
  }

  async initializeCurrentADC() {
    return new Promise((resolve, reject) => {
      this.currentADC = adc.open(this.adcConfig.channel, 
        { speedHz: this.adcConfig.speedHz || 1000000 }, 
        (err) => {
          if (err) {
            console.error('CS125 ADC initialization error:', err);
            reject(err);
            return;
          }
          resolve();
        });
    });
  }

  handleSerialData(rawData) {
    try {
      const data = rawData.toString().trim().split(',');
      
      if (data.length >= 26) { // CS125 full SYNOP message
        this.data.visibility = parseInt(data[4]) || 0;
        this.data.synop = parseInt(data[23]) || 0;
        this.data.temperature = parseFloat(data[24]) || 0;
        this.data.humidity = parseFloat(data[25]) || 0;
        this.data.lastReading = Date.now();

        console.log(`CS125 Data - Temp: ${this.data.temperature}°C, Humidity: ${this.data.humidity}%, Vis: ${this.data.visibility}m`);

        // Check hood heater status based on temperature
        this.updateHoodHeaterStatus();

        // Emit data event
        this.emit('data', { ...this.data });
      } else {
        // CS125가 연결되어 있지 않거나 잘못된 데이터
        console.log(`[CS125] Received incomplete data: ${rawData.toString().trim()}`);
      }
    } catch (error) {
      console.error('CS125 data parsing error:', error);
      this.emit('error', error);
    }
  }

  updateHoodHeaterStatus() {
    // Hood heater logic based on temperature
    if (this.data.temperature < -10) { // Below -10°C
      if (!this.status.hoodHeaterOn) {
        console.log("CS125 hood heater is ON");
        this.status.hoodHeaterOn = true;
      }
    } else { // Above -10°C  
      if (this.status.hoodHeaterOn) {
        console.log("CS125 hood heater is OFF");
        this.status.hoodHeaterOn = false;
      }
    }
  }

  startCurrentMonitoring() {
    if (!this.currentADC) return;

    const readCurrent = () => {
      this.currentADC.read((err, reading) => {
        if (err) {
          console.error('CS125 current ADC read error:', err);
          return;
        }

        // Convert ADC reading to current (mA)
        const voltage = (reading.rawValue * this.adcConfig.vref) / this.adcConfig.resolution;
        this.data.current = parseFloat((voltage * this.adcConfig.conversionFactor).toFixed(3));
        console.log(`CS125: Current=${this.data.current}mA, Raw=${reading.rawValue}`);
      });
    };

    // Read current every 5 seconds
    this.currentInterval = setInterval(readCurrent, 5000);
    
    // Initial reading
    readCurrent();
  }

  startConnectionMonitoring() {
    // Check for data timeout every 30 seconds
    this.connectionCheckInterval = setInterval(() => {
      const now = Date.now();
      const dataAge = now - this.data.lastReading;
      const maxAge = 30000; // 30 seconds
      
      if (dataAge > maxAge) {
        console.warn(`[CS125] No data received for ${Math.round(dataAge/1000)}s - connection may be lost`);
        this.status.connected = false;
      } else {
        if (!this.status.connected) {
          console.log(`[CS125] Connection restored`);
        }
        this.status.connected = true;
      }
    }, 30000);
  }

  async turnOn() {
    if (!this.controlPort) {
      throw new Error('Control port not available for CS125');
    }

    try {
      this.controlPort.write('C'); // Send command to PIC24
      this.status.isOn = true;
      console.log('CS125 sensor turned ON');
      
      this.emit('statusChange', { device: 'cs125', status: 'on' });
      
      return { success: true };
    } catch (error) {
      console.error('Failed to turn on CS125:', error);
      throw error;
    }
  }

  async turnOff() {
    if (!this.controlPort) {
      throw new Error('Control port not available for CS125');
    }

    try {
      this.controlPort.write('c'); // Send lowercase command to PIC24
      this.status.isOn = false;
      console.log('CS125 sensor turned OFF');
      
      this.emit('statusChange', { device: 'cs125', status: 'off' });
      
      return { success: true };
    } catch (error) {
      console.error('Failed to turn off CS125:', error);
      throw error;
    }
  }

  async setHoodHeater(enable) {
    if (!this.controlPort) {
      throw new Error('Control port not available for CS125 hood heater');
    }

    try {
      const command = enable ? 'H' : 'h';
      this.controlPort.write(command);
      this.status.hoodHeaterOn = enable;
      
      console.log(`CS125 hood heater turned ${enable ? 'ON' : 'OFF'}`);
      
      this.emit('statusChange', { 
        device: 'cs125_hood_heater', 
        status: enable ? 'on' : 'off' 
      });
      
      return { success: true };
    } catch (error) {
      console.error('Failed to control CS125 hood heater:', error);
      throw error;
    }
  }

  getStatus() {
    return {
      ...this.status,
      lastUpdate: Date.now()
    };
  }

  getData() {
    return { ...this.data };
  }

  getFullStatus() {
    return {
      status: this.getStatus(),
      data: this.getData(),
      isInitialized: this.isInitialized,
      serialPort: {
        connected: this.dataPort?.isOpen || false,
        path: this.serialConfig.cs125
      },
      adc: {
        initialized: this.currentADC !== null
      }
    };
  }

  async close() {
    try {
      if (this.currentInterval) {
        clearInterval(this.currentInterval);
        this.currentInterval = null;
      }

      if (this.connectionCheckInterval) {
        clearInterval(this.connectionCheckInterval);
        this.connectionCheckInterval = null;
      }

      if (this.currentADC) {
        // ADC cleanup if needed
        this.currentADC = null;
      }

      if (this.dataPort && this.dataPort.isOpen) {
        await new Promise((resolve) => {
          this.dataPort.close((err) => {
            if (err) console.error('CS125 port close error:', err);
            resolve();
          });
        });
      }

      this.isInitialized = false;
      console.log('CS125 sensor closed');
      
    } catch (error) {
      console.error('CS125 close error:', error);
      throw error;
    }
  }

  // Health check method
  isHealthy() {
    const now = Date.now();
    const dataAge = now - this.data.lastReading;
    const maxAge = (this.config.timeout || 5000) * 2; // Allow double timeout
    
    return {
      healthy: dataAge < maxAge && this.isInitialized,
      lastData: this.data.lastReading,
      dataAge: dataAge,
      serialConnected: this.dataPort?.isOpen || false,
      adcInitialized: this.currentADC !== null
    };
  }
}

export default CS125Sensor;