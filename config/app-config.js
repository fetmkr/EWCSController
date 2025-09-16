import fs from 'fs';
import path from 'path';
import * as url from 'url';

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));

class AppConfig {
  constructor() {
    this.configPath = path.join(__dirname, '../config.json');
    this.config = this.loadConfig();
  }

  loadConfig() {
    try {
      const configData = fs.readFileSync(this.configPath, 'utf8');
      const baseConfig = JSON.parse(configData);
      
      return {
        ...this.getDefaultConfig(),
        ...baseConfig,
        ...this.getEnvironmentConfig()
      };
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log('Config file not found, creating default config.json...');
        this.createDefaultConfigFile();
        return this.getDefaultConfig();
      } else {
        console.warn('Config file invalid, using defaults:', error.message);
        return this.getDefaultConfig();
      }
    }
  }

  createDefaultConfigFile() {
    try {
      const defaultConfig = this.getDefaultConfig();
      const configJson = JSON.stringify(defaultConfig, null, 2);
      fs.writeFileSync(this.configPath, configJson, 'utf8');
      console.log('Default config.json created successfully');
    } catch (error) {
      console.error('Failed to create config.json:', error.message);
    }
  }

  getDefaultConfig() {
    return {
      // Station Settings
      stationName: "KOPRI Station",
      powerSaveMode: "normal",
      
      // Network Settings  
      server: {
        port: process.env.PORT || 8080,
        host: '0.0.0.0'
      },
      
      // Device Network
      network: {
        ipAddress: "192.168.0.11",
        gateway: "192.168.0.1",
        cameraIpAddress: "192.168.0.12"
      },
      
      // OASC Exposure Time
      oascExposureTime: 10.0,
      
      // Serial Ports
      serialPorts: {
        pic24: '/dev/ttyAMA0',
        cs125: '/dev/ttyAMA2', 
        camera: '/dev/ttyAMA3',
        bms: '/dev/ttyACM0'
      },
      
      // Camera Settings
      camera: {
        packetSize: 768,
        maxRetryCount: 5,
        captureTimeout: 6000,
        imageQuality: 1
      },
      
      // CS125 Sensor Settings
      cs125: {
        baudRate: 38400,
        timeout: 5000,
        retryAttempts: 3
      },
      
      // BMS Settings
      bms: {
        baudRate: 9600,
        timeout: 3000,
        deviceIds: [0x0B, 0x0C, 0x0D, 0x0E]
      },
      
      // ADC Settings
      adc: {
        channel: 0,
        speedHz: 1000000,
        conversionFactor: 20000 / 1000,  // (reading * 3.3 / 1024) * 20000/1000
        vref: 3.3,
        resolution: 1024
      },
      
      // GPIO Settings
      gpio: {
        led: 16
      },
      
      // Database Settings
      database: {
        path: './data/ewcs.db',
        backup: {
          enabled: true,
          interval: 24 * 60 * 60 * 1000, // 24 hours
          maxBackups: 7
        }
      },
      
      // Image Storage
      images: {
        directory: './ewcs_images',
        format: 'jpg',
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
      },
      
      // Logging
      logging: {
        level: 'info',
        file: './logs/ewcs.log',
        maxSize: '10m',
        maxFiles: 5
      }
    };
  }

  getEnvironmentConfig() {
    const envConfig = {};
    
    if (process.env.STATION_NAME) envConfig.stationName = process.env.STATION_NAME;
    if (process.env.SERVER_PORT) envConfig.server = { ...envConfig.server, port: parseInt(process.env.SERVER_PORT) };
    if (process.env.DATABASE_PATH) envConfig.database = { ...envConfig.database, path: process.env.DATABASE_PATH };
    if (process.env.LOG_LEVEL) envConfig.logging = { ...envConfig.logging, level: process.env.LOG_LEVEL };
    
    return envConfig;
  }

  get(key) {
    return key.split('.').reduce((obj, k) => obj?.[k], this.config);
  }

  set(key, value) {
    const keys = key.split('.');
    const lastKey = keys.pop();
    const target = keys.reduce((obj, k) => {
      if (!obj[k]) obj[k] = {};
      return obj[k];
    }, this.config);
    
    target[lastKey] = value;
    this.saveConfig();
  }

  saveConfig() {
    try {
      // Only save user-configurable settings, not all defaults
      const saveableConfig = {
        stationName: this.config.stationName,
        powerSaveMode: this.config.powerSaveMode,
        oascExposureTime: this.config.oascExposureTime
      };

      fs.writeFileSync(this.configPath, JSON.stringify(saveableConfig, null, 2));
    } catch (error) {
      console.error('Failed to save config:', error.message);
    }
  }

  reload() {
    this.config = this.loadConfig();
    return this.config;
  }
}

// Singleton instance
const config = new AppConfig();

export default config;
export { AppConfig };