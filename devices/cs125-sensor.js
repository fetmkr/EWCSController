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
    this.getMsgSent = false;
  }

  async initialize() {
    if (this.isInitialized) return;

    try {
      // Initialize serial port for CS125 data
      await this.initializeDataPort();
      
      this.isInitialized = true;
      //console.log('CS125 Sensor initialized');
      
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

      this.parser = this.dataPort.pipe(new ReadlineParser({ delimiter: '\r\n' }));
      
      this.parser.on('data', (data) => {
        this.handleSerialData(data);
      });

      this.dataPort.on('error', (err) => {
        console.error('CS125 serial port error:', err);
        this.emit('error', err);
      });

      this.dataPort.on('open', () => {
        //console.log('CS125 data port opened');
        resolve();
      });
    });
  }


  handleSerialData(rawData) {
    try {
      const line = rawData.toString().trim();
      const data = line.split(" ");
      
      // Check first character for STX (0x02)
      let messageId;
      if (data[0] && data[0].charCodeAt(0) === 0x02) {
        // STX present - extract message ID from second character
        messageId = parseInt(data[0][1]);
      } else {
        // No STX - use first field as message ID
        messageId = parseInt(data[0]);
      }
      
      // Check if this is the normal data stream (message ID 5 - Full SYNOP)
      if (messageId === 5 && data.length >= 24) {  // 최소 24개 필드 필요 (STX 포함시 28개)
        this.data.visibility = parseInt(data[4]) || 0;
        this.data.synop = parseInt(data[23]) || 0;
        this.data.temperature = parseFloat(data[24]) || 0;
        this.data.humidity = parseFloat(data[25]) || 0;
        this.data.lastReading = Date.now();

        //console.log(`CS125 Data - Temp: ${this.data.temperature}°C, Humidity: ${this.data.humidity}%, Vis: ${this.data.visibility}m`);

        // Mark as connected when receiving valid data
        this.isConnected = true;
        
        // Emit data event
        this.emit('data', { ...this.data });
      } else if (messageId === 0 && data.length > 17) {
        // GET response (message ID 0)
        this.getMsgSent = false;
        //console.log('[CS125] GET response received:', line);
        
        // Parse hood heater status from data[17] (18th field) - 0 means heater is ON
        if (parseInt(data[17]) === 0) {
          console.log("[CS125] Hood heater is ON (auto control enabled)");
          this.status.hoodHeaterOn = true;
        } else {
          console.log("[CS125] Hood heater is OFF (manual override)");
          this.status.hoodHeaterOn = false;
        }
        
        // Mark as connected when receiving GET response
        this.isConnected = true;
        this.emit('getResponse', true);
      } else {
        // Only log as incomplete if it's not a valid message format
        if (messageId !== 5 && messageId !== 0) {
          //console.log(`[CS125] Unknown message type ${messageId}: ${line}`);
        }
        // Don't log normal data that has slightly different field count
      }
    } catch (error) {
      //console.error('CS125 data parsing error:', error);
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
      getBuffer = Buffer.concat([
        getBuffer,
        Buffer.from(':'),
        Buffer.from('2C67'),
        Buffer.from(':'),
        Buffer.from([0x03, 0x0D, 0x0A])
      ]);
      
      this.dataPort.write(getBuffer);
      this.getMsgSent = true;
      //console.log("[CS125] GET command sent");
      
      // Wait for response with timeout
      return new Promise((resolve) => {
        let timeout = setTimeout(() => {
          //console.log("[CS125] GET response timeout - no response");
          this.getMsgSent = false;
          resolve(false);
        }, 5000);
        
        // Setup one-time listener for GET response
        const responseHandler = (success) => {
          clearTimeout(timeout);
          resolve(success);
        };
        
        // Listen for GET response event
        this.once('getResponse', responseHandler);
      });
    } catch (error) {
      //console.error('[CS125] GET command error:', error);
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
      getBuffer = Buffer.concat([
        getBuffer,
        Buffer.from(':'),
        Buffer.from('2C67'),
        Buffer.from(':'),
        Buffer.from([0x03, 0x0D, 0x0A])
      ]);
      
      this.dataPort.write(getBuffer);
      
      // Wait for GET response
      return new Promise((resolve) => {
        let timeout = setTimeout(() => {
          //console.log('[CS125] GET response timeout - no valid response received');
          this.parser.removeListener('data', responseHandler);
          resolve(false);
        }, 3000);
        
        const responseHandler = (line) => {
          const lineStr = line.toString().trim();
          //console.log('[CS125] Received message while waiting for GET response:', lineStr);
          
          const data = lineStr.split(" ");
          
          // Debug: 실제 데이터 확인
          //console.log(`[CS125] Debug - data[0]: "${data[0]}", data[0].length: ${data[0].length}, data[1]: "${data[1]}"`);
          
          // Check if data[0] contains STX character at the beginning
          let messageId, sensorId;
          
          if (data[0] && data[0].length > 1 && data[0].charCodeAt(0) === 0x02) {
            // STX가 포함된 경우: data[0]의 두 번째 문자가 메시지 ID
            messageId = parseInt(data[0][1]);
            sensorId = data.length > 1 ? parseInt(data[1]) : -1;
            //console.log(`[CS125] STX detected - Message ID: ${messageId}, Sensor ID: ${sensorId}`);
          } else {
            // STX가 없는 경우: data[0]이 메시지 ID
            messageId = parseInt(data[0]);
            sensorId = data.length > 1 ? parseInt(data[1]) : -1;
            //console.log(`[CS125] No STX - Message ID: ${messageId}, Sensor ID: ${sensorId}`);
          }
          
          if (messageId === 0 && sensorId === this.sensorId) {
            //console.log('[CS125] Valid GET response - connected');
            clearTimeout(timeout);
            this.parser.removeListener('data', responseHandler);
            resolve(true);
          } else if (messageId === 5) {
            // Message ID 5 is normal data stream, not GET response - ignore and keep waiting
            //console.log('[CS125] Ignoring data stream (ID 5), still waiting for GET response (ID 0)...');
            // Keep listening, don't resolve
          } else if (messageId === 0) {
            // Message ID is 0 but something else is wrong
            //console.log(`[CS125] GET response with wrong sensor ID - got: ${sensorId}, expected: ${this.sensorId}`);
            // Keep listening, might be for different sensor
          } else {
            //console.log(`[CS125] Unexpected message - ID: ${messageId}, sensor ID: ${sensorId}`);
            // Keep listening for a bit more, in case the real GET response comes later
          }
        };
        
        this.parser.on('data', responseHandler);
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

  // Connection monitoring removed - app.js handles connection checking every 60s


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
