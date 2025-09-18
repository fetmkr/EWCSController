import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class SystemState {
  constructor() {
    this.statePath = path.join(__dirname, '../data/ewcs_status.json');
    this.state = this.loadState();
  }

  loadState() {
    try {
      if (fs.existsSync(this.statePath)) {
        const data = fs.readFileSync(this.statePath, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('Failed to load system state:', error);
    }

    // Default state
    return {
      current_status: {
        cs125_on: false,
        camera_on: false,
        cs125_hood_heater_on: false,
        iridium_on: false,
        last_updated: new Date().toISOString()
      },
      device_status: {
        cs125: false,
        spinel_camera: false,
        oasc_camera: false,
        bms: false,
        sht45: false,
        adc: false,
        last_check: new Date().toISOString()
      },
      settings: {
        data_save_period: 60,
        image_save_period: 100,
        station_name: 'EWCS_STATION'
      },
      recent_events: []
    };
  }

  saveState() {
    try {
      // data 디렉토리는 이미 존재한다고 가정
      // 파일이 없으면 자동 생성됨
      fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2));
    } catch (error) {
      console.error('Failed to save system state:', error);
    }
  }

  updateStatus(key, value) {
    if (this.state.current_status.hasOwnProperty(key)) {
      this.state.current_status[key] = value;
      this.state.current_status.last_updated = new Date().toISOString();
      this.saveState();
      return true;
    }
    return false;
  }

  updateSetting(key, value) {
    if (this.state.settings.hasOwnProperty(key)) {
      this.state.settings[key] = value;
      this.addEvent(`Setting changed: ${key} = ${value}`);
      this.saveState();
      return true;
    }
    return false;
  }

  addEvent(event, error = null) {
    const eventData = {
      timestamp: new Date().toISOString(),
      event: event
    };
    
    if (error) {
      eventData.error = error;
    }

    this.state.recent_events.unshift(eventData);
    
    // Keep only last 100 events
    if (this.state.recent_events.length > 100) {
      this.state.recent_events = this.state.recent_events.slice(0, 100);
    }
    
    this.saveState();
  }

  getStatus(key = null) {
    if (key) {
      return this.state.current_status[key];
    }
    return this.state.current_status;
  }

  getSetting(key = null) {
    if (key) {
      return this.state.settings[key];
    }
    return this.state.settings;
  }

  getRecentEvents(limit = 10) {
    return this.state.recent_events.slice(0, limit);
  }

  // Convenience methods for common operations
  setCS125Power(on) {
    this.updateStatus('cs125_on', on);
    this.addEvent(`CS125 power ${on ? 'ON' : 'OFF'}`);
  }

  setCameraPower(on) {
    this.updateStatus('camera_on', on);
    this.addEvent(`Camera power ${on ? 'ON' : 'OFF'}`);
  }

  setHeaterPower(on) {
    this.updateStatus('cs125_hood_heater_on', on);
    this.addEvent(`CS125 hood heater ${on ? 'ON' : 'OFF'}`);
  }

  setIridiumPower(on) {
    this.updateStatus('iridium_on', on);
    this.addEvent(`Iridium modem ${on ? 'ON' : 'OFF'}`);
  }


  logError(component, error) {
    this.addEvent(`Error in ${component}`, error.toString());
  }

  logSystemStart() {
    this.addEvent('System started');
    // Reset all device statuses on startup
    this.state.current_status = {
      ...this.state.current_status,
      cs125_on: false,
      camera_on: false,
      cs125_hood_heater_on: false,
      iridium_on: false,
      last_updated: new Date().toISOString()
    };
    this.saveState();
  }

  logSystemShutdown() {
    this.addEvent('System shutdown');
    this.saveState();
  }

  // 디바이스 상태 업데이트
  updateDeviceStatus(deviceStatus) {
    if (!this.state.device_status) {
      this.state.device_status = {
        cs125: false,
        spinel_camera: false,
        oasc_camera: false,
        bms: false,
        sht45: false,
        adc: false,
        last_check: new Date().toISOString()
      };
    }
    
    this.state.device_status = {
      ...deviceStatus,
      last_check: new Date().toISOString()
    };
    
    this.saveState();
  }

  // 디바이스 상태 가져오기
  getDeviceStatus() {
    if (!this.state.device_status) {
      return {
        cs125: false,
        spinel_camera: false,
        oasc_camera: false,
        bms: false,
        sht45: false,
        adc: false,
        last_check: new Date().toISOString()
      };
    }
    return this.state.device_status;
  }
}

// Singleton instance
const systemState = new SystemState();

export default systemState;
export { SystemState };