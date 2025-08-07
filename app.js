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
    try {
      // Initialize GPIO controller
      this.devices.gpio = GPIOController;
      await this.devices.gpio.initialize();
      
      // Initialize SHT45 sensor
      this.devices.sht45 = SHT45Sensor;
      await this.devices.sht45.initialize();
      
      // Initialize ADC reader
      this.devices.adc = ADCReader;
      await this.devices.adc.initialize();
      await this.devices.adc.startAllContinuousReading();
      
      // Initialize CS125 sensor
      this.devices.cs125 = new CS125Sensor(this.controlPort);
      await this.devices.cs125.initialize();
      
      // Initialize serial camera
      this.devices.camera = new SerialCamera(this.controlPort);
      await this.devices.camera.initialize();
      
      // Initialize BMS controller
      this.devices.bms = BMSController;
      await this.devices.bms.initialize();
      
      console.log('All devices initialized');
      
    } catch (error) {
      console.error('Device initialization error:', error);
      throw error;
    }
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
        console.log('Data saved to database');
        
      } catch (error) {
        console.error('Data collection error:', error);
      }
    }, savePeriod);
    
    console.log(`Data collection started (${savePeriod/1000}s interval)`);
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
          if (device.close) {
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