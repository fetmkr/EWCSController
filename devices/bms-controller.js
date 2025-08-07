import { SerialPort } from 'serialport';
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
      console.log('BMS Controller initialized');
      
      // Start periodic polling - 원래 battery.js처럼 5초마다
      this.startPolling();
      
    } catch (error) {
      console.error('BMS Controller initialization failed:', error);
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
    // 원래 battery.js처럼 5초마다 실행
    this.pollInterval = setInterval(() => {
      this.testEPEVER();
    }, 5000);
  }

  async testEPEVER() {
    if (!this.status.connected) return;

    try {
      await this.getSolarBattery(0x0B);
      this.status.lastPoll = Date.now();
    } catch (error) {
      console.error('BMS polling error:', error);
      this.status.errorCount++;
      this.emit('pollError', error);
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
    this.data.PVVol = data1.readUInt16BE(0) / 100
    this.data.PVCur = data1.readUInt16BE(2) / 100
    this.data.PVPower = (data1.readUInt16BE(4) | (data1.readUInt16BE(6)<<16) )/100
    await this.delay(100)

    const response2 = await this.writeAndRead(this.addCRC(PVLoadData))
    const data2 = response2.slice(3,-2)
    this.data.LoadVol = data2.readUInt16BE(0) / 100
    this.data.LoadCur = data2.readUInt16BE(2) / 100
    this.data.LoadPower = (data2.readUInt16BE(4) | (data2.readUInt16BE(6)<<16) )/100
    await this.delay(100)

    const response3 = await this.writeAndRead(this.addCRC(PVTempData))
    const data3 = response3.slice(3,-2)
    this.data.BatTemp = data3.readUInt16BE(0) / 100
    this.data.DevTemp = data3.readUInt16BE(2) / 100

    await this.delay(100)

    const response4 = await this.writeAndRead(this.addCRC(PVBatSOC))
    const data4 = response4.slice(3,-2)
    this.data.BatSOC = data4.readUInt16BE(0)
    await this.delay(100)

    const response5 = await this.writeAndRead(this.addCRC(PVBatRated))
    const data5 = response5.slice(3,-2)
    this.data.BatRatedVol = data5.readUInt16BE(0) / 100

    await this.delay(100)

    const response6 = await this.writeAndRead(this.addCRC(PVStatusData))
    const data6 = response6.slice(3,-2)
    this.data.BatStat = data6.readUInt16BE(0)
    this.data.ChargEquipStat = data6.readUInt16BE(2)
    this.data.DischgEquipStat = data6.readUInt16BE(4)

    await this.delay(100)

    const response7 = await this.writeAndRead(this.addCRC(PVConData))
    const data7 = response7.slice(3,-2)
    this.data.BatMaxVolToday = data7.readUInt16BE(0) / 100
    this.data.BatMinVolToday = data7.readUInt16BE(2) / 100
    this.data.ConEnergyToday = (data7.readUInt16BE(4) | (data7.readUInt16BE(6)<<16) )/100
    this.data.ConEnergyMonth = (data7.readUInt16BE(8) | (data7.readUInt16BE(10)<<16) )/100
    this.data.ConEnergyYear = (data7.readUInt16BE(12) | (data7.readUInt16BE(14)<<16) )/100
    this.data.ConEnergyTotal = (data7.readUInt16BE(16) | (data7.readUInt16BE(18)<<16) )/100
    this.data.GenEnergyToday = (data7.readUInt16BE(20) | (data7.readUInt16BE(22)<<16) )/100
    this.data.GenEnergyMonth = (data7.readUInt16BE(24) | (data7.readUInt16BE(26)<<16) )/100
    this.data.GenEnergyYear = (data7.readUInt16BE(28) | (data7.readUInt16BE(30)<<16) )/100
    this.data.GenEnergyTotal = (data7.readUInt16BE(32) | (data7.readUInt16BE(34)<<16) )/100    
    await this.delay(100)

    const response8 = await this.writeAndRead(this.addCRC(PVBatRealTime))
    const data8 = response8.slice(3,-2)
    this.data.BatVol = data8.readUInt16BE(0) / 100
    this.data.BatCur = (data8.readUInt16BE(2) | (data8.readUInt16BE(4)<<16) )/100

    await this.delay(100)

    this.data.lastUpdate = Date.now()
    
    // Track active devices
    if (!this.status.activeDevices.includes(id)) {
      this.status.activeDevices.push(id);
    }

    console.log(`BMS data updated from device ${id.toString(16)}: SOC=${this.data.BatSOC}%, Bat=${this.data.BatVol}V, PV=${this.data.PVVol}V/${this.data.PVCur}A, Load=${this.data.LoadVol}V/${this.data.LoadCur}A`);
    console.log(`BMS Energy: GenToday=${this.data.GenEnergyToday}Wh, ConToday=${this.data.ConEnergyToday}Wh, Total=${this.data.GenEnergyTotal}Wh`);
    
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
    
    return await this.getSolarBattery(deviceId);
  }
}

// Export function to maintain compatibility with existing code
export function solarChargerDataNow() {
  return bmsController.getData();
}

// Singleton instance
const bmsController = new BMSController();

export default bmsController;
export { BMSController };