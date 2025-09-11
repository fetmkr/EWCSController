#!/usr/bin/env node
/**
 * EWCS Device Health Check Script
 * 디바이스 연결 상태만 빠르게 체크하는 스크립트
 */

import config from '../config/app-config.js';
import { SerialPort } from 'serialport';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Device modules
import CS125Sensor from '../devices/cs125-sensor.js';
import SpinelCamera from '../devices/spinel-serial-camera.js';
import EPEVERController from '../devices/epever-controller.js';
import SHT45Sensor from '../devices/sht45-sensor.js';
import GPIOController from '../devices/gpio-controller.js';
import ADCReader from '../devices/adc-reader.js';
import OASCCamera from '../devices/oasc-camera.js';
import sht45Sensor from '../devices/sht45-sensor.js';

class DeviceHealthChecker {
  constructor() {
    this.devices = {};
    this.controlPort = null;
    this.scriptsDir = __dirname;
  }

  async initialize() {
    console.log('🔍 EWCS Device Health Checker Starting...\n');
    
    // Initialize control port (PIC24)
    try {
      this.controlPort = new SerialPort({
        path: config.get('serialPorts.pic24'),
        baudRate: 9600
      });
      console.log('✅ Control port initialized');
    } catch (error) {
      console.log('❌ Control port initialization failed:', error.message);
    }

    // Initialize devices (minimal initialization)
    await this.initializeDevices();
  }

  async initializeDevices() {
    console.log('\n📋 Initializing devices...');

    // Initialize GPIO controller
    try {
      this.devices.gpio = GPIOController;
      await this.devices.gpio.initialize();
      console.log('✅ GPIO Controller initialized');
    } catch (error) {
      console.log('❌ GPIO initialization failed:', error.message);
    }

    // Initialize SHT45 sensor
    try {
      this.devices.sht45 = SHT45Sensor;
      await this.devices.sht45.initialize();
      console.log('✅ SHT45 Sensor initialized');
    } catch (error) {
      console.log('❌ SHT45 initialization failed:', error.message);
    }

    // Initialize ADC reader
    try {
      this.devices.adc = ADCReader;
      await this.devices.adc.initialize();
      console.log('✅ ADC Reader initialized');
    } catch (error) {
      console.log('❌ ADC initialization failed:', error.message);
    }

    // Initialize CS125 sensor
    try {
      this.devices.cs125 = new CS125Sensor();
      await this.devices.cs125.initialize();
      console.log('✅ CS125 Sensor initialized');
    } catch (error) {
      console.log('❌ CS125 initialization failed:', error.message);
      this.devices.cs125 = null;
    }

    // Initialize spinel camera
    try {
      this.devices.camera = new SpinelCamera(config.get('serialPorts.camera'), 115200);
      console.log('✅ Spinel Camera initialized');
    } catch (error) {
      console.log('❌ Spinel Camera initialization failed:', error.message);
      this.devices.camera = null;
    }

    // Initialize EPEVER controller
    try {
      this.devices.epever = EPEVERController;
      await this.devices.epever.initialize();
      console.log('✅ EPEVER Controller initialized');
    } catch (error) {
      console.log('❌ EPEVER initialization failed:', error.message);
    }

    // Initialize OASC camera
    try {
      this.devices.oascCamera = new OASCCamera();
      await this.devices.oascCamera.initialize();
      
      // Try to connect to camera
      const connected = await this.devices.oascCamera.connect();
      if (connected) {
        console.log('✅ OASC Camera initialized and connected');
      } else {
        console.log('✅ OASC Camera initialized but connection failed');
      }
    } catch (error) {
      console.log('❌ OASC Camera initialization failed:', error.message);
    }
  }

  // Individual device check functions
  async checkCS125Connection() {
    if (!this.devices.cs125) return false;
    try {
      return await this.devices.cs125.checkConnection();
    } catch (e) {
      return false;
    }
  }

  async checkSpinelCameraConnection() {
    if (!this.devices.camera) return false;
    try {
      return await this.devices.camera.checkConnection();
    } catch (e) {
      return false;
    }
  }

  async checkOASCCameraConnection() {
    if (!this.devices.oascCamera) return false;
    try {
      return await this.devices.oascCamera.checkConnection();
    } catch (e) {
      return false;
    }
  }

  async checkEPEVERConnection() {
    if (!this.devices.epever) return false;
    try {
      return await this.devices.epever.checkConnection();
    } catch (e) {
      return false;
    }
  }

  async checkSHT45Connection() {
    if (!this.devices.sht45) return false;
    try {
      return await this.devices.sht45.checkConnection();
    } catch (e) {
      return false;
    }
  }

  async checkADCConnection() {
    if (!this.devices.adc) return false;
    try {
      return await this.devices.adc.checkConnection();
    } catch (e) {
      return false;
    }
  }

  // Main device health check function
  async checkDeviceHealth() {
    console.log('\n🔍 Checking device connections...\n');

    const deviceStatus = {
      cs125: await this.checkCS125Connection(),
      spinel_camera: await this.checkSpinelCameraConnection(),
      oasc_camera: await this.checkOASCCameraConnection(),
      epever: await this.checkEPEVERConnection(),
      sht45: await this.checkSHT45Connection(),
      adc: await this.checkADCConnection()
    };

    // Display connection results
    console.log('📊 Device Health Check Results:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    let connectedCount = 0;
    for (const [device, connected] of Object.entries(deviceStatus)) {
      const status = connected ? '✅ Connected' : '❌ Disconnected';
      const name = device.replace('_', ' ').toUpperCase();
      console.log(`${name.padEnd(15)} : ${status}`);
      if (connected) connectedCount++;
    }
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Total: ${connectedCount}/6 devices connected\n`);

    // Collect data from connected devices
    await this.collectDeviceData(deviceStatus);

    // Capture images from connected cameras
    await this.captureImages(deviceStatus);

    return deviceStatus;
  }

  async collectDeviceData(deviceStatus) {
    console.log('📊 Collecting data from connected devices...\n');

    // CS125 data
    if (deviceStatus.cs125 && this.devices.cs125) {
      try {
        const cs125Data = this.devices.cs125.getData();
        console.log('🌨️  CS125 SENSOR DATA:');
        console.log(`   Visibility: ${cs125Data.visibility}m`);
        console.log(`   SYNOP: ${cs125Data.synop}`);
        console.log(`   Temperature: ${cs125Data.temperature}°C`);
        console.log(`   Humidity: ${cs125Data.humidity}%RH`);
        console.log(`   Last Reading: ${cs125Data.lastReading ? new Date(cs125Data.lastReading).toLocaleString() : 'Never'}\n`);
      } catch (error) {
        console.log('❌ Failed to get CS125 data:', error.message);
      }
    }

    // EPEVER data
    if (deviceStatus.epever && this.devices.epever) {
      try {
        const epeverData = await this.devices.epever.getData();
        console.log('🔋 EPEVER SOLAR CHARGER DATA:');
        console.log(`   PV Voltage: ${epeverData.PVVol}V`);
        console.log(`   PV Current: ${epeverData.PVCur}A`);
        console.log(`   PV Power: ${epeverData.PVPower}W`);
        console.log(`   Battery Voltage: ${epeverData.BatVol}V`);
        console.log(`   Battery SOC: ${epeverData.BatSOC}%`);
        console.log(`   Battery Temperature: ${epeverData.BatTemp}°C`);
        console.log(`   Device Temperature: ${epeverData.DevTemp}°C`);
        console.log(`   Load Voltage: ${epeverData.LoadVol}V`);
        console.log(`   Load Current: ${epeverData.LoadCur}A`);
        console.log(`   Load Power: ${epeverData.LoadPower}W`);
        console.log(`   Last Update: ${epeverData.lastUpdate ? new Date(epeverData.lastUpdate).toLocaleString() : 'Never'}\n`);
      } catch (error) {
        console.log('❌ Failed to get EPEVER data:', error.message);
      }
    }

    // SHT45 data
    if (deviceStatus.sht45 && this.devices.sht45) {
      try {
        await this.devices.sht45.updateSHT45();
        const sht45Data = this.devices.sht45.getData();
        console.log('🌡️  SHT45 ENVIRONMENTAL SENSOR DATA:');
        console.log(`   Temperature: ${sht45Data.temperature}°C`);
        console.log(`   Humidity: ${sht45Data.humidity}%RH`);
        console.log(`   Last Reading: ${sht45Data.lastReading ? new Date(sht45Data.lastReading).toLocaleString() : 'Never'}\n`);
      } catch (error) {
        console.log('❌ Failed to get SHT45 data:', error.message);
      }
    }

    // ADC data
    if (deviceStatus.adc && this.devices.adc) {
      try {
        console.log('⚡ ADC POWER MONITORING DATA:');
        const ch1Data = await this.devices.adc.getChannelData(0);
        const ch2Data = await this.devices.adc.getChannelData(1);
        const ch3Data = await this.devices.adc.getChannelData(2);
        const ch4Data = await this.devices.adc.getChannelData(3);

        
        console.log(`   Channel 1: ${ch1Data?.data.convertedValue || 0}mA`);
        console.log(`   Channel 2: ${ch2Data?.data.convertedValue || 0}mA`);
        console.log(`   Channel 3: ${ch3Data?.data.convertedValue || 0}mA`);
        console.log(`   Channel 4: ${ch4Data?.data.convertedValue || 0}mA\n`);

      } catch (error) {
        console.log('❌ Failed to get ADC data:', error.message);
      }
    }
  }

  async captureImages(deviceStatus) {
    console.log('📸 Capturing images from connected cameras...\n');

    const timestamp = Date.now();

    // Spinel Camera capture
    if (deviceStatus.spinel_camera && this.devices.camera) {
      try {
        console.log('📷 Capturing image from Spinel Camera...');
        
        // Turn on camera via PIC24
        if (this.controlPort) {
          this.controlPort.write('P');
          console.log('   Camera power ON via PIC24');
          await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for camera boot
        }
        
        const spinelFilename = `${timestamp}_spinel`;
        const captureResult = await this.devices.camera.startCapture(100, this.scriptsDir, spinelFilename);
        if (captureResult.success) {
          console.log(`   ✅ Spinel image captured and saved: ${captureResult.filename}`);
          console.log(`   💾 파일 저장 완료 - DB 업데이트 가능`);
          console.log('   ⏰ Waiting for capture to complete...');
          
          // Wait for capture to complete (up to 45 seconds)
          let waitCount = 0;
          const maxWait = 45; // 45 seconds
          
          while (waitCount < maxWait) {
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
            waitCount++;
            
            // Check if image was saved by looking for the file
            const fs = await import('fs');
            const path = await import('path');
            const expectedPath = path.default.join(this.scriptsDir, '2025-08', `${spinelFilename}.jpg`);
            
            if (fs.default.existsSync(expectedPath)) {
              console.log(`   ✅ Spinel image saved successfully after ${waitCount} seconds!`);
              break;
            }
            
            if (waitCount % 10 === 0) {
              console.log(`   ⏳ Still waiting... (${waitCount}/${maxWait}s)`);
            }
          }
          
          if (waitCount >= maxWait) {
            console.log(`   ⚠️ Spinel capture timed out after ${maxWait} seconds`);
          }
        } else {
          console.log('   ❌ Spinel camera capture failed:', captureResult.reason);
        }
        
        // Turn off camera
        if (this.controlPort) {
          this.controlPort.write('p');
          console.log('   Camera power OFF via PIC24');
        }
        
      } catch (error) {
        console.log('   ❌ Spinel camera capture error:', error.message);
      }
    }

    // OASC Camera capture  
    if (deviceStatus.oasc_camera && this.devices.oascCamera) {
      try {
        console.log('📷 Capturing image from OASC Camera...');
        
        const oascFilename = `${timestamp}_oasc`;
        const captureResult = await this.devices.oascCamera.captureImage(oascFilename, this.scriptsDir);
        
        if (captureResult.success) {
          console.log(`   ✅ OASC image captured and saved: ${captureResult.filename}`);
          console.log(`   💾 파일 저장 완료 - DB 업데이트 가능`);
        } else {
          console.log('   ❌ OASC camera capture failed:', captureResult.reason || captureResult.error);
        }
      } catch (error) {
        console.log('   ❌ OASC camera capture error:', error.message);
      }
    }

    if (!deviceStatus.spinel_camera && !deviceStatus.oasc_camera) {
      console.log('   ⚠️  No cameras connected - skipping image capture');
    }

    console.log();
  }

  async close() {
    console.log('🛑 Closing connections...');
    
    // Close devices
    for (const [name, device] of Object.entries(this.devices)) {
      try {
        if (device && device.close) {
          await device.close();
        }
      } catch (error) {
        console.error(`Error closing ${name}:`, error.message);
      }
    }

    // Close control port
    if (this.controlPort && this.controlPort.isOpen) {
      this.controlPort.close();
    }

    console.log('✅ Device Health Checker finished\n');
  }
}

// Run the health checker
async function main() {
  const checker = new DeviceHealthChecker();
  
  try {
    await checker.initialize();
    await checker.checkDeviceHealth();
  } catch (error) {
    console.error('❌ Health check failed:', error);
  } finally {
    await checker.close();
    process.exit(0);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Interrupted by user');
  process.exit(0);
});

main().catch((error) => {
  console.error('❌ Failed to run health check:', error);
  process.exit(1);
});
