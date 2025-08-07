import express from 'express';
import expressWs from 'express-ws';
import { SerialPort } from 'serialport';
import config from './config/app-config.js';
import database from './database/sqlite-db.js';

// Device modules
import CS125Sensor from './devices/cs125-sensor.js';
import SerialCamera from './devices/serial-camera.js';
import BMSController from './devices/bms-controller.js';
import SHT45Sensor from './devices/sht45-sensor.js';
import GPIOController from './devices/gpio-controller.js';
import ADCReader from './devices/adc-reader.js';

// API routes
import createDeviceRoutes from './api/routes/device-routes.js';
import createSensorRoutes from './api/routes/sensor-routes.js';
import createSystemRoutes from './api/routes/system-routes.js';

class EWCSApp {
  constructor() {
    this.app = express();
    this.server = null;
    this.devices = {};
    this.controlPort = null;
    this.dataCollectionInterval = null;
  }

  async initialize() {
    try {
      console.log('EWCS Controller starting...');
      
      // Setup Express
      this.setupExpress();
      
      // Initialize database
      await database.initialize();
      console.log('Database initialized');
      
      // Initialize control port (PIC24)
      await this.initializeControlPort();
      
      // Initialize devices
      await this.initializeDevices();
      
      // Setup API routes
      this.setupRoutes();
      
      // Start data collection
      this.startDataCollection();
      
      // Start image collection (원래 ewcs.js 방식)
      this.startImageCollection();
      
      // Start server
      this.startServer();
      
      console.log('EWCS Controller initialized successfully');
      
    } catch (error) {
      console.error('EWCS Controller initialization failed:', error);
      throw error;
    }
  }

  setupExpress() {
    expressWs(this.app);
    this.app.use(express.json());
  }

  async initializeControlPort() {
    try {
      this.controlPort = new SerialPort({
        path: config.get('serialPorts.pic24'),
        baudRate: 9600
      });
      console.log('Control port initialized');
    } catch (error) {
      console.warn('Control port initialization failed:', error.message);
    }
  }

  async initializeDevices() {
    const deviceInitResults = {};

    // Initialize GPIO controller
    try {
      this.devices.gpio = GPIOController;
      await this.devices.gpio.initialize();
      deviceInitResults.gpio = 'success';
    } catch (error) {
      console.warn('GPIO initialization failed:', error.message);
      deviceInitResults.gpio = 'failed';
    }
    
    // Initialize SHT45 sensor
    try {
      this.devices.sht45 = SHT45Sensor;
      await this.devices.sht45.initialize();
      deviceInitResults.sht45 = 'success';
    } catch (error) {
      console.warn('SHT45 sensor initialization failed:', error.message);
      deviceInitResults.sht45 = 'failed';
    }
    
    // Initialize ADC reader
    try {
      this.devices.adc = ADCReader;
      await this.devices.adc.initialize();
      await this.devices.adc.startAllContinuousReading();
      deviceInitResults.adc = 'success';
    } catch (error) {
      console.warn('ADC reader initialization failed:', error.message);
      deviceInitResults.adc = 'failed';
    }
    
    // Initialize CS125 sensor
    try {
      this.devices.cs125 = new CS125Sensor(this.controlPort);
      await this.devices.cs125.initialize();
      deviceInitResults.cs125 = 'success';
    } catch (error) {
      console.warn('CS125 sensor initialization failed:', error.message);
      deviceInitResults.cs125 = 'failed';
      this.devices.cs125 = null;
    }
    
    // Initialize serial camera
    try {
      this.devices.camera = new SerialCamera(this.controlPort);
      await this.devices.camera.initialize();
      deviceInitResults.camera = 'success';
    } catch (error) {
      console.warn('Serial camera initialization failed:', error.message);
      deviceInitResults.camera = 'failed';
      this.devices.camera = null;
    }
    
    // Initialize BMS controller
    try {
      this.devices.bms = BMSController;
      await this.devices.bms.initialize();
      deviceInitResults.bms = 'success';
    } catch (error) {
      console.warn('BMS controller initialization failed:', error.message);
      deviceInitResults.bms = 'failed';
    }
    
    const successCount = Object.values(deviceInitResults).filter(status => status === 'success').length;
    const totalCount = Object.keys(deviceInitResults).length;
    
    console.log(`Device initialization complete: ${successCount}/${totalCount} devices initialized successfully`);
    console.log('Device status:', deviceInitResults);
  }

  setupRoutes() {
    // API routes
    this.app.use('/api/device', createDeviceRoutes(this.devices));
    this.app.use('/api/sensor', createSensorRoutes(database, this.devices));
    this.app.use('/api/system', createSystemRoutes());
    
    // Health check
    this.app.get('/health', (req, res) => {
      const health = {
        status: 'ok',
        timestamp: Date.now(),
        uptime: process.uptime(),
        devices: {}
      };
      
      for (const [name, device] of Object.entries(this.devices)) {
        try {
          health.devices[name] = device.isHealthy ? device.isHealthy() : { healthy: true };
        } catch (error) {
          health.devices[name] = { healthy: false, error: error.message };
        }
      }
      
      res.json(health);
    });
    
    // Root endpoint
    this.app.get('/', (req, res) => {
      res.json({ 
        message: 'EWCS Controller API', 
        version: '2.0.0',
        timestamp: Date.now()
      });
    });
  }

  startDataCollection() {
    const savePeriod = config.get('data.savePeriod') * 1000; // Convert to ms
    
    this.dataCollectionInterval = setInterval(async () => {
      try {
        const ewcsData = {
          timestamp: Date.now(),
          stationName: config.get('stationName'),
          // CS125 data
          cs125Current: this.devices.cs125.data.current,
          cs125Visibility: this.devices.cs125.data.visibility,
          cs125SYNOP: this.devices.cs125.data.synop,
          cs125Temp: this.devices.cs125.data.temperature,
          cs125Humidity: this.devices.cs125.data.humidity,
          // SHT45 data
          SHT45Temp: this.devices.sht45.data.temperature,
          SHT45Humidity: this.devices.sht45.data.humidity,
          // ADC data
          adcReading: this.devices.adc.getChannelData(0)?.data.rawValue || 0,
          adcVoltage: this.devices.adc.getChannelData(0)?.data.voltage || 0
        };
        
        await database.insertEwcsData(ewcsData);
        console.log(`[DATA] Saved to database - CS125: ${ewcsData.cs125Current}mA, SHT45: ${ewcsData.SHT45Temp}°C/${ewcsData.SHT45Humidity}%RH, ADC: ${ewcsData.adcVoltage}V`);
        console.log(`[DATA] CS125 Visibility: ${ewcsData.cs125Visibility}m, SYNOP: ${ewcsData.cs125SYNOP}`);
        
        
      } catch (error) {
        console.error('Data collection error:', error);
      }
    }, savePeriod);
    
    console.log(`Data collection started (${savePeriod/1000}s interval)`);
  }

  startImageCollection() {
    // 원래 ewcs.js의 imageSavePeriod = 100초
    const imagePeriod = 100 * 1000; // 100초
    
    const captureImage = async () => {
      try {
        if (this.devices.camera) {
          const captureResult = await this.devices.camera.startCapture();
          if (captureResult.success) {
            console.log(`[CAMERA] Capture process started`);
          }
        }
      } catch (cameraError) {
        console.error('[CAMERA] Capture failed:', cameraError.message);
      }
      
      // 다음 캡처 스케줄
      setTimeout(captureImage, imagePeriod);
    };
    
    // 첫 번째 이미지 캡처 시작
    setTimeout(captureImage, imagePeriod);
    console.log(`Image collection started (${imagePeriod/1000}s interval)`);
  }

  startServer() {
    const port = config.get('server.port');
    const host = config.get('server.host');
    
    this.server = this.app.listen(port, host, () => {
      console.log(`EWCS Controller running on http://${host}:${port}`);
    });
  }

  async shutdown() {
    console.log('Shutting down EWCS Controller...');
    
    try {
      // Stop data collection
      if (this.dataCollectionInterval) {
        clearInterval(this.dataCollectionInterval);
      }
      
      // Close devices
      for (const [name, device] of Object.entries(this.devices)) {
        try {
          if (device && device.close) {
            await device.close();
            console.log(`${name} closed`);
          }
        } catch (error) {
          console.error(`Error closing ${name}:`, error);
        }
      }
      
      // Close control port
      if (this.controlPort && this.controlPort.isOpen) {
        this.controlPort.close();
      }
      
      // Close database
      await database.close();
      
      // Close server
      if (this.server) {
        this.server.close();
      }
      
      console.log('EWCS Controller shutdown complete');
      
    } catch (error) {
      console.error('Shutdown error:', error);
    }
  }
}

// Create and start the application
const ewcsApp = new EWCSApp();

// Graceful shutdown handlers
process.on('SIGINT', async () => {
  console.log('\nReceived SIGINT, shutting down gracefully...');
  await ewcsApp.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  await ewcsApp.shutdown();
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  ewcsApp.shutdown().finally(() => {
    process.exit(1);
  });
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start the application
ewcsApp.initialize().catch((error) => {
  console.error('Failed to start EWCS Controller:', error);
  process.exit(1);
});