import { SerialPort } from 'serialport';
import modbus from 'modbus-serial';
import { crc16modbus } from 'crc';
import config from '../config/app-config.js';
import { EventEmitter } from 'events';

class BMSController extends EventEmitter {
  constructor() {
    super();
    
    this.config = config.get('bms');
    this.serialConfig = config.get('serialPorts');
    
    this.port = null;
    this.isInitialized = false;
    
    // Solar charger/battery data
    this.data = {
      PVVol: 0,
      PVCur: 0,
      PVPower: 0,
      LoadVol: 0,
      LoadCur: 0,
      LoadPower: 0,
      BatTemp: 0,
      DevTemp: 0,
      BatSOC: 0,
      BatRatedVol: 0,
      BatStat: 0,
      ChargEquipStat: 0,
      DischgEquipStat: 0,
      BatMaxVolToday: 0,
      BatMinVolToday: 0,
      ConEnergyToday: 0,
      ConEnergyMonth: 0,
      ConEnergyYear: 0,
      ConEnergyTotal: 0,
      GenEnergyToday: 0,
      GenEnergyMonth: 0,
      GenEnergyYear: 0,
      GenEnergyTotal: 0,
      BatVol: 0,
      BatCur: 0,
      lastUpdate: 0
    };

    // Device status
    this.status = {
      connected: false,
      lastPoll: 0,
      errorCount: 0,
      activeDevices: []
    };

    // Solar charger device IDs (0x0B, 0x0C, 0x0D, 0x0E)
    this.deviceIds = this.config.deviceIds || [0x0B, 0x0C, 0x0D, 0x0E];
    this.currentDeviceIndex = 0;
    this.pollInterval = null;
  }

  async initialize() {
    if (this.isInitialized) return;

    try {
      await this.initializeSerialPort();
      this.isInitialized = true;
      console.log('BMS Controller initialized');
      
      // Start periodic polling
      this.startPolling();
      
    } catch (error) {
      console.error('BMS Controller initialization failed:', error);
      throw error;
    }
  }

  async initializeSerialPort() {
    return new Promise((resolve, reject) => {
      // Use ttyAMA5 for BMS communication, fallback to ttyACM0 if configured
      const portPath = this.serialConfig.bms || '/dev/ttyACM0';
      
      this.port = new SerialPort({
        path: portPath,
        baudRate: this.config.baudRate || 115200,
        lock: false // Prevent lock issues
      }, (err) => {
        if (err) {
          console.error('BMS serial port error:', err);
          reject(err);
          return;
        }
      });

      this.port.on('error', (err) => {
        console.error('BMS serial port error:', err);
        this.status.connected = false;
        this.status.errorCount++;
        this.emit('error', err);
      });

      this.port.on('open', () => {
        console.log('BMS serial port opened:', portPath);
        this.status.connected = true;
        this.status.errorCount = 0;
        resolve();
      });

      this.port.on('close', () => {
        console.log('BMS serial port closed');
        this.status.connected = false;
      });
    });
  }

  startPolling() {
    // Poll each device every 10 seconds (2.5 seconds per device for 4 devices)
    this.pollInterval = setInterval(() => {
      this.pollNextDevice();
    }, 2500);
    
    // Initial poll
    this.pollNextDevice();
  }

  async pollNextDevice() {
    if (!this.status.connected) return;

    try {
      const deviceId = this.deviceIds[this.currentDeviceIndex];
      await this.getSolarBatteryData(deviceId);
      
      // Move to next device
      this.currentDeviceIndex = (this.currentDeviceIndex + 1) % this.deviceIds.length;
      this.status.lastPoll = Date.now();
      
    } catch (error) {
      console.error('BMS polling error:', error);
      this.status.errorCount++;
      this.emit('pollError', error);
    }
  }

  async getSolarBatteryData(deviceId) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`BMS timeout for device ${deviceId.toString(16)}`));
      }, this.config.timeout || 3000);

      try {
        // Create Modbus RTU request for solar charger data
        // Register addresses based on solar charger protocol
        const request = this.createModbusRequest(deviceId, 0x0100, 32); // Read 32 registers from 0x0100
        
        this.port.write(request, (writeErr) => {
          if (writeErr) {
            clearTimeout(timeout);
            reject(writeErr);
            return;
          }
        });

        // Handle response
        let responseBuffer = Buffer.alloc(0);
        
        const dataHandler = (data) => {
          responseBuffer = Buffer.concat([responseBuffer, data]);
          
          // Check if we have a complete response (minimum 5 bytes for error, more for data)
          if (responseBuffer.length >= 5) {
            this.port.removeListener('data', dataHandler);
            clearTimeout(timeout);
            
            try {
              this.parseModbusResponse(responseBuffer, deviceId);
              resolve();
            } catch (parseError) {
              reject(parseError);
            }
          }
        };

        this.port.on('data', dataHandler);

      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  createModbusRequest(deviceId, startAddr, quantity) {
    const request = Buffer.alloc(8);
    request[0] = deviceId;        // Device ID
    request[1] = 0x03;           // Function code: Read Holding Registers
    request[2] = (startAddr >> 8) & 0xFF;  // Start address high byte
    request[3] = startAddr & 0xFF;         // Start address low byte
    request[4] = (quantity >> 8) & 0xFF;   // Quantity high byte
    request[5] = quantity & 0xFF;          // Quantity low byte
    
    // Calculate CRC
    const crc = crc16modbus(request.slice(0, 6));
    request[6] = crc & 0xFF;       // CRC low byte
    request[7] = (crc >> 8) & 0xFF; // CRC high byte
    
    return request;
  }

  parseModbusResponse(buffer, deviceId) {
    if (buffer.length < 5) {
      throw new Error('Response too short');
    }

    const responseDeviceId = buffer[0];
    const functionCode = buffer[1];
    
    if (responseDeviceId !== deviceId) {
      throw new Error(`Device ID mismatch: expected ${deviceId}, got ${responseDeviceId}`);
    }

    if (functionCode & 0x80) { // Error response
      const errorCode = buffer[2];
      throw new Error(`Modbus error from device ${deviceId.toString(16)}: ${errorCode}`);
    }

    if (functionCode !== 0x03) {
      throw new Error(`Unexpected function code: ${functionCode}`);
    }

    const dataLength = buffer[2];
    if (buffer.length < dataLength + 5) {
      throw new Error('Incomplete response');
    }

    // Verify CRC
    const receivedCrc = buffer[buffer.length - 2] | (buffer[buffer.length - 1] << 8);
    const calculatedCrc = crc16modbus(buffer.slice(0, -2));
    
    if (receivedCrc !== calculatedCrc) {
      throw new Error('CRC mismatch');
    }

    // Parse data registers (16-bit values, big-endian)
    const data = buffer.slice(3, 3 + dataLength);
    this.updateSolarChargerData(data, deviceId);
  }

  updateSolarChargerData(data, deviceId) {
    try {
      // Parse 16-bit registers (assuming typical solar charger register map)
      const registers = [];
      for (let i = 0; i < data.length; i += 2) {
        registers.push((data[i] << 8) | data[i + 1]);
      }

      // Update data based on typical solar charger register mapping
      // These mappings may need adjustment based on actual device documentation
      if (registers.length >= 16) {
        this.data.PVVol = registers[0] / 100.0;        // PV Voltage (0.01V)
        this.data.PVCur = registers[1] / 100.0;        // PV Current (0.01A) 
        this.data.PVPower = registers[2];              // PV Power (W)
        this.data.LoadVol = registers[3] / 100.0;      // Load Voltage (0.01V)
        this.data.LoadCur = registers[4] / 100.0;      // Load Current (0.01A)
        this.data.LoadPower = registers[5];            // Load Power (W)
        this.data.BatTemp = registers[6] - 2731;       // Battery Temperature (0.01°C)
        this.data.DevTemp = registers[7] - 2731;       // Device Temperature (0.01°C)
        this.data.BatSOC = registers[8];               // Battery SOC (%)
        this.data.BatVol = registers[9] / 100.0;       // Battery Voltage (0.01V)
        this.data.BatCur = registers[10] / 100.0;      // Battery Current (0.01A)
        this.data.ChargEquipStat = registers[11];      // Charging Equipment Status
        this.data.DischgEquipStat = registers[12];     // Discharging Equipment Status
        this.data.BatStat = registers[13];             // Battery Status
      }

      this.data.lastUpdate = Date.now();
      
      // Track active devices
      if (!this.status.activeDevices.includes(deviceId)) {
        this.status.activeDevices.push(deviceId);
      }

      console.log(`BMS data updated from device ${deviceId.toString(16)}: SOC=${this.data.BatSOC}%, Bat=${this.data.BatVol}V`);
      
      // Emit data event
      this.emit('data', { 
        deviceId, 
        data: { ...this.data },
        timestamp: this.data.lastUpdate 
      });

    } catch (error) {
      console.error('Solar charger data parsing error:', error);
      throw error;
    }
  }

  getData() {
    return { ...this.data };
  }

  getStatus() {
    return {
      ...this.status,
      isInitialized: this.isInitialized,
      lastUpdate: Date.now()
    };
  }

  getFullStatus() {
    return {
      status: this.getStatus(),
      data: this.getData(),
      devices: {
        configured: this.deviceIds.map(id => id.toString(16)),
        active: this.status.activeDevices.map(id => id.toString(16))
      },
      serialPort: {
        connected: this.status.connected,
        path: this.serialConfig.bms || '/dev/ttyACM0'
      }
    };
  }

  async close() {
    try {
      if (this.pollInterval) {
        clearInterval(this.pollInterval);
        this.pollInterval = null;
      }

      if (this.port && this.port.isOpen) {
        await new Promise((resolve) => {
          this.port.close((err) => {
            if (err) console.error('BMS port close error:', err);
            resolve();
          });
        });
      }

      this.isInitialized = false;
      this.status.connected = false;
      console.log('BMS Controller closed');
      
    } catch (error) {
      console.error('BMS close error:', error);
      throw error;
    }
  }

  // Health check method
  isHealthy() {
    const now = Date.now();
    const dataAge = now - this.data.lastUpdate;
    const maxAge = 30000; // 30 seconds max data age
    
    return {
      healthy: this.isInitialized && 
               this.status.connected && 
               dataAge < maxAge && 
               this.status.errorCount < 5,
      dataAge: dataAge,
      errorCount: this.status.errorCount,
      activeDevices: this.status.activeDevices.length,
      lastPoll: this.status.lastPoll
    };
  }

  // Manual device poll for testing
  async pollDevice(deviceId) {
    if (typeof deviceId === 'string') {
      deviceId = parseInt(deviceId, 16);
    }
    
    return await this.getSolarBatteryData(deviceId);
  }
}

// Export function to maintain compatibility with existing code
export function solarChargerDataNow() {
  // This function can be called by existing code
  // Returns current data from the singleton instance
  return bmsController.getData();
}

// Singleton instance
const bmsController = new BMSController();

export default bmsController;
export { BMSController };