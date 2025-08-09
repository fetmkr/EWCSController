#!/usr/bin/env node
import SerialCamera from './devices/serial-camera.js';
import { SerialPort } from 'serialport';
import readline from 'readline';
import fs from 'fs';

// Performance monitoring
class PerformanceMonitor {
  constructor() {
    this.metrics = {
      captureAttempts: 0,
      successfulCaptures: 0,
      failedCaptures: 0,
      totalCaptureTime: 0,
      minCaptureTime: Infinity,
      maxCaptureTime: 0,
      avgCaptureTime: 0,
      dataReceived: 0,
      packetsReceived: 0,
      errors: []
    };
    this.captureStartTime = null;
  }

  startCapture() {
    this.captureStartTime = Date.now();
    this.metrics.captureAttempts++;
  }

  endCapture(success) {
    if (!this.captureStartTime) return;
    
    const captureTime = Date.now() - this.captureStartTime;
    this.metrics.totalCaptureTime += captureTime;
    
    if (success) {
      this.metrics.successfulCaptures++;
      this.metrics.minCaptureTime = Math.min(this.metrics.minCaptureTime, captureTime);
      this.metrics.maxCaptureTime = Math.max(this.metrics.maxCaptureTime, captureTime);
    } else {
      this.metrics.failedCaptures++;
    }
    
    if (this.metrics.successfulCaptures > 0) {
      this.metrics.avgCaptureTime = this.metrics.totalCaptureTime / this.metrics.successfulCaptures;
    }
    
    this.captureStartTime = null;
  }

  addError(error) {
    this.metrics.errors.push({
      time: new Date().toISOString(),
      message: error.message || error
    });
  }

  addDataReceived(bytes) {
    this.metrics.dataReceived += bytes;
    this.metrics.packetsReceived++;
  }

  getReport() {
    return {
      ...this.metrics,
      successRate: this.metrics.captureAttempts > 0 
        ? (this.metrics.successfulCaptures / this.metrics.captureAttempts * 100).toFixed(2) + '%'
        : '0%',
      avgPacketSize: this.metrics.packetsReceived > 0
        ? Math.round(this.metrics.dataReceived / this.metrics.packetsReceived)
        : 0
    };
  }
}

// Main test class
class CameraTest {
  constructor() {
    this.camera = null;
    this.controlPort = null;
    this.monitor = new PerformanceMonitor();
    this.testMode = 'manual'; // manual, auto, stress
    this.isRunning = false;
  }

  async initialize() {
    console.log('\\n=== EWCS Serial Camera Standalone Test ===\\n');
    
    try {
      // Initialize control port (PIC24)
      console.log('Initializing control port...');
      await this.initControlPort();
      
      // Initialize camera
      console.log('Initializing camera module...');
      this.camera = new SerialCamera(this.controlPort);
      
      // Setup event listeners
      this.setupEventListeners();
      
      // Initialize the camera
      await this.camera.initialize();
      
      console.log('\\n✓ Camera module initialized successfully');
      console.log('Current Status:', JSON.stringify(this.camera.getFullStatus(), null, 2));
      
    } catch (error) {
      console.error('\\n✗ Initialization failed:', error);
      this.monitor.addError(error);
      throw error;
    }
  }

  async initControlPort() {
    return new Promise((resolve, reject) => {
      this.controlPort = new SerialPort({
        path: '/dev/ttyS0', // PIC24 control port
        baudRate: 115200
      }, (err) => {
        if (err) {
          reject(err);
          return;
        }
      });

      this.controlPort.on('open', () => {
        console.log('Control port opened');
        resolve();
      });

      this.controlPort.on('error', (err) => {
        console.error('Control port error:', err);
        this.monitor.addError(err);
      });
    });
  }

  setupEventListeners() {
    // Monitor data reception
    this.camera.cameraPort.on('data', (data) => {
      this.monitor.addDataReceived(data.length);
      if (this.testMode === 'debug') {
        console.log(`[DATA] Received ${data.length} bytes`);
      }
    });

    // Monitor image capture events
    this.camera.on('imageCaptured', (info) => {
      this.monitor.endCapture(true);
      console.log(`\\n✓ Image captured successfully!`);
      console.log(`  File: ${info.filename}`);
      console.log(`  Size: ${info.size} bytes`);
      console.log(`  Path: ${info.path}`);
      console.log(`  Capture time: ${Date.now() - this.monitor.captureStartTime}ms\\n`);
    });

    this.camera.on('error', (error) => {
      this.monitor.addError(error);
      this.monitor.endCapture(false);
      console.error('\\n✗ Camera error:', error.message);
    });

    this.camera.on('statusChange', (status) => {
      console.log(`[STATUS] ${status.device}: ${status.status}`);
    });
  }

  async testCameraPower() {
    console.log('\\n--- Testing Camera Power Control ---');
    
    try {
      console.log('Turning camera ON...');
      await this.camera.turnOn();
      await this.delay(2000);
      
      console.log('Camera current draw:', this.camera.data.current, 'mA');
      
      console.log('Turning camera OFF...');
      await this.camera.turnOff();
      await this.delay(2000);
      
      console.log('Camera current draw:', this.camera.data.current, 'mA');
      
      console.log('Turning camera back ON...');
      await this.camera.turnOn();
      await this.delay(2000);
      
      console.log('✓ Power control test passed\\n');
      return true;
    } catch (error) {
      console.error('✗ Power control test failed:', error);
      return false;
    }
  }

  async testSingleCapture() {
    console.log('\\n--- Testing Single Image Capture ---');
    this.monitor.startCapture();
    
    try {
      const result = await this.camera.startCapture();
      if (result.success) {
        console.log('Capture initiated, waiting for completion...');
        
        // Wait for capture to complete (max 30 seconds)
        const maxWait = 30000;
        const startTime = Date.now();
        
        while (this.camera.status.isSaving && (Date.now() - startTime < maxWait)) {
          await this.delay(100);
          
          // Show progress
          if ((Date.now() - startTime) % 1000 === 0) {
            console.log(`  State: ${this.camera.captureState}, Packets: ${this.camera.packetCounter}/${this.camera.packetNum}`);
          }
        }
        
        if (!this.camera.status.isSaving && this.camera.isSaved) {
          console.log('✓ Single capture test passed\\n');
          return true;
        } else {
          console.log('✗ Capture timeout or failed\\n');
          return false;
        }
      }
    } catch (error) {
      console.error('✗ Single capture test failed:', error);
      this.monitor.endCapture(false);
      return false;
    }
  }

  async testMultipleCaptures(count = 3) {
    console.log(`\\n--- Testing Multiple Captures (${count} images) ---`);
    
    let successCount = 0;
    for (let i = 0; i < count; i++) {
      console.log(`\\nCapture ${i + 1}/${count}:`);
      
      if (await this.testSingleCapture()) {
        successCount++;
      }
      
      // Wait between captures
      await this.delay(2000);
    }
    
    console.log(`\\n✓ Captured ${successCount}/${count} images successfully\\n`);
    return successCount === count;
  }

  async runStressTest(duration = 60000) {
    console.log(`\\n--- Running Stress Test (${duration/1000}s) ---`);
    
    const startTime = Date.now();
    let captureCount = 0;
    
    while (Date.now() - startTime < duration) {
      captureCount++;
      console.log(`\\nStress test capture ${captureCount}:`);
      
      await this.testSingleCapture();
      
      // Random delay between captures (1-5 seconds)
      const delay = Math.random() * 4000 + 1000;
      await this.delay(delay);
    }
    
    console.log(`\\n✓ Stress test completed: ${captureCount} capture attempts\\n`);
  }

  async interactiveMode() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const showMenu = () => {
      console.log('\\n=== Camera Test Menu ===');
      console.log('1. Turn camera ON');
      console.log('2. Turn camera OFF');
      console.log('3. Capture single image');
      console.log('4. Test multiple captures');
      console.log('5. Run stress test (1 min)');
      console.log('6. Show camera status');
      console.log('7. Show performance metrics');
      console.log('8. Toggle debug mode');
      console.log('9. Run all tests');
      console.log('0. Exit');
      console.log('========================\\n');
    };

    const handleCommand = async (cmd) => {
      switch(cmd.trim()) {
        case '1':
          await this.camera.turnOn();
          break;
        case '2':
          await this.camera.turnOff();
          break;
        case '3':
          await this.testSingleCapture();
          break;
        case '4':
          await this.testMultipleCaptures(3);
          break;
        case '5':
          await this.runStressTest(60000);
          break;
        case '6':
          console.log('\\nCamera Status:', JSON.stringify(this.camera.getFullStatus(), null, 2));
          break;
        case '7':
          console.log('\\nPerformance Metrics:', JSON.stringify(this.monitor.getReport(), null, 2));
          break;
        case '8':
          this.testMode = this.testMode === 'debug' ? 'normal' : 'debug';
          console.log(`Debug mode: ${this.testMode === 'debug' ? 'ON' : 'OFF'}`);
          break;
        case '9':
          await this.runAllTests();
          break;
        case '0':
          console.log('Exiting...');
          await this.cleanup();
          process.exit(0);
          break;
        default:
          console.log('Invalid option');
      }
    };

    showMenu();
    
    rl.on('line', async (input) => {
      await handleCommand(input);
      showMenu();
    });
  }

  async runAllTests() {
    console.log('\\n=== Running All Tests ===\\n');
    
    const results = {
      power: await this.testCameraPower(),
      single: await this.testSingleCapture(),
      multiple: await this.testMultipleCaptures(3)
    };
    
    console.log('\\n=== Test Results ===');
    console.log('Power Control:', results.power ? '✓ PASS' : '✗ FAIL');
    console.log('Single Capture:', results.single ? '✓ PASS' : '✗ FAIL');
    console.log('Multiple Captures:', results.multiple ? '✓ PASS' : '✗ FAIL');
    
    console.log('\\n=== Performance Report ===');
    console.log(JSON.stringify(this.monitor.getReport(), null, 2));
    
    // Save report to file
    const reportFile = `camera-test-report-${Date.now()}.json`;
    fs.writeFileSync(reportFile, JSON.stringify({
      timestamp: new Date().toISOString(),
      results,
      performance: this.monitor.getReport()
    }, null, 2));
    
    console.log(`\\nReport saved to: ${reportFile}`);
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async cleanup() {
    console.log('\\nCleaning up...');
    
    try {
      if (this.camera) {
        await this.camera.close();
      }
      
      if (this.controlPort && this.controlPort.isOpen) {
        await new Promise((resolve) => {
          this.controlPort.close((err) => {
            if (err) console.error('Control port close error:', err);
            resolve();
          });
        });
      }
      
      console.log('✓ Cleanup completed');
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  }
}

// Main execution
async function main() {
  const test = new CameraTest();
  
  try {
    await test.initialize();
    
    // Check for command line arguments
    const args = process.argv.slice(2);
    
    if (args.includes('--auto')) {
      await test.runAllTests();
      await test.cleanup();
      process.exit(0);
    } else if (args.includes('--stress')) {
      const duration = parseInt(args[args.indexOf('--stress') + 1]) || 60;
      await test.runStressTest(duration * 1000);
      await test.cleanup();
      process.exit(0);
    } else {
      // Interactive mode
      await test.interactiveMode();
    }
    
  } catch (error) {
    console.error('Fatal error:', error);
    await test.cleanup();
    process.exit(1);
  }
}

// Handle process termination
process.on('SIGINT', async () => {
  console.log('\\nReceived SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

// Run the test
main();