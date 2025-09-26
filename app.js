import express from 'express';
import expressWs from 'express-ws';
import config from './config/app-config.js';
import database from './database/sqlite-db.js';
import logManager from './utils/log-manager.js';
import AutoDataCleanup from './utils/auto-data-cleanup.js';
import os from 'os';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Device modules
import CS125Sensor from './devices/cs125-sensor.js';
import SpinelCamera from './devices/spinel-serial-camera.js';
import EPEVERController from './devices/epever-controller.js';
import SHT45Sensor from './devices/sht45-sensor.js';
import GPIOController from './devices/gpio-controller.js';
import ADCReader from './devices/adc-reader.js';
import OASCCamera from './devices/oasc-camera.js';
import PIC24Controller from './devices/pic24-controller.js';

// API routes
import createScheduleRoutes from './api/routes/schedule-routes.js';
import createEwcsRoutes from './api/routes/ewcs-routes.js';
import createImageRoutes from './api/routes/image-routes.js';
import createHelpRoutes from './api/routes/help-routes.js';

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
    this.dataCollectionInterval = null;
    
    // EWCS 데이터 구조 (원래 ewcs.js와 동일한 필드)
    this.ewcsData = {
      stationName: "",
      timestamp: 0,
      // CS125 센서 데이터
      cs125Visibility: 0,
      cs125SYNOP: 0,
      cs125Temp: 0,
      cs125Humidity: 0,
      // 환경 센서 데이터
      SHT45Temp: 0,
      SHT45Humidity: 0,
      rpiTemp: 0,
      // 전력 모니터링 데이터 (ADC 채널)
      chan1Current: 0,  // CS125 전류
      chan2Current: 0,  // spinel 전류
      chan3Current: 0,  // oasc 전류
      chan4Current: 0,  // 기타 전류
      // 태양광 충전기 데이터
      PVVol: 0,
      PVCur: 0,
      LoadVol: 0,
      LoadCur: 0,
      BatTemp: 0,
      DevTemp: 0,
      ChargEquipStat: 0,
      DischgEquipStat: 0
    };
    
    // EWCS 상태 정보 (시스템 상태 추적용)
    this.ewcsStatus = {
      // 장치 연결 상태
      cs125Connected: 0,
      cameraConnected: 0,  // Spinel camera
      OASCConnected: 0,     // OASC camera
      EPEVERConnected: 0,
      ADCConnected: 0,
      SHT45Connected: 0,
      // 네트워크 정보
      ipAddress: "",
      gateway: ""
      // TODO: PIC24 제어 상태 (추후 구현 시 추가)
      // cs125OnStatus: 0,
      // cs125HoodHeaterStatus: 0,
      // cameraOnStatus: 0,
      // iridiumOnStatus: 0,
      // powerSaveOnStatus: 0
    };

    // Auto cleanup 초기화
    this.autoCleanup = new AutoDataCleanup();
  }

  async initialize() {
    try {
      console.log(`[${getTimestamp()}] EWCS Controller starting...`);

      // Log system start
      logManager.logSystemStart();

      // Get network information
      this.updateNetworkInfo();
      
      // Setup Express
      this.setupExpress();
      
      // Initialize database
      database.initialize();
      console.log(`[${getTimestamp()}] [DB] Database initialized`);
            
      // Initialize devices
      await this.initializeDevices();
      
      // Start periodic tasks (device health check, etc.) and wait for first check
      //await this.startPeriodicTasks();

      await this.checkDeviceHealth();
      
      // Setup API routes
      this.setupRoutes();
      
      // Start server first
      this.startServer();

      // Run initial data collection and image captures asynchronously after server start
      setTimeout(async () => {
        try {
          await this.runDataCollectionOnce();
          await this.runSpinelImageCaptureOnce();
          await this.runOASCImageCaptureOnce();
          console.log(`[${getTimestamp()}] Initial data and image collection completed`);
        } catch (error) {
          console.error('Initial collection error:', error);
        }
      }, 1000); // 1초 후 실행

      // Start auto cleanup schedule
      await this.startAutoCleanupSchedule();

      // Start time sync with PIC24
      this.startTimeSync();

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


  async initializeDevices() {
    // Initialize GPIO controller
    this.devices.gpio = GPIOController;
    await this.devices.gpio.initialize();

    // Initialize PIC24 controller
    this.devices.pic24 = new PIC24Controller(this);
    await this.devices.pic24.initialize(config.get('serialPorts.pic24'), 115200);

    // Initialize SHT45 sensor
    this.devices.sht45 = SHT45Sensor;
    await this.devices.sht45.initialize();

    // Initialize ADC reader
    this.devices.adc = ADCReader;
    await this.devices.adc.initialize();

    // Initialize CS125 sensor
    this.devices.cs125 = new CS125Sensor();
    await this.devices.cs125.initialize();

    // Initialize spinel camera
    this.devices.camera = new SpinelCamera(config.get('serialPorts.camera'), 115200);

    // Initialize EPEVER controller
    this.devices.epever = EPEVERController;
    await this.devices.epever.initialize();

    // Initialize OASC camera
    this.devices.oascCamera = new OASCCamera();
    await this.devices.oascCamera.initialize();
    

    console.log(`[${getTimestamp()}] Device initialization complete`);
  }

  setupRoutes() {
    // API routes - Pass database and app instance for EWCS control
    this.app.use('/api', createEwcsRoutes(database, this));
    this.app.use('/api/schedule', createScheduleRoutes(this));
    this.app.use('/api/image', createImageRoutes(database));
    this.app.use('/file/image', createImageRoutes(database));
    this.app.use('/api/help', createHelpRoutes());
    
    
    // Root endpoint
    this.app.get('/', (req, res) => {
      res.json({
        message: 'EWCS Controller API',
        version: '2.0.0',
        documentation: '/api/help',
        timestamp: Date.now()
      });
    });

    // Redirect /api to /api/help
    this.app.get('/api', (req, res) => {
      res.redirect('/api/help');
    });
  }

  async updateNetworkInfo() {
    try {
      // Get IP address
      const networkInterfaces = os.networkInterfaces();
      let ipAddress = '';

      // Find the first non-internal IPv4 address
      for (const interfaceName in networkInterfaces) {
        const interfaces = networkInterfaces[interfaceName];
        for (const iface of interfaces) {
          if (iface.family === 'IPv4' && !iface.internal) {
            ipAddress = iface.address;
            break;
          }
        }
        if (ipAddress) break;
      }

      // Get gateway
      let gateway = '';
      try {
        const { stdout } = await execAsync("ip route | grep default | awk '{print $3}'");
        gateway = stdout.trim();
      } catch (error) {
        console.log('[Network] Could not get gateway:', error.message);
      }

      this.ewcsStatus.ipAddress = ipAddress || 'N/A';
      this.ewcsStatus.gateway = gateway || 'N/A';

      console.log(`[${getTimestamp()}] [Network] IP: ${this.ewcsStatus.ipAddress}, Gateway: ${this.ewcsStatus.gateway}`);
    } catch (error) {
      console.error('[Network] Failed to get network info:', error);
      this.ewcsStatus.ipAddress = 'Error';
      this.ewcsStatus.gateway = 'Error';
    }
  }

  async runDataCollectionOnce() {
    try {
      console.log(`[${getTimestamp()}] [DB] Running initial data collection...`);

      // VOUT1 켜기
      if (this.devices.pic24) {
        await this.devices.pic24.turnOnVOUT(1);
        console.log('[DATA COLLECTION] VOUT1 turned ON for data collection');
        // 전원 안정화를 위해 5초 대기
        await new Promise(resolve => setTimeout(resolve, 5000));
        console.log('[DATA COLLECTION] 5 second wait completed after VOUT1 ON');
      }

      await this.updateEwcsData();
      database.insertEwcsData(this.ewcsData);
      console.log(`[${getTimestamp()}] [DB] Initial EWCS data saved to database`);

      // 작업 완료 후 VOUT1 끄기
      if (this.devices.pic24) {
        await this.devices.pic24.turnOffVOUT(1);
        console.log('[DATA COLLECTION] VOUT1 turned OFF after data collection');
      }

    } catch (error) {
      console.error('Initial data collection error:', error);
      logManager.logError('data_collection', error);

      // 에러 발생 시에도 VOUT1 끄기
      try {
        if (this.devices.pic24) {
          await this.devices.pic24.turnOffVOUT(1);
          console.log('[DATA COLLECTION] VOUT1 turned OFF after error');
        }
      } catch (voutError) {
        console.error('[DATA COLLECTION] Failed to turn off VOUT1 after error:', voutError.message);
      }
    }
  }

  // EWCS 데이터 업데이트 함수 (비동기)
  async updateEwcsData() {
    this.ewcsData.timestamp = Date.now();
    this.ewcsData.stationName = config.get('stationName');
    
    // CS125 센서 데이터
    try {
      if (this.ewcsStatus.cs125Connected === 1 && this.devices.cs125?.data) {
        console.log('[CS125] Connected - collecting data');
        this.ewcsData.cs125Visibility = this.devices.cs125.data.visibility || 0;
        this.ewcsData.cs125SYNOP = this.devices.cs125.data.synop || 0;
        this.ewcsData.cs125Temp = this.devices.cs125.data.temperature || 0;
        this.ewcsData.cs125Humidity = this.devices.cs125.data.humidity || 0;
      } else {
        console.log('[CS125] Not connected - using default values');
        this.ewcsData.cs125Visibility = 0;
        this.ewcsData.cs125SYNOP = 0;
        this.ewcsData.cs125Temp = 0;
        this.ewcsData.cs125Humidity = 0;
      }
    } catch (error) {
      console.log('[CS125] Data collection failed:', error.message);
      this.ewcsData.cs125Visibility = 0;
      this.ewcsData.cs125SYNOP = 0;
      this.ewcsData.cs125Temp = 0;
      this.ewcsData.cs125Humidity = 0;
    }
    
    // SHT45 환경 센서 데이터
    try {
      if (this.ewcsStatus.SHT45Connected === 1 && this.devices.sht45) {
        console.log('[SHT45] Connected - collecting data');
        await this.devices.sht45.updateSHT45(); // 데이터 업데이트 함수 호출
        const sht45Data = this.devices.sht45.getData();

        this.ewcsData.SHT45Temp = sht45Data.temperature || 0;
        this.ewcsData.SHT45Humidity = sht45Data.humidity || 0;
      } else {
        console.log('[SHT45] Not connected - using default values');
        this.ewcsData.SHT45Temp = 0;
        this.ewcsData.SHT45Humidity = 0;
      }
    } catch (error) {
      console.log('[SHT45] Data collection failed:', error.message);
      this.ewcsData.SHT45Temp = 0;
      this.ewcsData.SHT45Humidity = 0;
    }
    
    // ADC 전력 모니터링 데이터 (원래 ewcs.js 방식)
    try {
      if (this.ewcsStatus.ADCConnected === 1 && this.devices.adc) {
        console.log('[ADC] Connected - collecting power monitoring data');
        // 한 번의 readADC로 모든 채널 데이터 가져오기 (이미 변환된 값)
        const adcData = await this.devices.adc.getData();
        this.ewcsData.chan1Current = adcData.chan1Current || 0;
        this.ewcsData.chan2Current = adcData.chan2Current || 0;
        this.ewcsData.chan3Current = adcData.chan3Current || 0;
        this.ewcsData.chan4Current = adcData.chan4Current || 0;
      } else {
        console.log('[ADC] Not connected - using default values');
        this.ewcsData.chan1Current = 0;
        this.ewcsData.chan2Current = 0;
        this.ewcsData.chan3Current = 0;
        this.ewcsData.chan4Current = 0;
      }
    } catch (error) {
      console.log('[ADC] Data collection failed:', error.message);
      this.ewcsData.chan1Current = 0;
      this.ewcsData.chan2Current = 0;
      this.ewcsData.chan3Current = 0;
      this.ewcsData.chan4Current = 0;
    }
    
    // EPEVER 태양광 충전기 데이터 (실시간 수집)
    if (this.ewcsStatus.EPEVERConnected === 1 && this.devices.epever) {
      try {
        console.log('[EPEVER] Connected - collecting solar charger data');
        const epeverData = await this.devices.epever.getData();

        this.ewcsData.PVVol = epeverData.PVVol || 0;
        this.ewcsData.PVCur = epeverData.PVCur || 0;
        this.ewcsData.LoadVol = epeverData.LoadVol || 0;
        this.ewcsData.LoadCur = epeverData.LoadCur || 0;
        this.ewcsData.BatTemp = epeverData.BatTemp || 0;
        this.ewcsData.DevTemp = epeverData.DevTemp || 0;
        this.ewcsData.ChargEquipStat = epeverData.ChargEquipStat || 0;
        this.ewcsData.DischgEquipStat = epeverData.DischgEquipStat || 0;
      } catch (error) {
        console.log('[EPEVER] Data collection failed:', error.message);
        // 예외 발생 시 기본값 사용
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
      console.log('[EPEVER] Not connected - using default values');
      this.ewcsData.PVVol = 0;
      this.ewcsData.PVCur = 0;
      this.ewcsData.LoadVol = 0;
      this.ewcsData.LoadCur = 0;
      this.ewcsData.BatTemp = 0;
      this.ewcsData.DevTemp = 0;
      this.ewcsData.ChargEquipStat = 0;
      this.ewcsData.DischgEquipStat = 0;
    }
    
    // RPi CPU 온도
    try {
      this.ewcsData.rpiTemp = this.getRPiTemperature();
    } catch (error) {
      console.log('[RPI] Temperature reading failed:', error.message);
      this.ewcsData.rpiTemp = 0;
    }

  }

  /**
   * RPi CPU 온도 읽기 (원본 ewcs.js의 readTemp() 함수 구현)
   * /sys/class/thermal/thermal_zone0/temp 파일에서 온도 데이터를 읽어옴
   * @returns {number} CPU 온도 (섭씨)
   */
  getRPiTemperature() {
    try {
      const tempRaw = fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8');
      const tempMilliCelsius = parseInt(tempRaw.trim());
      const tempCelsius = tempMilliCelsius / 1000;
      return parseFloat(tempCelsius.toFixed(1));
    } catch (error) {
      console.error('[RPI] Failed to read CPU temperature:', error.message);
      return 0;
    }
  }

  // 원래 startImageCollection 함수 (주석처리 - 나중에 참고용)
  /*
  startImageCollection() {
    const imagePeriod = config.get('imageSavePeriod') * 1000;

    const captureImage = async () => {
      try {
        // Spinel Camera 촬영
        if (this.devices.camera) {
          console.log(`[${getTimestamp()}] [SPINEL] Capture started`);
          try {
            await this.turnOnCamera();
            await new Promise(resolve => setTimeout(resolve, 2000));
          } catch (error) {
            console.log(`[${getTimestamp()}] [CAMERA] PIC24 turn on failed, but continuing: ${error.message}`);
          }

          const captureResult = await this.devices.camera.startCapture();
          if (captureResult.success) {
            console.log(`[${getTimestamp()}] [CAMERA] ✅ Spinel saved: ${captureResult.filename}`);
            if (captureResult.filename && captureResult.savedPath) {
              database.insertImageData({
                timestamp: Date.now(),
                filename: captureResult.filename,
                camera: 'spinel'
              });
              console.log(`[${getTimestamp()}] [DB] Spinel image data saved: ${captureResult.filename}`);
              }
          } else {
            console.error(`[CAMERA] Spinel capture failed: ${captureResult.reason}`);
          }

          setTimeout(async () => {
            try {
              await this.turnOffCamera();
            } catch (error) {
              console.log(`[${getTimestamp()}] [CAMERA] PIC24 turn off failed: ${error.message}`);
            }
          }, 30000);
        } else {
          console.log('[CAMERA] Spinel camera disconnected - skipping spinel capture');
        }

        // OASC Camera 촬영
        if (this.devices.oascCamera) {
          console.log('[OASC] OASC camera connected - starting capture');
          const captureResult = await this.devices.oascCamera.captureImage();
          if (captureResult.success) {
            console.log(`[OASC] Image captured and saved: ${captureResult.filename}`);
            if (captureResult.filename && captureResult.savedPath) {
              database.insertOascImageData({
                timestamp: Date.now(),
                filename: captureResult.filename
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
        logManager.logError('camera_capture', cameraError);
        await this.turnOffCamera();
      }

      setTimeout(captureImage, imagePeriod);
    };

    setTimeout(captureImage, imagePeriod);
    console.log(`Image collection started (${imagePeriod/1000}s interval)`);
  }
  */

  async runSpinelImageCaptureOnce() {
    try {
      // Spinel Camera 촬영
      //if (this.ewcsStatus.cameraConnected === 1 && this.devices.camera) {

      // less strict spinel image capture
      if (this.devices.camera) {

        console.log(`[${getTimestamp()}] [SPINEL] Initial capture started`);

        // vout2 켜기
        if (this.devices.pic24) {
          await this.devices.pic24.turnOnVOUT(2);
          console.log('[SPINEL] VOUT2 turned ON for Spinel capture');
          // 전원 안정화를 위해 5초 대기
          await new Promise(resolve => setTimeout(resolve, 5000));
          console.log('[SPINEL] 5 second wait completed after VOUT2 ON');
        }

        const captureResult = await this.devices.camera.startCapture();
        if (captureResult.success) {
          console.log(`[${getTimestamp()}] [CAMERA] ✅ Initial Spinel saved: ${captureResult.filename}`);
          console.log(`[${getTimestamp()}] [DEBUG] Spinel captureResult:`, JSON.stringify(captureResult, null, 2));
          // 파일 저장이 완료된 후에만 데이터베이스에 저장
          if (captureResult.filename && captureResult.savedPath) {
            // 파일명에서 timestamp 추출
            const filenameTimestamp = parseInt(captureResult.filename.replace('.jpg', '')) || Date.now();
            database.insertImageData({
              timestamp: filenameTimestamp,
              filename: captureResult.filename
            });
            console.log(`[${getTimestamp()}] [DB] Initial Spinel image data saved: ${captureResult.filename}`);

            // 캡처 완료 후 vout2 끄기
            if (this.devices.pic24) {
              await this.devices.pic24.turnOffVOUT(2);
              //console.log('[SPINEL] VOUT2 turned OFF after capture');
            }

            return { success: true, filename: captureResult.filename, message: `Image captured and saved to database: ${captureResult.filename}` };
          }
        } else {
          console.error(`[CAMERA] Initial Spinel capture failed: ${captureResult.reason}`);

          // 실패 시에도 vout2 끄기
          if (this.devices.pic24) {
            await this.devices.pic24.turnOffVOUT(2);
            //console.log('[SPINEL] VOUT2 turned OFF after capture failure');
          }

          return { success: false, reason: captureResult.reason };
        }
      } else {
        console.log('[CAMERA] Spinel camera not connected - skipping initial spinel capture');
        return { success: false, reason: 'camera_not_connected' };
      }
    } catch (cameraError) {
      console.error('[CAMERA] Initial Spinel capture failed:', cameraError.message);
      logManager.logError('camera_capture', cameraError);

      // 에러 발생 시에도 vout2 끄기
      try {
        if (this.devices.pic24) {
          await this.devices.pic24.turnOffVOUT(2);
          //console.log('[SPINEL] VOUT2 turned OFF after error');
        }
      } catch (voutError) {
        console.error('[SPINEL] Failed to turn off VOUT2 after error:', voutError.message);
      }

      return { success: false, reason: 'capture_error', error: cameraError.message };
    }
  }

  async runOASCImageCaptureOnce() {
    try {
      // OASC Camera 촬영 - 연결 상태 확인 전에 직접 연결 시도
      if (this.devices.oascCamera) {
        console.log('[OASC] Initial OASC camera capture started');

        // vout3 켜기
        if (this.devices.pic24) {
          await this.devices.pic24.turnOnVOUT(3);
          console.log('[OASC] VOUT3 turned ON for OASC capture');
          // 전원 안정화를 위해 3초 대기
          await new Promise(resolve => setTimeout(resolve, 3000));
          console.log('[OASC] 3 second wait completed after VOUT3 ON');
        }

        // USB 연결 해제 후 재연결 시도
        console.log('[OASC] Disconnecting USB for fresh connection before capture...');
        await this.devices.oascCamera.disconnect();

        // 잠시 대기 후 재연결
        await new Promise(resolve => setTimeout(resolve, 1000));
        console.log('[OASC] Attempting fresh USB connection for capture...');
        const isConnected = await this.devices.oascCamera.connect();

        if (!isConnected) {
          console.error('[OASC] Failed to connect OASC camera for capture');

          // 연결 실패 시 vout3 끄기
          if (this.devices.pic24) {
            await this.devices.pic24.turnOffVOUT(3);
            console.log('[OASC] VOUT3 turned OFF after connection failure');
          }

          return { success: false, reason: 'connection_failed' };
        }

        // 매번 최신 노출 시간 가져오기
        const oascExposureTime = config.get('oascExposureTime');
        const captureResult = await this.devices.oascCamera.captureImage(oascExposureTime);
        if (captureResult.success) {
          console.log(`[OASC] Initial image captured and saved: ${captureResult.filename}`);
          // 파일 저장이 완료된 후에만 데이터베이스에 저장
          if (captureResult.filename && captureResult.savedPath) {
            // 파일명에서 timestamp 추출
            const filenameTimestamp = parseInt(captureResult.filename.replace('.jpg', '')) || Date.now();
            database.insertOascImageData({
              timestamp: filenameTimestamp,
              filename: captureResult.filename
            });
            console.log(`[DB] Initial OASC image data saved: ${captureResult.filename}`);

            // DB 저장까지 완료 후 USB 연결 해제
            console.log('[OASC] Disconnecting USB after DB save...');
            await this.devices.oascCamera.disconnect();

            // 캡처 완료 후 vout3 끄기
            if (this.devices.pic24) {
              await this.devices.pic24.turnOffVOUT(3);
              console.log('[OASC] VOUT3 turned OFF after capture');
            }

            return { success: true, filename: captureResult.filename, message: `OASC image captured and saved to database: ${captureResult.filename}` };
          }
        } else {
          console.error(`[OASC] Initial capture failed: ${captureResult.reason}`);

          // 캡처 실패 시에도 USB 연결 해제
          console.log('[OASC] Disconnecting USB after capture failure...');
          await this.devices.oascCamera.disconnect();

          // 실패 시에도 vout3 끄기
          if (this.devices.pic24) {
            await this.devices.pic24.turnOffVOUT(3);
            console.log('[OASC] VOUT3 turned OFF after capture failure');
          }

          return { success: false, reason: captureResult.reason };
        }
      } else {
        console.log('[OASC] OASC camera device not available - skipping initial OASC capture');
        return { success: false, reason: 'camera_not_available' };
      }
    } catch (cameraError) {
      console.error('[OASC] Initial OASC capture failed:', cameraError.message);
      logManager.logError('oasc_camera_capture', cameraError);

      // 에러 발생 시 USB 연결 해제 시도
      try {
        console.log('[OASC] Disconnecting USB after error...');
        await this.devices.oascCamera.disconnect();
      } catch (disconnectError) {
        console.error('[OASC] Failed to disconnect USB after error:', disconnectError.message);
      }

      // 에러 발생 시에도 vout3 끄기
      try {
        if (this.devices.pic24) {
          await this.devices.pic24.turnOffVOUT(3);
          console.log('[OASC] VOUT3 turned OFF after error');
        }
      } catch (voutError) {
        console.error('[OASC] Failed to turn off VOUT3 after error:', voutError.message);
      }

      return { success: false, reason: 'capture_error', error: cameraError.message };
    }
  }

  // PIC24 관련 함수 - 카메라 전원 제어
  async turnOnCamera() {
    if (!this.devices.pic24) {
      throw new Error('PIC24 controller not available for camera power control');
    }

    try {
      await this.devices.pic24.cameraOn(); // PIC24에 카메라 ON 명령 전송 (VOUT1_ON)
      logManager.logCameraPower(true);
      console.log('[CAMERA] Power ON via PIC24');
      return { success: true };
    } catch (error) {
      console.error('[CAMERA] Failed to turn on camera:', error);
      logManager.logError('camera', error);
      throw error;
    }
  }

  async turnOffCamera() {
    if (!this.devices.pic24) {
      throw new Error('PIC24 controller not available for camera power control');
    }

    try {
      await this.devices.pic24.cameraOff(); // PIC24에 카메라 OFF 명령 전송 (VOUT1_OFF)
      logManager.logCameraPower(false);
      console.log('[CAMERA] Power OFF via PIC24');
      return { success: true };
    } catch (error) {
      console.error('[CAMERA] Failed to turn off camera:', error);
      logManager.logError('camera', error);
      throw error;
    }
  }

  // PIC24 관련 함수 - CS125 전원 제어
  async turnOnCS125() {
    if (!this.devices.pic24) {
      throw new Error('PIC24 controller not available for CS125 power control');
    }

    try {
      await this.devices.pic24.cs125On(); // PIC24에 CS125 ON 명령 전송 (VOUT2_ON)
      console.log('[CS125] Power ON via PIC24');
      return { success: true };
    } catch (error) {
      console.error('[CS125] Failed to turn on CS125:', error);
      logManager.logError('cs125', error);
      throw error;
    }
  }

  async turnOffCS125() {
    if (!this.devices.pic24) {
      throw new Error('PIC24 controller not available for CS125 power control');
    }

    try {
      await this.devices.pic24.cs125Off(); // PIC24에 CS125 OFF 명령 전송 (VOUT2_OFF)
      console.log('[CS125] Power OFF via PIC24');
      return { success: true };
    } catch (error) {
      console.error('[CS125] Failed to turn off CS125:', error);
      logManager.logError('cs125', error);
      throw error;
    }
  }

  // PIC24 관련 함수 - CS125 후드 히터 제어
  async setCS125HoodHeater(enable) {
    if (!this.devices.pic24) {
      throw new Error('PIC24 controller not available for CS125 hood heater control');
    }

    try {
      if (enable) {
        await this.devices.pic24.heaterOn(); // PIC24에 히터 ON 명령 전송 (VOUT3_ON)
      } else {
        await this.devices.pic24.heaterOff(); // PIC24에 히터 OFF 명령 전송 (VOUT3_OFF)
      }
      console.log(`[CS125] Hood heater ${enable ? 'ON' : 'OFF'} via PIC24`);
      return { success: true };
    } catch (error) {
      console.error(`[CS125] Failed to turn ${enable ? 'on' : 'off'} hood heater:`, error);
      logManager.logError('cs125_hood_heater', error);
      throw error;
    }
  }

  // 카메라 연결 테스트 (0x01 테스트 명령 사용)

  // 개별 디바이스 체크 함수들
  async checkCS125Connection() {
    if (!this.devices.cs125) {
      this.ewcsStatus.cs125Connected = 0;
      console.log(`[${getTimestamp()}] [STATUS] CS125 Connected: ${this.ewcsStatus.cs125Connected}`);
      return false;
    }
    try {
      const isConnected = await this.devices.cs125.checkConnection();
      this.ewcsStatus.cs125Connected = isConnected ? 1 : 0;
      console.log(`[${getTimestamp()}] [STATUS] CS125 Connected: ${this.ewcsStatus.cs125Connected}`);
      return isConnected;
    } catch (e) {
      this.ewcsStatus.cs125Connected = 0;
      console.log(`[${getTimestamp()}] [STATUS] CS125 Connected: ${this.ewcsStatus.cs125Connected}`);
      return false;
    }
  }

  async checkSpinelCameraConnection() {
    //console.log(`[DEBUG] checkSpinelCameraConnection - camera exists? ${!!this.devices.camera}`);
    if (!this.devices.camera) {
      this.ewcsStatus.cameraConnected = 0;
      console.log(`[${getTimestamp()}] [STATUS] Camera Connected: ${this.ewcsStatus.cameraConnected}`);
      return false;
    }
    try {
      //console.log(`[DEBUG] Camera checkConnection calling...`);
      const isConnected = await this.devices.camera.checkConnection();
      //console.log(`[DEBUG] Camera checkConnection returned: ${isConnected}`);
      this.ewcsStatus.cameraConnected = isConnected ? 1 : 0;
      console.log(`[${getTimestamp()}] [STATUS] Camera Connected: ${this.ewcsStatus.cameraConnected}`);
      return isConnected;
    } catch (e) {
      //console.log(`[DEBUG] Camera checkConnection error: ${e.message}`);
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
      // USB 연결 해제 후 재연결 시도
      console.log('[OASC] Disconnecting USB for fresh connection...');
      await this.devices.oascCamera.disconnect();

      // 잠시 대기 후 재연결
      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log('[OASC] Attempting fresh USB connection...');
      const isConnected = await this.devices.oascCamera.connect();

      // 연결 성공 시 추가 검증
      if (isConnected) {
        const connectionVerified = await this.devices.oascCamera.checkConnection();
        this.ewcsStatus.OASCConnected = connectionVerified ? 1 : 0;
      } else {
        this.ewcsStatus.OASCConnected = 0;
      }

      console.log(`[${getTimestamp()}] [STATUS] OASC Connected: ${this.ewcsStatus.OASCConnected}`);

      // 연결 확인 완료 후 USB 해제
      await this.devices.oascCamera.disconnect();
      console.log('[OASC] USB disconnected after connection check');

      return this.ewcsStatus.OASCConnected === 1;
    } catch (e) {
      console.error('[OASC] Connection check error:', e.message);
      this.ewcsStatus.OASCConnected = 0;
      console.log(`[${getTimestamp()}] [STATUS] OASC Connected: ${this.ewcsStatus.OASCConnected}`);

      // 에러 시에도 연결 해제 시도
      try {
        await this.devices.oascCamera.disconnect();
      } catch (disconnectError) {
        console.error('[OASC] Failed to disconnect after error:', disconnectError.message);
      }

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


  // 전체 디바이스 헬스 체크
  async checkDeviceHealth() {
    try {
      // VOUT 1, 2, 3 켜기
      if (this.devices.pic24) {
        // REASON: PIC24 needs time to process each command before accepting the next one
        // IMPACT: Prevents timeout errors when sending multiple VOUT commands in sequence
        await this.devices.pic24.turnOnVOUT(1);
        await new Promise(resolve => setTimeout(resolve, 100)); // Wait for PIC24 to process
        await this.devices.pic24.turnOnVOUT(2);
        await new Promise(resolve => setTimeout(resolve, 100)); // Wait for PIC24 to process
        await this.devices.pic24.turnOnVOUT(3);
        await new Promise(resolve => setTimeout(resolve, 100)); // Wait for PIC24 to process
        await this.devices.pic24.turnOnVOUT(4);
        console.log('[DEVICE HEALTH] VOUT 1, 2, 3, 4 turned ON for device health check');
        // 전원 안정화를 위해 5초 대기
        await new Promise(resolve => setTimeout(resolve, 5000));
        console.log('[DEVICE HEALTH] 5 second wait completed after VOUT ON');
      }

      const deviceStatus = {
        cs125: await this.checkCS125Connection(),
        spinel_camera: await this.checkSpinelCameraConnection(),
        oasc_camera: await this.checkOASCCameraConnection(),
        epever: await this.checkEPEVERConnection(),
        sht45: await this.checkSHT45Connection(),
        adc: await this.checkADCConnection()
      };

      // 장치 확인 완료 후 VOUT 1, 2, 3 끄기
      if (this.devices.pic24) {
        // REASON: PIC24 needs time to process each command before accepting the next one
        // IMPACT: Prevents timeout errors when sending multiple VOUT commands in sequence
        await this.devices.pic24.turnOffVOUT(1);
        await new Promise(resolve => setTimeout(resolve, 100)); // Wait for PIC24 to process
        await this.devices.pic24.turnOffVOUT(2);
        await new Promise(resolve => setTimeout(resolve, 100)); // Wait for PIC24 to process
        await this.devices.pic24.turnOffVOUT(3);
        await new Promise(resolve => setTimeout(resolve, 100)); // Wait for PIC24 to process
        await this.devices.pic24.turnOffVOUT(4);
        console.log('[DEVICE HEALTH] VOUT 1, 2, 3, 4 turned OFF after device health check');
      }

      return deviceStatus;

    } catch (error) {
      console.error('Device health check error:', error);

      // 에러 발생 시에도 VOUT 1, 2, 3 끄기
      try {
        if (this.devices.pic24) {
          // REASON: PIC24 needs time to process each command before accepting the next one
          // IMPACT: Prevents timeout errors when sending multiple VOUT commands in sequence
          await this.devices.pic24.turnOffVOUT(1);
          await new Promise(resolve => setTimeout(resolve, 100)); // Wait for PIC24 to process
          await this.devices.pic24.turnOffVOUT(2);
          await new Promise(resolve => setTimeout(resolve, 100)); // Wait for PIC24 to process
          await this.devices.pic24.turnOffVOUT(3);
          await new Promise(resolve => setTimeout(resolve, 100)); // Wait for PIC24 to process
          await this.devices.pic24.turnOffVOUT(4);

          console.log('[DEVICE HEALTH] VOUT 1, 2, 3, 4 turned OFF after error');
        }
      } catch (voutError) {
        console.error('[DEVICE HEALTH] Failed to turn off VOUTs after error:', voutError.message);
      }

      // 에러 시 기본값 반환
      return {
        cs125: false,
        spinel_camera: false,
        oasc_camera: false,
        epever: false,
        sht45: false,
        adc: false
      };
    }
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
    logManager.logSystemShutdown();

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

      // Close PIC24 controller
      if (this.devices.pic24) {
        await this.devices.pic24.close();
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

  // PIC24와 시간 동기화 (시스템 시작 시 한번만)
  async startTimeSync() {
    try {
      if (this.devices.pic24 && this.devices.pic24.isConnected) {
        console.log(`[${getTimestamp()}] [TIME SYNC] Starting time sync with PIC24...`);
        const timeData = await this.devices.pic24.sendSyncData();

        if (timeData) {
          console.log(`[${getTimestamp()}] [TIME SYNC] Time sync completed successfully`);

          // 시스템 시간 확인
          const { exec } = await import('child_process');
          exec('date "+%Y-%m-%d %H:%M:%S %Z"', (err, currentTime) => {
            if (!err) {
              console.log(`[${getTimestamp()}] [TIME SYNC] Verification - Current system time: ${currentTime.trim()}`);
            }
          });
        } else {
          console.log(`[${getTimestamp()}] [TIME SYNC] No valid time data received from PIC24`);
        }
      } else {
        console.log(`[${getTimestamp()}] [TIME SYNC] PIC24 not connected, skipping time sync`);
      }
    } catch (error) {
      console.error(`[${getTimestamp()}] [TIME SYNC] Time sync error:`, error.message);
    }
  }

  startAutoCleanupSchedule() {
    // 매일 새벽 3시에 자동 정리 실행
    const scheduleCleanup = () => {
      const now = new Date();
      const next3AM = new Date(now);
      next3AM.setHours(3, 0, 0, 0);

      // 오늘 3시가 이미 지났으면 내일 3시로
      if (next3AM <= now) {
        next3AM.setDate(next3AM.getDate() + 1);
      }

      const timeUntilNext = next3AM.getTime() - now.getTime();

      setTimeout(async () => {
        try {
          console.log(`[${getTimestamp()}] [CLEANUP] Starting scheduled cleanup...`);
          const result = await this.autoCleanup.executeAutoCleanup();

          if (result.executed) {
            console.log(`[${getTimestamp()}] [CLEANUP] ✅ Cleanup completed: ${result.cleanupResult?.deletedFiles || 0} files deleted`);
          } else {
            console.log(`[${getTimestamp()}] [CLEANUP] ℹ️ Cleanup skipped: ${result.reason}`);
          }

          // 다음날 스케줄 설정
          scheduleCleanup();
        } catch (error) {
          console.error(`[${getTimestamp()}] [CLEANUP] ❌ Cleanup failed:`, error);
          // 에러가 있어도 다음날 스케줄은 설정
          scheduleCleanup();
        }
      }, timeUntilNext);

      console.log(`[${getTimestamp()}] [CLEANUP] Next cleanup scheduled at: ${next3AM.toISOString()}`);
    };

    scheduleCleanup();
  }

  // 주기적 작업 시작 (checkDeviceHealth 포함)
  async startPeriodicTasks(intervalSeconds = 60) {
    // 즉시 한 번 실행하고 완료 기다림
    await this.checkDeviceHealth();

    // 지정된 초마다 반복 실행
    this.periodicTasksInterval = setInterval(async () => {
      try {
        console.log(`[${getTimestamp()}] [PERIODIC] Running periodic device health check...`);
        await this.checkDeviceHealth();
      } catch (error) {
        console.error(`[${getTimestamp()}] [PERIODIC] Error during periodic tasks:`, error);
        logManager.logError('periodic_tasks', error);
      }
    }, intervalSeconds * 1000);

    console.log(`[${getTimestamp()}] [PERIODIC] Periodic device health check started (${intervalSeconds}s interval)`);
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
