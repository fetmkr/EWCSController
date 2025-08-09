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
    
    // Capture state variables - exact ewcs.js variables
    this.captureState = 0; // 0: idle, 1: packet request, 2: wait, 3: save
    this.started = false;
    this.isSaved = false;
    this.packetCounter = 0;
    this.packetSize = this.config.packetSize || 768;
    this.packetNum = 0;
    this.snapshotSize = 0;
    this.remainingBytesSize = 0;
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
      
      // Start connection monitoring
      this.startConnectionMonitoring();
      
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
    
    // Check for start sequence 0x90, 0xEB, 0x01, 0x49 if not started
    if (!this.started) {
      for (let i = 0; i < this.dataBuffer.length - 3; i++) {
        if (this.dataBuffer[i] === 0x90 && this.dataBuffer[i + 1] === 0xEB && this.dataBuffer[i + 2] === 0x01 && this.dataBuffer[i + 3] === 0x49) {
          this.started = true;
          this.dataBuffer = this.dataBuffer.slice(i); // Start from the sequence
          break;
        }
      }
    }
    
    // If started, check if we have read at least 776 bytes
    if (this.started && this.dataBuffer.length >= this.packetSize + 8) {
      this.processPacket();
    }
    
    // capture ready - exact ewcs.js logic
    if(data[0] == 0x90 && data[1] == 0xeb && data[3] == 0x40 && data.length == 19 && this.captureState == 0) {
      this.packetCounter = 0;
      console.log("Capture ready signal received");
      console.log(data);
      
      this.snapshotSize = data.readInt32LE(7);
      console.log("snapshot size: " + this.snapshotSize);
      
      this.remainingBytesSize = (this.snapshotSize % this.packetSize);
      this.packetNum = Math.floor(this.snapshotSize / this.packetSize);
      console.log("Packets: " + this.packetNum);
      console.log("remainingBytes size: " + this.remainingBytesSize);
      
      this.captureState = 1;
    }
  }

  processPacket() {
    try {
      // Process your 768 bytes here
      let receivedData = this.dataBuffer.slice(0, this.packetSize + 8);
      let requiredData = this.dataBuffer.slice(6, this.packetSize + 6);

      this.imageBuffer = Buffer.concat([this.imageBuffer, requiredData]);

      // Reset for the next message
      this.dataBuffer = this.dataBuffer.slice(this.packetSize + 8);

      // count packet counter - exact ewcs.js logic
      if (this.packetCounter < this.packetNum - 1) {
        this.packetCounter++;
        this.captureState = 1;
      }
      else if(this.packetCounter == this.packetNum - 1) {
        // time to get the remaining bytes
        this.packetCounter++;
        this.packetSize = this.remainingBytesSize;
        this.captureState = 1;
      }
      else if(this.packetCounter >= this.packetNum) {
        //finish getting subpacket 
        //go to write file state
        this.packetSize = 768;
        this.captureState = 3;
      }

      this.started = false;
      
    } catch (error) {
      console.error('Packet processing error:', error);
      this.emit('error', error);
    }
  }

  ensureDirectoryExistence(filePath) {
    const dirname = path.dirname(filePath);
    if (fs.existsSync(dirname)) {
      return true;
    }
    this.ensureDirectoryExistence(dirname);
    fs.mkdirSync(dirname);
  }

  async saveImage() {
    try {
      const now = new Date();
      const year = now.getUTCFullYear();
      const month = String(now.getUTCMonth() + 1).padStart(2, '0'); // Months are zero-indexed
      
      const baseDirectory = path.join(process.cwd(), 'ewcs-image');
      const directoryPath = path.join(baseDirectory, `${year}-${month}`);
      const timestamp = Date.now(); // Epoch timestamp in UTC
      const filePath = path.join(directoryPath, `${timestamp}.jpg`);
      const urlPath = path.join(`${year}-${month}`, `${timestamp}.jpg`);
      
      this.ensureDirectoryExistence(filePath);
      
      // Save image buffer to file
      fs.writeFileSync(filePath, this.imageBuffer);
      
      // Update status
      this.data.lastImage = urlPath;
      this.data.totalImages++;
      this.status.lastCapture = timestamp;
      this.isSaved = true;
      
      console.log(`Captured image saved to folder: ${filePath}`);
      console.log(`[Camera] Total images captured: ${this.data.totalImages}`);
      
      // Reset capture state
      this.captureState = 0;
      
      // Emit capture event
      this.emit('imageCaptured', {
        filename: `${timestamp}.jpg`,
        path: filePath,
        size: this.imageBuffer.length,
        timestamp: timestamp
      });
      
      return { success: true, filename: `${timestamp}.jpg`, path: filePath };
      
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
    this.snapshotSize = 0;
    this.remainingBytesSize = 0;
    this.imageBuffer = Buffer.alloc(0);
    this.dataBuffer = Buffer.alloc(0);
    this.isSaved = false;
    this.status.isSaving = false;
    this.packetSize = 768; // reset to default
    
    if (this.packetCaptureInterval) {
      clearInterval(this.packetCaptureInterval);
      this.packetCaptureInterval = null;
    }
  }

  captureImage() {
    console.log(`Camera capture attempt ${this.cameraTryCount + 1}, state: ${this.captureState}`);

    if(this.captureState == 0) {
      this.cameraTryCount++;

      if (this.cameraTryCount > 5) {
        this.cameraTryCount = 0;
        if (this.packetCaptureInterval) {
          clearInterval(this.packetCaptureInterval);
          this.packetCaptureInterval = null;
        }
        console.log("check serial camera connection");
        return;
      }   
      
      this.imageBuffer = Buffer.alloc(0);
      let cmd = Buffer.from([0x90, 0xeb, 0x01, 0x40, 0x04, 0x00, 0x00, 0x02, 0x05, 0x05, 0xc1, 0xc2]);
      console.log("Sending capture command:", cmd.toString('hex'));
      this.cameraPort.write(cmd);
    }
    else if (this.captureState == 1) {
      this.isSaved = false;

      let startAddr = this.packetCounter * 768;
      let addrBuf = Buffer.allocUnsafe(4);
      // console.log("start address: " + startAddr);
      addrBuf.writeInt32LE(Number(startAddr));
      
      let cmd = Buffer.from([0x90, 0xeb, 0x01, 0x48, 0x06, 0x00]);
      cmd = Buffer.concat([cmd, addrBuf, Buffer.from([0x00, 0x03, 0xc1, 0xc2])]);
      // console.log("Requesting packet", this.packetCounter, "cmd:", cmd.toString('hex'));
      this.cameraPort.write(cmd);
      this.captureState = 2;
    }
    else if (this.captureState == 2) {
      // wait to get subpacket
      // console.log("Waiting for subpacket...");
    }
    else if (this.captureState == 3) {
      // write file
      // console.log("snapshot size " + this.snapshotSize);
      // console.log("image buffer length " + this.imageBuffer.length);
      if(this.isSaved == false) {
        if (this.packetCaptureInterval) {
          clearInterval(this.packetCaptureInterval);
          this.packetCaptureInterval = null;
        }
        if(this.snapshotSize == this.imageBuffer.length) {
          console.log("Image complete, saving...");
          this.saveImage();
        }
        else {
          console.log("serial camera image save failed - size mismatch");
        }
      }
    }
  }

  async startCapture(interval = 100) {
    if (this.status.isSaving) {
      console.log('Camera is already capturing, skipping...');
      return { success: false, reason: 'already_capturing' };
    }
    
    try {
      // Reset state
      this.resetCaptureState();
      this.status.isSaving = true;
      this.cameraTryCount = 0;
      
      console.log('ewcs image saving..');
      
      // Start periodic capture attempts - exact ewcs.js timing
      this.packetCaptureInterval = setInterval(() => {
        this.captureImage();
      }, 100); // 100ms interval like ewcs.js
      
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

  startConnectionMonitoring() {
    // Check camera response periodically
    this.connectionCheckInterval = setInterval(() => {
      if (!this.cameraPort || !this.cameraPort.isOpen) {
        if (this.status.connected) {
          console.warn(`[Camera] Serial port disconnected`);
          this.status.connected = false;
        }
      } else {
        if (!this.status.connected) {
          console.log(`[Camera] Serial connection restored`);
        }
        this.status.connected = true;
      }
    }, 30000);
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
      
      if (this.connectionCheckInterval) {
        clearInterval(this.connectionCheckInterval);
        this.connectionCheckInterval = null;
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