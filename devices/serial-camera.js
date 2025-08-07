import { SerialPort } from 'serialport';
import fs from 'fs';
import path from 'path';
import adc from 'mcp-spi-adc';
import config from '../config/app-config.js';
import { EventEmitter } from 'events';

class SerialCamera extends EventEmitter {
  constructor(controlPort = null) {
    super();
    
    this.config = config.get('camera');
    this.adcConfig = config.get('adc');
    this.serialConfig = config.get('serialPorts');
    this.imageConfig = config.get('images');
    
    this.controlPort = controlPort; // PIC24 control port
    this.cameraPort = null;
    this.currentADC = null;
    
    // Camera status
    this.status = {
      isOn: false,
      isSaving: false,
      lastCapture: 0,
      tryCount: 0
    };
    
    // Camera data
    this.data = {
      current: 0,
      lastImage: "",
      totalImages: 0
    };
    
    // Capture state variables
    this.captureState = 0; // 0: idle, 1: capturing
    this.started = false;
    this.isSaved = false;
    this.packetCounter = 0;
    this.packetSize = this.config.packetSize || 768;
    this.packetNum = 0;
    this.dataBuffer = Buffer.alloc(0);
    this.imageBuffer = Buffer.alloc(0);
    this.cameraTryCount = 0;
    
    // Timers
    this.packetCaptureInterval = null;
    this.currentInterval = null;
    
    this.isInitialized = false;
  }

  async initialize() {
    if (this.isInitialized) return;

    try {
      // Initialize camera serial port
      await this.initializeCameraPort();
      
      // Initialize ADC for current measurement
      await this.initializeCurrentADC();
      
      this.isInitialized = true;
      console.log('Serial Camera initialized');
      
      // Start current monitoring
      this.startCurrentMonitoring();
      
    } catch (error) {
      console.error('Serial Camera initialization failed:', error);
      throw error;
    }
  }

  async initializeCameraPort() {
    return new Promise((resolve, reject) => {
      this.cameraPort = new SerialPort({
        path: this.serialConfig.camera,
        baudRate: 115200
      }, (err) => {
        if (err) {
          console.error('Camera serial port error:', err);
          reject(err);
          return;
        }
      });

      this.cameraPort.on('data', (data) => {
        this.handleSerialData(data);
      });

      this.cameraPort.on('error', (err) => {
        console.error('Camera serial port error:', err);
        this.emit('error', err);
      });

      this.cameraPort.on('open', () => {
        console.log('Camera serial port opened');
        resolve();
      });
    });
  }

  async initializeCurrentADC() {
    return new Promise((resolve, reject) => {
      this.currentADC = adc.open(2, // Camera current on channel 2
        { speedHz: this.adcConfig.speedHz || 1000000 }, 
        (err) => {
          if (err) {
            console.error('Camera ADC initialization error:', err);
            reject(err);
            return;
          }
          resolve();
        });
    });
  }

  handleSerialData(data) {
    this.dataBuffer = Buffer.concat([this.dataBuffer, data]);
    
    // Process packets if we're in capture mode
    if (this.started && this.dataBuffer.length >= this.packetSize + 8) {
      this.processPacket();
    }
  }

  processPacket() {
    try {
      let receivedData = this.dataBuffer.slice(0, this.packetSize + 8);
      let requiredData = this.dataBuffer.slice(6, this.packetSize + 6);
      
      this.imageBuffer = Buffer.concat([this.imageBuffer, requiredData]);
      
      // Remove processed packet from buffer
      this.dataBuffer = this.dataBuffer.slice(this.packetSize + 8);
      
      // Update packet counter
      if (this.packetCounter < this.packetNum - 1) {
        this.packetCounter++;
      } else if (this.packetCounter === this.packetNum - 1) {
        // Last packet received, save image
        this.saveImage();
      }
      
    } catch (error) {
      console.error('Packet processing error:', error);
      this.emit('error', error);
    }
  }

  async saveImage() {
    try {
      const now = Date.now();
      const filename = `${now}.jpg`;
      const imagePath = path.join(this.imageConfig.directory, filename);
      
      // Ensure directory exists
      const imageDir = path.dirname(imagePath);
      if (!fs.existsSync(imageDir)) {
        fs.mkdirSync(imageDir, { recursive: true });
      }
      
      // Save image buffer to file
      fs.writeFileSync(imagePath, this.imageBuffer);
      
      // Update status
      this.data.lastImage = filename;
      this.data.totalImages++;
      this.status.lastCapture = now;
      this.isSaved = true;
      
      console.log(`Image saved: ${filename} (${this.imageBuffer.length} bytes)`);
      
      // Reset capture state
      this.resetCaptureState();
      
      // Emit capture event
      this.emit('imageCaptured', {
        filename: filename,
        path: imagePath,
        size: this.imageBuffer.length,
        timestamp: now
      });
      
      return { success: true, filename, path: imagePath };
      
    } catch (error) {
      console.error('Image save error:', error);
      this.resetCaptureState();
      throw error;
    }
  }

  resetCaptureState() {
    this.started = false;
    this.captureState = 0;
    this.packetCounter = 0;
    this.packetNum = 0;
    this.imageBuffer = Buffer.alloc(0);
    this.dataBuffer = Buffer.alloc(0);
    this.isSaved = false;
    this.status.isSaving = false;
    
    if (this.packetCaptureInterval) {
      clearInterval(this.packetCaptureInterval);
      this.packetCaptureInterval = null;
    }
  }

  captureImage() {
    if (this.captureState === 0) {
      this.cameraTryCount++;
      
      if (this.cameraTryCount > this.config.maxRetryCount) {
        console.error('Camera capture failed after maximum retries');
        this.resetCaptureState();
        this.emit('captureError', new Error('Maximum retry count exceeded'));
        return;
      }
      
      // Send capture command
      const captureCommand = Buffer.from([0x90, 0xEB, 0x01, 0x01, 0x01, 0x01, 0x94, 0xEB]);
      this.cameraPort.write(captureCommand);
      
      console.log(`Camera capture attempt ${this.cameraTryCount}`);
      this.captureState = 1;
    }
  }

  async startCapture(interval = 100) {
    if (this.status.isSaving) {
      throw new Error('Camera is already capturing');
    }
    
    try {
      // Reset state
      this.resetCaptureState();
      this.status.isSaving = true;
      this.cameraTryCount = 0;
      
      // Start periodic capture attempts
      this.packetCaptureInterval = setInterval(() => {
        this.captureImage();
      }, interval);
      
      // Set timeout for capture
      const captureTimeout = setTimeout(() => {
        if (this.captureState === 1 && !this.isSaved) {
          console.error('Camera capture timeout');
          this.resetCaptureState();
          this.emit('captureError', new Error('Capture timeout'));
        }
      }, this.config.captureTimeout || 6000);
      
      console.log('Camera capture started');
      return { success: true };
      
    } catch (error) {
      this.resetCaptureState();
      throw error;
    }
  }

  async turnOn() {
    if (!this.controlPort) {
      throw new Error('Control port not available for camera');
    }

    try {
      this.controlPort.write('P'); // Send command to PIC24
      this.status.isOn = true;
      console.log('Camera turned ON');
      
      this.emit('statusChange', { device: 'camera', status: 'on' });
      
      return { success: true };
    } catch (error) {
      console.error('Failed to turn on camera:', error);
      throw error;
    }
  }

  async turnOff() {
    if (!this.controlPort) {
      throw new Error('Control port not available for camera');
    }

    try {
      // Stop any ongoing capture
      this.resetCaptureState();
      
      this.controlPort.write('p'); // Send lowercase command to PIC24
      this.status.isOn = false;
      console.log('Camera turned OFF');
      
      this.emit('statusChange', { device: 'camera', status: 'off' });
      
      return { success: true };
    } catch (error) {
      console.error('Failed to turn off camera:', error);
      throw error;
    }
  }

  startCurrentMonitoring() {
    if (!this.currentADC) return;

    const readCurrent = () => {
      this.currentADC.read((err, reading) => {
        if (err) {
          console.error('Camera current ADC read error:', err);
          return;
        }

        // Convert ADC reading to current (mA)
        const voltage = (reading.rawValue * this.adcConfig.vref) / this.adcConfig.resolution;
        this.data.current = parseFloat((voltage * this.adcConfig.conversionFactor).toFixed(3));
      });
    };

    // Read current every 5 seconds
    this.currentInterval = setInterval(readCurrent, 5000);
    
    // Initial reading
    readCurrent();
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
      capture: {
        state: this.captureState,
        started: this.started,
        packetCounter: this.packetCounter,
        packetNum: this.packetNum,
        bufferSize: this.imageBuffer.length
      },
      isInitialized: this.isInitialized,
      serialPort: {
        connected: this.cameraPort?.isOpen || false,
        path: this.serialConfig.camera
      },
      adc: {
        initialized: this.currentADC !== null
      }
    };
  }

  async close() {
    try {
      // Stop all intervals
      if (this.packetCaptureInterval) {
        clearInterval(this.packetCaptureInterval);
        this.packetCaptureInterval = null;
      }
      
      if (this.currentInterval) {
        clearInterval(this.currentInterval);
        this.currentInterval = null;
      }

      // Reset capture state
      this.resetCaptureState();

      // Close ADC
      if (this.currentADC) {
        this.currentADC = null;
      }

      // Close serial port
      if (this.cameraPort && this.cameraPort.isOpen) {
        await new Promise((resolve) => {
          this.cameraPort.close((err) => {
            if (err) console.error('Camera port close error:', err);
            resolve();
          });
        });
      }

      this.isInitialized = false;
      console.log('Serial Camera closed');
      
    } catch (error) {
      console.error('Camera close error:', error);
      throw error;
    }
  }

  // Health check method
  isHealthy() {
    const now = Date.now();
    const lastCaptureAge = now - this.status.lastCapture;
    
    return {
      healthy: this.isInitialized && (this.cameraPort?.isOpen || false),
      lastCapture: this.status.lastCapture,
      lastCaptureAge: lastCaptureAge,
      serialConnected: this.cameraPort?.isOpen || false,
      adcInitialized: this.currentADC !== null,
      isCapturing: this.status.isSaving
    };
  }
}

export default SerialCamera;