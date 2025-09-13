import { EWCSPIC24Client, EWCSPIC24 } from '../scripts/ewcspic24-client.js';

export default class PIC24Controller {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.lastError = null;
  }

  async initialize(portPath = '/dev/ttyAMA0', baudRate = 115200) {
    try {
      this.client = new EWCSPIC24Client(portPath, baudRate);

      // EWCSPIC24Client는 connect() 메서드를 호출해야 시리얼 포트가 연결됨
      await this.client.connect();

      this.isConnected = true;
      this.lastError = null;
      console.log('[PIC24] Controller initialized with EWCSPIC24 protocol');

      return { success: true };
    } catch (error) {
      this.lastError = error.message;
      console.error('[PIC24] Initialization failed:', error);
      return { success: false, error: error.message };
    }
  }

  // EWCSPIC24 프로토콜 명령 전송 함수
  async sendCommand(commandType, data = null) {
    if (!this.client || !this.isConnected) {
      throw new Error('PIC24 not connected');
    }

    try {
      let result;

      switch (commandType) {
        case 'RESET':
          result = await this.client.reset();
          break;
        case 'SEND_SYNC_DATA':
          result = await this.client.sendSyncData();
          break;
        case 'GET_SCHEDULE':
          result = await this.client.getSchedule();
          break;
        case 'SET_SCHEDULE':
          result = await this.client.setSchedule(data);
          break;
        case 'POWER_SAVE_ON':
          result = await this.client.setPowerSave(true);
          break;
        case 'POWER_SAVE_OFF':
          result = await this.client.setPowerSave(false);
          break;
        case 'SAT_TX_START':
          result = await this.client.startSatelliteTransmission();
          break;
        case 'VOUT1_ON':
          result = await this.client.turnOnVOUT(1);
          break;
        case 'VOUT1_OFF':
          result = await this.client.turnOffVOUT(1);
          break;
        case 'VOUT2_ON':
          result = await this.client.turnOnVOUT(2);
          break;
        case 'VOUT2_OFF':
          result = await this.client.turnOffVOUT(2);
          break;
        case 'VOUT3_ON':
          result = await this.client.turnOnVOUT(3);
          break;
        case 'VOUT3_OFF':
          result = await this.client.turnOffVOUT(3);
          break;
        case 'VOUT4_ON':
          result = await this.client.turnOnVOUT(4);
          break;
        case 'VOUT4_OFF':
          result = await this.client.turnOffVOUT(4);
          break;
        default:
          throw new Error(`Unknown command type: ${commandType}`);
      }

      console.log(`[PIC24] Command sent: ${commandType}`);
      return result;
    } catch (error) {
      this.lastError = error.message;
      console.error(`[PIC24] Failed to send command ${commandType}:`, error);
      throw error;
    }
  }

  // 간편 메서드들 (VOUT 제어로 매핑)
  async cameraOn() {
    return this.sendCommand('VOUT1_ON');  // 카메라 = VOUT1
  }

  async cameraOff() {
    return this.sendCommand('VOUT1_OFF');
  }

  async cs125On() {
    return this.sendCommand('VOUT2_ON');  // CS125 = VOUT2
  }

  async cs125Off() {
    return this.sendCommand('VOUT2_OFF');
  }

  async heaterOn() {
    return this.sendCommand('VOUT3_ON');  // 히터 = VOUT3
  }

  async heaterOff() {
    return this.sendCommand('VOUT3_OFF');
  }

  // 추가 VOUT 제어
  async vout4On() {
    return this.sendCommand('VOUT4_ON');
  }

  async vout4Off() {
    return this.sendCommand('VOUT4_OFF');
  }

  // 고급 기능들
  async reset() {
    return this.sendCommand('RESET');
  }

  async syncData() {
    return this.sendCommand('SEND_SYNC_DATA');
  }

  async getSchedule() {
    return this.sendCommand('GET_SCHEDULE');
  }

  async setSchedule(scheduleData) {
    return this.sendCommand('SET_SCHEDULE', scheduleData);
  }

  async enablePowerSave() {
    return this.sendCommand('POWER_SAVE_ON');
  }

  async disablePowerSave() {
    return this.sendCommand('POWER_SAVE_OFF');
  }

  async startSatelliteTransmission() {
    return this.sendCommand('SAT_TX_START');
  }

  // 상태 조회
  getStatus() {
    return {
      connected: this.isConnected,
      lastError: this.lastError,
      portOpen: this.serialPort ? this.serialPort.isOpen : false
    };
  }

  // 연결 종료
  async close() {
    try {
      if (this.serialPort && this.serialPort.isOpen) {
        this.serialPort.close();
      }
      this.isConnected = false;
      console.log('[PIC24] Controller closed');
    } catch (error) {
      console.error('[PIC24] Close error:', error);
    }
  }
}