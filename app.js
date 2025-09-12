import express from 'express';
import expressWs from 'express-ws';
import { SerialPort } from 'serialport';
import config from './config/app-config.js';
import database from './database/sqlite-db.js';
import systemState from './utils/system-state.js';

// Device modules
import CS125Sensor from './devices/cs125-sensor.js';
import SpinelCamera from './devices/spinel-serial-camera.js';
import EPEVERController from './devices/epever-controller.js';
import SHT45Sensor from './devices/sht45-sensor.js';
import GPIOController from './devices/gpio-controller.js';
import ADCReader from './devices/adc-reader.js';
import OASCCamera from './devices/oasc-camera.js';

// API routes
import createDeviceRoutes from './api/routes/device-routes.js';
import createSensorRoutes from './api/routes/sensor-routes.js';
import createSystemRoutes from './api/routes/system-routes.js';
import createEwcsRoutes from './api/routes/ewcs-routes.js';
import createOascRoutes from './api/routes/oasc-routes.js';

// Utility function for timestamped logging
function getTimestamp() {
  const now = new Date();
  return now.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

class EWCSApp {
  constructor() {
    this.app = express();
    this.server = null;
    this.devices = {};
    this.controlPort = null;
    this.dataCollectionInterval = null;
    this.lastImageFilename = "";
    
    // EWCS 데이터 구조 (원래 ewcs.js와 동일한 필드)
    this.ewcsData = {
      stationName: "",
      timestamp: 0,
      mode: "normal",
      // CS125 센서 데이터
      cs125Current: 0,
      cs125Visibility: 0,
      cs125SYNOP: 0,
      cs125Temp: 0,
      cs125Humidity: 0,
      // 환경 센서 데이터
      SHT45Temp: 0,
      SHT45Humidity: 0,
      rpiTemp: 0,
      // 전력 모니터링 데이터
      iridiumCurrent: 0,
      cameraCurrent: 0,
      batteryVoltage: 0,
      // 태양광 충전기 데이터
      PVVol: 0,
      PVCur: 0,
      LoadVol: 0,
      LoadCur: 0,
      BatTemp: 0,
      DevTemp: 0,
      ChargEquipStat: 0,
      DischgEquipStat: 0,
      // 이미지 정보
      lastImage: ""
    };
    
    // EWCS 상태 정보 (시스템 상태 추적용)
    this.ewcsStatus = {
      // 장치 연결 상태
      cs125Connected: 0,
      cameraConnected: 0,
      OASCConnected: 0,
      EPEVERConnected: 0,
      ADCConnected: 0,
      SHT45Connected: 0,
      // 기존 상태
      cs125OnStatus: 0,
      cs125HoodHeaterStatus: 0,
      cameraOnStatus: 0,
      cameraIsSaving: 0,
      iridiumOnStatus: 0,
      iridiumIsSending: 0,
      powerSaveOnStatus: 0,
      ipAddress: "",
      gateway: "",
      cameraIpAddress: "",
      dataSavePeriod: 60,
      imageSavePeriod: 100
    };
  }

  async initialize() {
    try {
      console.log(`[${getTimestamp()}] EWCS Controller starting...`);
      
      // Log system start
      systemState.logSystemStart();
      
      // Setup Express
      this.setupExpress();
      
      // Initialize database
      database.initialize();
      console.log(`[${getTimestamp()}] [DB] Database initialized`);
      
      // Initialize control port (PIC24)
      await this.initializeControlPort();
      
      // Initialize devices
      await this.initializeDevices();
      
      // Initial device health check after initialization
      await this.checkDeviceHealth();
      
      // Setup API routes
      this.setupRoutes();
      
      // Start data collection
      this.startDataCollection();
      
      // Start image collection (원래 ewcs.js 방식)
      this.startImageCollection();
      
      // Start server
      this.startServer();
      
      console.log(`[${getTimestamp()}] EWCS Controller initialized successfully`);
      
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
        baudRate: 115200
      });
      console.log(`[${getTimestamp()}] Control port initialized`);
    } catch (error) {
      console.warn('Control port initialization failed:', error.message);
    }
  }

  async initializeDevices() {
    // Initialize GPIO controller
    try {
      this.devices.gpio = GPIOController;
      await this.devices.gpio.initialize();
    } catch (error) {
      console.warn('GPIO initialization failed:', error.message);
    }
    
    // Initialize SHT45 sensor
    try {
      this.devices.sht45 = SHT45Sensor;
      await this.devices.sht45.initialize();
    } catch (error) {
      console.warn('SHT45 sensor initialization failed:', error.message);
    }
    
    // Initialize ADC reader
    try {
      this.devices.adc = ADCReader;
      await this.devices.adc.initialize();
      // ADC 단순화로 인해 continuous reading 불필요
    } catch (error) {
      console.warn('ADC reader initialization failed:', error.message);
    }
    
    // Initialize CS125 sensor
    try {
      this.devices.cs125 = new CS125Sensor();
      await this.devices.cs125.initialize();
    } catch (error) {
      console.warn('CS125 sensor initialization failed:', error.message);
      this.devices.cs125 = null;
    }
    
    // Initialize spinel camera
    try {
      this.devices.camera = new SpinelCamera(config.get('serialPorts.camera'), 115200);
      
      // Camera power control will be handled by app.js via PIC24
      // console.log('[CAMERA] Testing connection at startup...'); // Simplified for cleaner logs
      await this.turnOnCamera();
      await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for camera boot
      
      const isConnected = await this.devices.camera.checkConnection();
      if (isConnected) {
        // console.log(`[CAMERA] Startup test successful - ID: 0x${this.devices.camera.config.cameraId.toString(16).padStart(2, '0')}`); // Simplified for cleaner logs
      } else {
        console.warn(`[CAMERA] Startup test failed: no response`);
      }
      
      await this.turnOffCamera();
    } catch (error) {
      console.warn('Spinel camera initialization failed:', error.message);
      this.devices.camera = null;
    }
    
    // Initialize EPEVER controller
    try {
      this.devices.epever = EPEVERController;
      await this.devices.epever.initialize();
    } catch (error) {
      console.warn('EPEVER controller initialization failed:', error.message);
    }
    
    // Initialize OASC camera
    try {
      this.devices.oascCamera = new OASCCamera();
      await this.devices.oascCamera.initialize();
      
      // Connect to camera after initialization
      const connected = await this.devices.oascCamera.connect();
      if (connected) {
        console.log('[OASC] Camera connected successfully');
      } else {
        console.warn('[OASC] Camera initialized but connection failed');
      }
    } catch (error) {
      console.warn('OASC camera initialization failed:', error.message);
    }
    
    console.log(`[${getTimestamp()}] Device initialization complete`);
  }

  setupRoutes() {
    // API routes
    this.app.use('/api/device', createDeviceRoutes(this.devices));
    this.app.use('/api/sensor', createSensorRoutes(database, this.devices));
    this.app.use('/api/system', createSystemRoutes());
    this.app.use('/api', createEwcsRoutes(database));
    this.app.use('/api', createOascRoutes(database, this.devices));
    
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
        // 데이터 수집용 디바이스만 체크
        await this.checkDataCollectionDevices();
        
        await this.updateEwcsData();
        
        database.insertEwcsData(this.ewcsData);
        console.log(`[${getTimestamp()}] [DB] EWCS data saved to database`);
        
      } catch (error) {
        console.error('Data collection error:', error);
        systemState.logError('data_collection', error);
      }
    }, savePeriod);
    
    console.log(`Data collection started (${savePeriod/1000}s interval)`);
  }

  // EWCS 데이터 업데이트 함수 (비동기)
  async updateEwcsData() {
    this.ewcsData.timestamp = Date.now();
    this.ewcsData.stationName = config.get('stationName');
    
    // CS125 센서 데이터
    if (this.devices.cs125?.data) {
      console.log('[CS125] Connected - collecting data');
      this.ewcsData.cs125Current = this.devices.cs125.data.current || 0;
      this.ewcsData.cs125Visibility = this.devices.cs125.data.visibility || 0;
      this.ewcsData.cs125SYNOP = this.devices.cs125.data.synop || 0;
      this.ewcsData.cs125Temp = this.devices.cs125.data.temperature || 0;
      this.ewcsData.cs125Humidity = this.devices.cs125.data.humidity || 0;
    } else {
      console.log('[CS125] Disconnected - skipping data collection');
    }
    
    // SHT45 환경 센서 데이터
    if (this.devices.sht45) {
      await this.devices.sht45.updateSHT45(); // 데이터 업데이트 함수 호출
      const sht45Data = this.devices.sht45.getData();
      
      if (sht45Data.lastReading > 0) {
        console.log('[SHT45] Connected - collecting data');
        this.ewcsData.SHT45Temp = sht45Data.temperature || 0;
        this.ewcsData.SHT45Humidity = sht45Data.humidity || 0;
      } else {
        console.log('[SHT45] Disconnected - skipping data collection');
      }
    }
    
    // ADC 전력 모니터링 데이터 (원래 ewcs.js 방식)
    if (this.devices.adc) {
      console.log('[ADC] Connected - collecting power monitoring data');
      // CH1: Iridium current, CH2: Camera current, CH3: Battery voltage
      this.ewcsData.iridiumCurrent = (await this.devices.adc.getChannelData(1))?.data?.convertedValue || 0;
      this.ewcsData.cameraCurrent = (await this.devices.adc.getChannelData(2))?.data?.convertedValue || 0;  
      this.ewcsData.batteryVoltage = (await this.devices.adc.getChannelData(3))?.data?.convertedValue || 0;
    } else {
      console.log('[ADC] Disconnected - skipping power monitoring data');
    }
    
    // EPEVER 태양광 충전기 데이터 (실시간 수집)
    if (this.devices.epever) {
      try {
        console.log('[EPEVER] Collecting real-time solar charger data');
        const epeverData = await this.devices.epever.getData();
        
        // lastUpdate가 0이면 연결 실패 또는 타임아웃으로 데이터 저장하지 않음
        if (epeverData.lastUpdate && epeverData.lastUpdate > 0) {
          console.log('[EPEVER] Connected - using real-time data');
          this.ewcsData.PVVol = epeverData.PVVol || 0;
          this.ewcsData.PVCur = epeverData.PVCur || 0;
          this.ewcsData.LoadVol = epeverData.LoadVol || 0;
          this.ewcsData.LoadCur = epeverData.LoadCur || 0;
          this.ewcsData.BatTemp = epeverData.BatTemp || 0;
          this.ewcsData.DevTemp = epeverData.DevTemp || 0;
          this.ewcsData.ChargEquipStat = epeverData.ChargEquipStat || 0;
          this.ewcsData.DischgEquipStat = epeverData.DischgEquipStat || 0;
        } else {
          console.log('[EPEVER] Data collection failed - using default values');
          // 연결 실패 시 기본값 사용
          this.ewcsData.PVVol = 0;
          this.ewcsData.PVCur = 0;
          this.ewcsData.LoadVol = 0;
          this.ewcsData.LoadCur = 0;
          this.ewcsData.BatTemp = 0;
          this.ewcsData.DevTemp = 0;
          this.ewcsData.ChargEquipStat = 0;
          this.ewcsData.DischgEquipStat = 0;
        }
      } catch (error) {
        console.log('[EPEVER] Real-time data collection failed:', error.message);
        // 예외 발생 시에도 기본값 사용
        this.ewcsData.PVVol = 0;
        this.ewcsData.PVCur = 0;
        this.ewcsData.LoadVol = 0;
        this.ewcsData.LoadCur = 0;
        this.ewcsData.BatTemp = 0;
        this.ewcsData.DevTemp = 0;
        this.ewcsData.ChargEquipStat = 0;
        this.ewcsData.DischgEquipStat = 0;
      }
    } else {
      console.log('[EPEVER] Disconnected - skipping solar charger data');
    }
    
    // 이미지 정보
    this.ewcsData.lastImage = this.lastImageFilename || "";
    
    // RPi 온도는 별도 함수로 구현 예정
    // this.ewcsData.rpiTemp = this.getRPiTemperature();
  }

  startImageCollection() {
    // 원래 ewcs.js의 imageSavePeriod = 100초
    const imagePeriod = 100 * 1000; // 100초
    
    const captureImage = async () => {
      try {
        // 이미지 수집용 디바이스만 체크 - 경쟁 상태를 유발하므로 제거
        // const deviceStatus = await this.checkImageCollectionDevices();
        
        // Spinel Camera 촬영
        if (this.devices.camera) { // deviceStatus 확인 대신, camera 객체 존재 여부만 확인
          console.log(`[${getTimestamp()}] [CAMERA] Spinel capture started`);
          // Turn on camera via PIC24
          await this.turnOnCamera();
          
          // Wait for camera to power up
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          const captureResult = await this.devices.camera.startCapture();
          if (captureResult.success) {
            console.log(`[${getTimestamp()}] [CAMERA] ✅ Spinel saved: ${captureResult.filename}`);
            console.log(`[${getTimestamp()}] [DEBUG] Spinel captureResult:`, JSON.stringify(captureResult, null, 2));
            // 파일 저장이 완료된 후에만 데이터베이스에 저장
            if (captureResult.filename && captureResult.savedPath) {
              database.insertImageData({
                timestamp: Date.now(),
                filename: captureResult.filename,
                camera: 'spinel'
              });
              console.log(`[${getTimestamp()}] [DB] Spinel image data saved: ${captureResult.filename}`);
              this.lastImageFilename = captureResult.filename;
            }
          } else {
            console.error(`[CAMERA] Spinel capture failed: ${captureResult.reason}`);
          }
          
          // Turn off camera after capture to save power
          setTimeout(() => {
            this.turnOffCamera();
          }, 30000); // 30초 후 카메라 전원 차단
        } else {
          console.log('[CAMERA] Spinel camera disconnected - skipping spinel capture');
        }

        // OASC Camera 촬영
        if (this.devices.oascCamera) {
          console.log('[OASC] OASC camera connected - starting capture');
          
          const captureResult = await this.devices.oascCamera.captureImage();
          if (captureResult.success) {
            console.log(`[OASC] Image captured and saved: ${captureResult.filename}`);
            // 파일 저장이 완료된 후에만 데이터베이스에 저장
            if (captureResult.filename && captureResult.savedPath) {
              database.insertImageData({
                timestamp: Date.now(),
                filename: captureResult.filename,
                camera: 'oasc'
              });
              console.log(`[DB] OASC image data saved: ${captureResult.filename}`);
            }
          } else {
            console.error(`[OASC] Capture failed: ${captureResult.reason}`);
          }
        } else {
          console.log('[OASC] OASC camera disconnected - skipping OASC capture');
        }

      } catch (cameraError) {
        console.error('[CAMERA] Capture failed:', cameraError.message);
        systemState.logError('camera_capture', cameraError);
        await this.turnOffCamera(); // 에러 발생시도 전원 차단
      }
      
      // 다음 캡처 스케줄
      setTimeout(captureImage, imagePeriod);
    };
    
    // 첫 번째 이미지 캡처 시작
    setTimeout(captureImage, imagePeriod);
    console.log(`Image collection started (${imagePeriod/1000}s interval)`);
  }

  // PIC24를 통한 카메라 전원 제어
  async turnOnCamera() {
    if (!this.controlPort) {
      throw new Error('Control port not available for camera power control');
    }

    try {
      this.controlPort.write('P'); // PIC24에 카메라 ON 명령 전송
      systemState.setCameraPower(true);
      console.log('[CAMERA] Power ON via PIC24');
      return { success: true };
    } catch (error) {
      console.error('[CAMERA] Failed to turn on camera:', error);
      systemState.logError('camera', error);
      throw error;
    }
  }

  async turnOffCamera() {
    if (!this.controlPort) {
      throw new Error('Control port not available for camera power control');
    }

    try {
      this.controlPort.write('p'); // PIC24에 카메라 OFF 명령 전송 (소문자)
      systemState.setCameraPower(false);
      console.log('[CAMERA] Power OFF via PIC24');
      return { success: true };
    } catch (error) {
      console.error('[CAMERA] Failed to turn off camera:', error);
      systemState.logError('camera', error);
      throw error;
    }
  }

  // PIC24를 통한 CS125 전원 제어
  async turnOnCS125() {
    if (!this.controlPort) {
      throw new Error('Control port not available for CS125 power control');
    }

    try {
      this.controlPort.write('C'); // PIC24에 CS125 ON 명령 전송
      console.log('[CS125] Power ON via PIC24');
      return { success: true };
    } catch (error) {
      console.error('[CS125] Failed to turn on CS125:', error);
      systemState.logError('cs125', error);
      throw error;
    }
  }

  async turnOffCS125() {
    if (!this.controlPort) {
      throw new Error('Control port not available for CS125 power control');
    }

    try {
      this.controlPort.write('c'); // PIC24에 CS125 OFF 명령 전송 (소문자)
      console.log('[CS125] Power OFF via PIC24');
      return { success: true };
    } catch (error) {
      console.error('[CS125] Failed to turn off CS125:', error);
      systemState.logError('cs125', error);
      throw error;
    }
  }

  // PIC24를 통한 CS125 후드 히터 제어
  async setCS125HoodHeater(enable) {
    if (!this.controlPort) {
      throw new Error('Control port not available for CS125 hood heater control');
    }

    try {
      const command = enable ? 'H' : 'h';
      this.controlPort.write(command); // PIC24에 후드 히터 명령 전송
      console.log(`[CS125] Hood heater ${enable ? 'ON' : 'OFF'} via PIC24`);
      return { success: true };
    } catch (error) {
      console.error(`[CS125] Failed to turn ${enable ? 'on' : 'off'} hood heater:`, error);
      systemState.logError('cs125_hood_heater', error);
      throw error;
    }
  }

  // 카메라 연결 테스트 (0x01 테스트 명령 사용)

  // 개별 디바이스 체크 함수들
  async checkCS125Connection() {
    console.log('[DEBUG] checkCS125Connection - cs125 exists?', !!this.devices.cs125);
    if (!this.devices.cs125) {
      this.ewcsStatus.cs125Connected = 0;
      console.log(`[${getTimestamp()}] [STATUS] CS125 Connected: ${this.ewcsStatus.cs125Connected}`);
      return false;
    }
    try {
      const isConnected = await this.devices.cs125.checkConnection();
      console.log('[DEBUG] CS125 checkConnection returned:', isConnected);
      // CS125에 연결 상태 전달
      this.devices.cs125.setConnectionStatus(isConnected);
      // ewcsStatus 업데이트
      this.ewcsStatus.cs125Connected = isConnected ? 1 : 0;
      console.log(`[${getTimestamp()}] [STATUS] CS125 Connected: ${this.ewcsStatus.cs125Connected}`);
      return isConnected;
    } catch (e) {
      console.log('[DEBUG] CS125 checkConnection error:', e.message);
      this.devices.cs125.setConnectionStatus(false);
      this.ewcsStatus.cs125Connected = 0;
      console.log(`[${getTimestamp()}] [STATUS] CS125 Connected: ${this.ewcsStatus.cs125Connected}`);
      return false;
    }
  }

  async checkSpinelCameraConnection() {
    if (!this.devices.camera) {
      this.ewcsStatus.cameraConnected = 0;
      console.log(`[${getTimestamp()}] [STATUS] Camera Connected: ${this.ewcsStatus.cameraConnected}`);
      return false;
    }
    try {
      const isConnected = await this.devices.camera.checkConnection();
      this.ewcsStatus.cameraConnected = isConnected ? 1 : 0;
      console.log(`[${getTimestamp()}] [STATUS] Camera Connected: ${this.ewcsStatus.cameraConnected}`);
      return isConnected;
    } catch (e) {
      this.ewcsStatus.cameraConnected = 0;
      console.log(`[${getTimestamp()}] [STATUS] Camera Connected: ${this.ewcsStatus.cameraConnected}`);
      return false;
    }
  }

  async checkOASCCameraConnection() {
    if (!this.devices.oascCamera) {
      this.ewcsStatus.OASCConnected = 0;
      console.log(`[${getTimestamp()}] [STATUS] OASC Connected: ${this.ewcsStatus.OASCConnected}`);
      return false;
    }
    try {
      const isConnected = await this.devices.oascCamera.checkConnection();
      this.ewcsStatus.OASCConnected = isConnected ? 1 : 0;
      console.log(`[${getTimestamp()}] [STATUS] OASC Connected: ${this.ewcsStatus.OASCConnected}`);
      return isConnected;
    } catch (e) {
      this.ewcsStatus.OASCConnected = 0;
      console.log(`[${getTimestamp()}] [STATUS] OASC Connected: ${this.ewcsStatus.OASCConnected}`);
      return false;
    }
  }

  async checkEPEVERConnection() {
    if (!this.devices.epever) {
      this.ewcsStatus.EPEVERConnected = 0;
      console.log(`[${getTimestamp()}] [STATUS] EPEVER Connected: ${this.ewcsStatus.EPEVERConnected}`);
      return false;
    }
    try {
      const isConnected = await this.devices.epever.checkConnection();
      this.ewcsStatus.EPEVERConnected = isConnected ? 1 : 0;
      console.log(`[${getTimestamp()}] [STATUS] EPEVER Connected: ${this.ewcsStatus.EPEVERConnected}`);
      return isConnected;
    } catch (e) {
      this.ewcsStatus.EPEVERConnected = 0;
      console.log(`[${getTimestamp()}] [STATUS] EPEVER Connected: ${this.ewcsStatus.EPEVERConnected}`);
      return false;
    }
  }

  async checkSHT45Connection() {
    if (!this.devices.sht45) {
      this.ewcsStatus.SHT45Connected = 0;
      console.log(`[${getTimestamp()}] [STATUS] SHT45 Connected: ${this.ewcsStatus.SHT45Connected}`);
      return false;
    }
    try {
      const isConnected = await this.devices.sht45.checkConnection();
      this.ewcsStatus.SHT45Connected = isConnected ? 1 : 0;
      console.log(`[${getTimestamp()}] [STATUS] SHT45 Connected: ${this.ewcsStatus.SHT45Connected}`);
      return isConnected;
    } catch (e) {
      this.ewcsStatus.SHT45Connected = 0;
      console.log(`[${getTimestamp()}] [STATUS] SHT45 Connected: ${this.ewcsStatus.SHT45Connected}`);
      return false;
    }
  }

  async checkADCConnection() {
    if (!this.devices.adc) {
      this.ewcsStatus.ADCConnected = 0;
      console.log(`[${getTimestamp()}] [STATUS] ADC Connected: ${this.ewcsStatus.ADCConnected}`);
      return false;
    }
    try {
      const isConnected = await this.devices.adc.checkConnection();
      this.ewcsStatus.ADCConnected = isConnected ? 1 : 0;
      console.log(`[${getTimestamp()}] [STATUS] ADC Connected: ${this.ewcsStatus.ADCConnected}`);
      return isConnected;
    } catch (e) {
      this.ewcsStatus.ADCConnected = 0;
      console.log(`[${getTimestamp()}] [STATUS] ADC Connected: ${this.ewcsStatus.ADCConnected}`);
      return false;
    }
  }

  // 데이터 수집용 디바이스 체크 (CS125, EPEVER, SHT45, ADC)
  async checkDataCollectionDevices() {
    return {
      cs125: await this.checkCS125Connection(),
      epever: await this.checkEPEVERConnection(),
      sht45: await this.checkSHT45Connection(),
      adc: await this.checkADCConnection()
    };
  }

  // 이미지 수집용 디바이스 체크 (Cameras)
  async checkImageCollectionDevices() {
    return {
      spinel_camera: await this.checkSpinelCameraConnection(),
      oasc_camera: await this.checkOASCCameraConnection()
    };
  }

  // 전체 디바이스 헬스 체크
  async checkDeviceHealth() {
    const deviceStatus = {
      cs125: await this.checkCS125Connection(),
      spinel_camera: await this.checkSpinelCameraConnection(),
      oasc_camera: await this.checkOASCCameraConnection(),
      epever: await this.checkEPEVERConnection(),
      sht45: await this.checkSHT45Connection(),
      adc: await this.checkADCConnection()
    };

    // 상태 업데이트
    systemState.updateDeviceStatus(deviceStatus);
    
    return deviceStatus;
  }

  startServer() {
    const port = config.get('server.port');
    const host = config.get('server.host');
    
    this.server = this.app.listen(port, host, () => {
      console.log(`[${getTimestamp()}] EWCS Controller running on http://${host}:${port}`);
    });
  }

  async shutdown() {
    console.log('Shutting down EWCS Controller...');
    systemState.logSystemShutdown();
    
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
      database.close();
      
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
