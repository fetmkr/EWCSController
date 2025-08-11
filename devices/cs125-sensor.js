// CS125 Sensor - Singleton Pattern  
// Uses singleton because there is only one physical CS125 visibility sensor on the hardware
// Multiple instances would conflict when accessing the same serial port
import { SerialPort, ReadlineParser } from 'serialport';
import config from '../config/app-config.js';
import { EventEmitter } from 'events';
import { crc16ccitt } from 'crc';

class CS125Sensor extends EventEmitter {
  constructor() {
    super();
    
    this.config = config.get('cs125');
    this.serialConfig = config.get('serialPorts');
    
    // CS125 sensor ID (can be changed if needed)
    this.sensorId = 0;
    
    this.dataPort = null;
    
    this.status = {
      isOn: false,
      hoodHeaterOn: false,
      lastUpdate: 0
    };
    
    this.data = {
      visibility: 0,
      synop: 0,
      temperature: 0,
      humidity: 0,
      lastReading: 0
    };

    // Connection status (shared from app.js)
    this.isConnected = false;

    this.isInitialized = false;
    this.retryCount = 0;
    this.maxRetries = this.config.retryAttempts || 3;
  }

  async initialize() {
    if (this.isInitialized) return;

    try {
      // Initialize serial port for CS125 data
      await this.initializeDataPort();
      
      this.isInitialized = true;
      console.log('CS125 Sensor initialized');
      
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

  // CS125 Hood Heater ON command
  async hoodHeaterOn() {
    try {
      let hoodOnBuffer = Buffer.concat([
        Buffer.from([0x02]),
        Buffer.from(`SET:${this.sensorId}:0 0 0 10000 0 0 1000 2 3442 M 1 0 5 0 1 1 0 0 1 0 7.0 80`)
      ]);
      const crc = crc16ccitt(hoodOnBuffer).toString(16);
      hoodOnBuffer = Buffer.concat([
        hoodOnBuffer,
        Buffer.from(':'),
        Buffer.from(crc),
        Buffer.from(':'),
        Buffer.from([0x03, 0x0D, 0x0A])
      ]);
      
      this.dataPort.write(hoodOnBuffer);
      this.status.hoodHeaterOn = true;
      console.log("[CS125] Hood heater turned ON");
      return true;
    } catch (error) {
      console.error('[CS125] Failed to turn on hood heater:', error);
      return false;
    }
  }

  // CS125 Hood Heater OFF command  
  async hoodHeaterOff() {
    try {
      let hoodOffBuffer = Buffer.concat([
        Buffer.from([0x02]),
        Buffer.from(`SET:${this.sensorId}:0 0 0 10000 0 0 1000 2 3442 M 1 0 5 0 1 1 0 1 1 0 7.0 80`)
      ]);
      const crc = crc16ccitt(hoodOffBuffer).toString(16);
      hoodOffBuffer = Buffer.concat([
        hoodOffBuffer,
        Buffer.from(':'),
        Buffer.from(crc),
        Buffer.from(':'),
        Buffer.from([0x03, 0x0D, 0x0A])
      ]);
      
      this.dataPort.write(hoodOffBuffer);
      this.status.hoodHeaterOn = false;
      console.log("[CS125] Hood heater turned OFF");
      return true;
    } catch (error) {
      console.error('[CS125] Failed to turn off hood heater:', error);
      return false;
    }
  }

  // CS125 Get Hood Heater Status command (also used for connection check)
  async getHoodHeaterStatus() {
    try {
      let getBuffer = Buffer.from([0x02]);
      getBuffer = Buffer.concat([getBuffer, Buffer.from(`GET:${this.sensorId}:0`)]);
      const crc = crc16ccitt(getBuffer).toString(16);
      getBuffer = Buffer.concat([
        getBuffer,
        Buffer.from(':'),
        Buffer.from(crc),
        Buffer.from(':'),
        Buffer.from([0x03, 0x0D, 0x0A])
      ]);
      
      this.dataPort.write(getBuffer);
      console.log("[CS125] GET command sent");
      
      // Wait for response with timeout
      return new Promise((resolve) => {
        let timeout = setTimeout(() => {
          console.log("[CS125] GET response timeout - no response");
          resolve(false);
        }, 5000);
        
        // Setup one-time listener for response
        const responseHandler = (line) => {
          clearTimeout(timeout);
          
          try {
            const data = line.split(" ");
            
            // Check if this is a valid GET response
            // data[0][1] should be sensor ID
            if (data[0] && data[0].length > 1 && parseInt(data[0][1]) === this.sensorId) {
              console.log("[CS125] Valid GET response received");
              
              // Parse hood heater status from data[18] (19th field)
              if (data.length > 18 && data[18] !== undefined) {
                const hoodHeaterOverride = parseInt(data[18]);
                if (hoodHeaterOverride === 0) {
                  console.log("[CS125] Hood heater is ON (auto control enabled)");
                  this.status.hoodHeaterOn = true;
                } else {
                  console.log("[CS125] Hood heater is OFF (manual override)");
                  this.status.hoodHeaterOn = false;
                }
              }
              
              resolve(true);
            } else {
              console.log("[CS125] Invalid GET response format");
              resolve(false);
            }
          } catch (err) {
            console.error("[CS125] Error parsing GET response:", err);
            resolve(false);
          }
        };
        
        // Listen for parsed line data
        this.dataPort.once('data', responseHandler);
      });
    } catch (error) {
      console.error('[CS125] GET command error:', error);
      return false;
    }
  }

  // Check CS125 connection using GET command
  async checkConnection() {
    try {
      if (!this.dataPort || !this.dataPort.isOpen) {
        return false;
      }
      
      let getBuffer = Buffer.from([0x02]);
      getBuffer = Buffer.concat([getBuffer, Buffer.from(`GET:${this.sensorId}:0`)]);
      const crc = crc16ccitt(getBuffer).toString(16);
      getBuffer = Buffer.concat([
        getBuffer,
        Buffer.from(':'),
        Buffer.from(crc),
        Buffer.from(':'),
        Buffer.from([0x03, 0x0D, 0x0A])
      ]);
      
      this.dataPort.write(getBuffer);
      
      // Wait for GET response
      return new Promise((resolve) => {
        let timeout = setTimeout(() => {
          resolve(false);
        }, 3000);
        
        const responseHandler = (line) => {
          clearTimeout(timeout);
          
          console.log('[CS125] GET response received:', line.toString('hex'), 'as string:', line.toString());
          
          const data = line.split(" ");
          // Check if data[0][0] is 0x02 (STX) and data[0][1] is sensor ID
          if (data[0] && data[0].length > 1 && 
              data[0].charCodeAt(0) === 0x02 && 
              parseInt(data[0][1]) === this.sensorId) {
            console.log('[CS125] Valid GET response - connected');
            resolve(true);
          } else {
            console.log('[CS125] Invalid GET response - disconnected');
            resolve(false);
          }
        };
        
        this.dataPort.once('data', responseHandler);
      });
    } catch (error) {
      console.error('[CS125] Connection check failed:', error);
      return false;
    }
  }

  // Connection status management
  setConnectionStatus(connected) {
    this.isConnected = connected;
    if (!connected) {
      // Reset data when disconnected
      this.data.visibility = 0;
      this.data.synop = 0;
      this.data.temperature = 0;
      this.data.humidity = 0;
    }
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
      }
    };
  }

  async close() {
    try {
      if (this.connectionCheckInterval) {
        clearInterval(this.connectionCheckInterval);
        this.connectionCheckInterval = null;
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
      connectionStatus: this.isConnected
    };
  }
}

export default CS125Sensor;