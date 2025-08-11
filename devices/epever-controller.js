// EPEVER Solar Charge Controller Module - Singleton Pattern
// Tested with EPEVER Tracer2606BP model
// Uses singleton because there is only one physical EPEVER solar charge controller on the hardware
// Multiple instances would conflict when accessing the same serial port
// This module communicates with EPEVER Tracer series controllers via Modbus RTU protocol

import { SerialPort } from 'serialport';
import { crc16modbus } from 'crc';
import config from '../config/app-config.js';
import { EventEmitter } from 'events';

class EPEVERController extends EventEmitter {
  constructor() {
    super();
    
    this.config = config.get('bms');
    this.serialConfig = config.get('serialPorts');
    
    this.port = null;
    this.isInitialized = false;
    
    // Solar charger/battery data - 원래 battery.js와 동일
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
      console.log('EPEVER Controller initialized');
      
      // 폴링 제거 - 온디맨드 방식으로 변경
      
    } catch (error) {
      console.error('EPEVER Controller initialization failed:', error);
      throw error;
    }
  }

  async initializeSerialPort() {
    return new Promise((resolve, reject) => {
      const portPath = this.serialConfig.bms || '/dev/ttyACM0';
      
      // 원래 battery.js와 동일한 설정
      this.port = new SerialPort({
        path: portPath,
        baudRate: 115200,
        lock: false  // 원래 battery.js의 중요한 설정
      }, (err) => {
        if (err) {
          console.error('EPEVER serial port error:', err);
          reject(err);
          return;
        }
      });

      this.port.on('error', (err) => {
        console.error('EPEVER serial port error:', err);
        this.status.connected = false;
        this.status.errorCount++;
        this.emit('error', err);
      });

      this.port.on('open', () => {
        console.log('EPEVER serial port opened:', portPath);
        this.status.connected = true;
        this.status.errorCount = 0;
        resolve();
      });

      this.port.on('close', () => {
        console.log('EPEVER serial port closed');
        this.status.connected = false;
      });
    });
  }

  // 폴링 함수 제거 - 온디맨드 방식으로 변경

  // 안전한 버퍼 읽기 헬퍼 함수
  safeReadUInt16BE(buffer, offset, defaultValue = 0) {
    try {
      if (!buffer || buffer.length < offset + 2) {
        console.warn(`[EPEVER] Buffer too small (${buffer?.length || 0} bytes) for offset ${offset}, using default value ${defaultValue}`);
        return defaultValue;
      }
      return buffer.readUInt16BE(offset);
    } catch (error) {
      console.warn(`[EPEVER] Error reading buffer at offset ${offset}:`, error.message, ', using default value', defaultValue);
      return defaultValue;
    }
  }

  // 원래 battery.js의 getSolarBettery 함수를 그대로 복사
  async getSolarBattery(id) {
    
    // PV Real Time Data
    // PV array data
    // 0x3100 부터 4개 데이터들 한번에 받기
    const PVArrayData = Buffer.from([id, 0x04, 0x31, 0x00, 0x00, 0x04])

    // Load data
    // 0x310C 부터 4개 데이터 한번에 받기
    const PVLoadData = Buffer.from([id, 0x04, 0x31, 0x0C, 0x00, 0x04])

    // Temp data
    // 0x3110 부터 2개 데이터 한번에 받기
    const PVTempData = Buffer.from([id, 0x04, 0x31, 0x10, 0x00, 0x02])

    // Battery SOC
    // 0x311A 부터 1개 데이터 한번에 받기
    const PVBatSOC = Buffer.from([id, 0x04, 0x31, 0x1A, 0x00, 0x01])  

    // Battery real reated voltage
    // 0x311D 부터 1개 데이터 한번에 받기
    const PVBatRated = Buffer.from([id, 0x04, 0x31, 0x1D, 0x00, 0x01])

    // Status
    // 0x3200 부터 3개 데이터 한번에 받기
    const PVStatusData = Buffer.from([id, 0x04, 0x32, 0x00, 0x00, 0x03]) 

    
    // Consumption
    // 0x3302 부터 18개 데이터들 한번에 받기
    const PVConData = Buffer.from([id, 0x04, 0x33, 0x02, 0x00, 0x12])

    // Real time
    // 0x331A 부터 3개 데이터 한번에 받기
    const PVBatRealTime = Buffer.from([id, 0x04, 0x33, 0x1A, 0x00, 0x03]) 

    const response1 = await this.writeAndRead(this.addCRC(PVArrayData))
    const data1 = response1.slice(3,-2)
    console.log(`[EPEVER] PVArrayData response length: ${response1?.length || 0}, data length: ${data1?.length || 0}`);
    this.data.PVVol = this.safeReadUInt16BE(data1, 0) / 100
    this.data.PVCur = this.safeReadUInt16BE(data1, 2) / 100
    this.data.PVPower = (this.safeReadUInt16BE(data1, 4) | (this.safeReadUInt16BE(data1, 6)<<16) )/100
    await this.delay(100)

    const response2 = await this.writeAndRead(this.addCRC(PVLoadData))
    const data2 = response2.slice(3,-2)
    this.data.LoadVol = this.safeReadUInt16BE(data2, 0) / 100
    this.data.LoadCur = this.safeReadUInt16BE(data2, 2) / 100
    this.data.LoadPower = (this.safeReadUInt16BE(data2, 4) | (this.safeReadUInt16BE(data2, 6)<<16) )/100
    await this.delay(100)

    const response3 = await this.writeAndRead(this.addCRC(PVTempData))
    const data3 = response3.slice(3,-2)
    this.data.BatTemp = this.safeReadUInt16BE(data3, 0) / 100
    this.data.DevTemp = this.safeReadUInt16BE(data3, 2) / 100

    await this.delay(100)

    const response4 = await this.writeAndRead(this.addCRC(PVBatSOC))
    const data4 = response4.slice(3,-2)
    this.data.BatSOC = this.safeReadUInt16BE(data4, 0)
    await this.delay(100)

    const response5 = await this.writeAndRead(this.addCRC(PVBatRated))
    const data5 = response5.slice(3,-2)
    this.data.BatRatedVol = this.safeReadUInt16BE(data5, 0) / 100

    await this.delay(100)

    const response6 = await this.writeAndRead(this.addCRC(PVStatusData))
    const data6 = response6.slice(3,-2)
    this.data.BatStat = this.safeReadUInt16BE(data6, 0)
    this.data.ChargEquipStat = this.safeReadUInt16BE(data6, 2)
    this.data.DischgEquipStat = this.safeReadUInt16BE(data6, 4)

    await this.delay(100)

    const response7 = await this.writeAndRead(this.addCRC(PVConData))
    const data7 = response7.slice(3,-2)
    this.data.BatMaxVolToday = this.safeReadUInt16BE(data7, 0) / 100
    this.data.BatMinVolToday = this.safeReadUInt16BE(data7, 2) / 100
    this.data.ConEnergyToday = (this.safeReadUInt16BE(data7, 4) | (this.safeReadUInt16BE(data7, 6)<<16) )/100
    this.data.ConEnergyMonth = (this.safeReadUInt16BE(data7, 8) | (this.safeReadUInt16BE(data7, 10)<<16) )/100
    this.data.ConEnergyYear = (this.safeReadUInt16BE(data7, 12) | (this.safeReadUInt16BE(data7, 14)<<16) )/100
    this.data.ConEnergyTotal = (this.safeReadUInt16BE(data7, 16) | (this.safeReadUInt16BE(data7, 18)<<16) )/100
    this.data.GenEnergyToday = (this.safeReadUInt16BE(data7, 20) | (this.safeReadUInt16BE(data7, 22)<<16) )/100
    this.data.GenEnergyMonth = (this.safeReadUInt16BE(data7, 24) | (this.safeReadUInt16BE(data7, 26)<<16) )/100
    this.data.GenEnergyYear = (this.safeReadUInt16BE(data7, 28) | (this.safeReadUInt16BE(data7, 30)<<16) )/100
    this.data.GenEnergyTotal = (this.safeReadUInt16BE(data7, 32) | (this.safeReadUInt16BE(data7, 34)<<16) )/100    
    await this.delay(100)

    const response8 = await this.writeAndRead(this.addCRC(PVBatRealTime))
    const data8 = response8.slice(3,-2)
    this.data.BatVol = this.safeReadUInt16BE(data8, 0) / 100
    this.data.BatCur = (this.safeReadUInt16BE(data8, 2) | (this.safeReadUInt16BE(data8, 4)<<16) )/100

    await this.delay(100)

    this.data.lastUpdate = Date.now()
    
    // Track active devices
    if (!this.status.activeDevices.includes(id)) {
      this.status.activeDevices.push(id);
    }

    // console.log(`EPEVER data updated from device ${id.toString(16)}: SOC=${this.data.BatSOC}%, Bat=${this.data.BatVol}V, PV=${this.data.PVVol}V/${this.data.PVCur}A, Load=${this.data.LoadVol}V/${this.data.LoadCur}A`);
    // console.log(`EPEVER Energy: GenToday=${this.data.GenEnergyToday}Wh, ConToday=${this.data.ConEnergyToday}Wh, Total=${this.data.GenEnergyTotal}Wh`);
    
    // Emit data event
    this.emit('data', { 
      deviceId: id, 
      data: { ...this.data },
      timestamp: this.data.lastUpdate 
    });
  }

  // 원래 battery.js의 addCRC 함수
  addCRC(buf) {
    let crc16modBuff = Buffer.allocUnsafe(2)
    crc16modBuff.writeUInt16LE(Number(crc16modbus(buf)))
    
    buf = Buffer.concat([buf,Buffer.from([crc16modBuff[0],crc16modBuff[1]])])
    return buf
  }

  // 100ms 대기 함수
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 원래 battery.js의 writeAndRead 함수
  async writeAndRead(dataToSend) {
    return new Promise((resolve, reject) => {
      let buffer = Buffer.alloc(0);

      // 데이터를 쓴 후 응답을 기다림
      this.port.write(dataToSend, (err) => {
        if (err) {
          return reject(err);
        }

        // 데이터가 들어오면 호출되는 이벤트
        const onData = (data) => {
          buffer = Buffer.concat([buffer, data]);

          // 3번째 바이트가 도착했는지 확인
          if (buffer.length >= 3) {
            const lengthByte = buffer[2]; // 3번째 바이트 값
            const totalPacketLength = 3 + lengthByte + 2; // 3바이트(헤더) + 데이터 길이 + 2바이트(CRC)

            // 필요한 패킷의 전체 길이가 도착했는지 확인
            if (buffer.length >= totalPacketLength) {
              this.port.removeListener('data', onData); // 데이터 수신 이벤트 리스너 제거
              const packet = buffer.slice(0, totalPacketLength); // 패킷 추출
              resolve(packet); // 패킷 처리 완료
            }
          }
        };

        // 데이터를 수신할 때마다 이벤트 발생
        this.port.on('data', onData);
      });
    });
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
            if (err) console.error('EPEVER port close error:', err);
            resolve();
          });
        });
      }

      this.isInitialized = false;
      this.status.connected = false;
      console.log('EPEVER Controller closed');
      
    } catch (error) {
      console.error('EPEVER close error:', error);
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

  // EWCS 패턴에 맞는 getData 함수 (온디맨드 데이터 수집)
  async getData() {
    return new Promise((resolve) => {
      // 10초 타임아웃 설정
      const timeout = setTimeout(() => {
        console.warn('[EPEVER] getData timed out after 10 seconds');
        this.status.connected = false;
        // 타임아웃 시 데이터를 저장하지 않음 (lastUpdate: 0)
        resolve({
          ...this.data,
          lastUpdate: 0
        });
      }, 10000);

      const executeGetData = async () => {
        try {
          if (!this.status.connected) {
            clearTimeout(timeout);
            console.log('[EPEVER] Not connected - skipping data collection');
            return resolve({
              ...this.data,
              lastUpdate: 0
            });
          }

          // 실시간으로 EPEVER 데이터 수집
          await this.getSolarBattery(0x0B);
          
          clearTimeout(timeout);
          resolve({
            ...this.data,
            lastUpdate: this.data.lastUpdate
          });
          
        } catch (error) {
          clearTimeout(timeout);
          console.warn('[EPEVER] getData failed:', error.message);
          
          // 연결 실패 시 상태 업데이트
          this.status.connected = false;
          this.status.errorCount++;
          
          // 실패 시 데이터를 저장하지 않음 (lastUpdate: 0)
          resolve({
            ...this.data,
            lastUpdate: 0
          });
        }
      };

      executeGetData();
    });
  }

  // Manual device poll for testing
  async pollDevice(deviceId) {
    if (typeof deviceId === 'string') {
      deviceId = parseInt(deviceId, 16);
    }
    
    return await this.getSolarBattery(deviceId);
  }

  // 배터리 전압만 읽어오는 함수
  async getBatteryVoltage() {
    try {
      if (!this.port || !this.port.isOpen) {
        throw new Error('Serial port not open');
      }

      const deviceId = 0x01;  // 기본 device ID
      
      // Battery voltage only
      // 0x331A 주소에서 1개 데이터만 읽기
      const PVBatVoltage = Buffer.from([deviceId, 0x04, 0x33, 0x1A, 0x00, 0x01]);
      
      const response = await this.writeAndRead(this.addCRC(PVBatVoltage));
      const data = response.slice(3, -2);
      
      const batteryVoltage = data.readUInt16BE(0) / 100;
      
      return {
        voltage: batteryVoltage,
        timestamp: Date.now()
      };
      
    } catch (error) {
      console.error('[EPEVER] Error reading battery voltage:', error.message);
      throw error;
    }
  }

  // EPEVER 연결 상태 확인 함수
  async checkConnection() {
    try {
      if (!this.port || !this.port.isOpen) {
        return false;
      }

      const deviceId = this.deviceIds[0];  // 첫 번째 device ID 사용 (0x0B)
      
      // Battery voltage 읽기로 연결 테스트
      // 0x331A 주소에서 1개 데이터만 읽기
      const PVBatVoltage = Buffer.from([deviceId, 0x04, 0x33, 0x1A, 0x00, 0x01]);
      
      const response = await this.writeAndRead(this.addCRC(PVBatVoltage));
      
      console.log('[EPEVER] checkConnection response:', response ? response.toString('hex') : 'null', 'length:', response ? response.length : 0);
      
      // Modbus 응답 검증: 첫 바이트는 deviceId, 두 번째는 0x04 (function code)
      if (response && response.length > 2 && response[0] === deviceId && response[1] === 0x04) {
        console.log('[EPEVER] Valid Modbus response - connected');
        return true;
      }
      
      console.log('[EPEVER] Invalid Modbus response - disconnected');
      return false;
      
    } catch (error) {
      console.error('[EPEVER] Connection check failed:', error.message);
      return false;
    }
  }
}

// Export function to maintain compatibility with existing code
export function solarChargerDataNow() {
  return epeverController.getData();
}

// Singleton instance
const epeverController = new EPEVERController();

export default epeverController;