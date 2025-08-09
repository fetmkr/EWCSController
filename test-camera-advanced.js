#!/usr/bin/env node
import { SerialPort } from 'serialport';
import fs from 'fs';

class SpinelCamera {
  constructor(portPath = '/dev/ttyUSB0', baudRate = 115200) {
    // 카메라 설정
    this.config = {
      cameraId: 0x01,        // 카메라 ID (여러 카메라 연결 시)
      packetSize: 768,       // 패킷 크기: 768 (기본)
      resolution: {
        width: 0x05,         // 해상도 설정 (VGA)
        height: 0x05
      },
      quality: 0x02,         // JPEG 품질
      mode: 0x00            // 캡처 모드
    };

    // 상태 변수
    this.captureState = 0;
    this.packetCounter = 0;
    this.packetNum = 0;
    this.snapshotSize = 0;
    this.dataBuffer = Buffer.alloc(0);
    this.imageBuffer = Buffer.alloc(0);
    this.started = false;
    this.remainingBytesSize = 0;
    this.isSaved = false;
    this.captureIntervalId = null;
    this.tryCount = 0;
    
    // 시간 측정용
    this.captureStartTime = 0;
    this.captureEndTime = 0;

    // 시리얼 포트 초기화
    this.port = new SerialPort({
      path: portPath,
      baudRate: baudRate
    });

    this.setupEventHandlers();
  }

  // 카메라 ID 설정 (멀티 카메라 지원)
  setCameraId(id) {
    if (id < 0 || id > 255) {
      throw new Error('Camera ID must be between 0 and 255');
    }
    this.config.cameraId = id;
    console.log(`Camera ID set to: 0x${id.toString(16).padStart(2, '0')}`);
  }

  // 패킷 크기 설정 (문서: 512~2048 바이트 범위)
  setPacketSize(size) {
    // 문서에 따라 512~2048 범위, 256의 배수로 설정
    if (size < 512 || size > 2048) {
      throw new Error(`Packet size must be between 512 and 2048 bytes (recommended: 512, 768, 1024, 1536, 2048)`);
    }
    
    // 256의 배수로 정렬 (프로토콜 효율성)
    if (size % 256 !== 0) {
      const aligned = Math.round(size / 256) * 256;
      console.log(`Aligning packet size from ${size} to ${aligned} (256-byte boundary)`);
      size = aligned;
    }
    
    this.config.packetSize = size;
    console.log(`Packet size set to: ${size} bytes`);
  }
  
  // 최적 패킷 크기 자동 선택 (이미지 크기 기반)
  getOptimalPacketSize(imageSize) {
    // 작은 이미지: 512 바이트
    if (imageSize < 50000) return 512;
    // 중간 이미지: 1024 바이트 (1K - 문서 권장)
    if (imageSize < 200000) return 1024;
    // 큰 이미지: 2048 바이트 (최대 효율)
    return 2048;
  }

  // 해상도 설정 (프리셋)
  setResolution(preset) {
    const resolutions = {
      'QQVGA': { width: 0x01, height: 0x01 },  // 160x120
      'QVGA':  { width: 0x03, height: 0x03 },  // 320x240
      'VGA':   { width: 0x05, height: 0x05 },  // 640x480
      'SVGA':  { width: 0x07, height: 0x07 },  // 800x600
      'XGA':   { width: 0x09, height: 0x09 },  // 1024x768
      'SXGA':  { width: 0x0B, height: 0x0B },  // 1280x1024
      'UXGA':  { width: 0x0D, height: 0x0D }   // 1600x1200
    };

    if (!resolutions[preset]) {
      throw new Error(`Resolution must be one of: ${Object.keys(resolutions).join(', ')}`);
    }

    this.config.resolution = resolutions[preset];
    console.log(`Resolution set to: ${preset}`);
  }

  // JPEG 품질 설정
  setQuality(quality) {
    if (quality < 1 || quality > 8) {
      throw new Error('Quality must be between 1 (lowest) and 8 (highest)');
    }
    this.config.quality = quality;
    console.log(`JPEG quality set to: ${quality}/8`);
  }

  // 명령 생성 헬퍼 함수
  buildCommand(cmdType, data = []) {
    const header = [0x90, 0xEB];
    const cameraId = this.config.cameraId;
    
    // 데이터 길이 계산 (Little Endian)
    const dataLen = data.length;
    const lenLow = dataLen & 0xFF;
    const lenHigh = (dataLen >> 8) & 0xFF;
    
    // 명령 조합
    let cmd = [...header, cameraId, cmdType, lenLow, lenHigh, ...data];
    
    // 체크섬 계산 (간단한 XOR 또는 합계)
    const checksum = this.calculateChecksum(cmd);
    cmd.push(...checksum);
    
    return Buffer.from(cmd);
  }

  // 체크섬 계산
  calculateChecksum(data) {
    // 간단한 체크섬 - 실제 프로토콜에 맞게 수정 필요
    return [0xC1, 0xC2];
  }

  // 스냅샷 캡처 명령
  buildSnapshotCommand() {
    const data = [
      this.config.mode,
      this.config.quality,
      this.config.resolution.width,
      this.config.resolution.height
    ];
    return this.buildCommand(0x40, data);
  }

  // 테스트 명령 (카메라 연결 확인)
  buildTestCommand() {
    const data = [0x55, 0xAA]; // PDF 예시 데이터
    return this.buildCommand(0x01, data);
  }

  // Baud Rate & Address ID 설정 명령 (0x44)
  buildSetConfigCommand(baudRateParam = 0x00, saveFlag = 0x01, newCameraId = 0x00) {
    // baudRateParam: 0x00=변경없음, 0x01=9600, 0x02=19200, 0x03=28800, 0x04=38400, 0x05=57600, 0x06=115200
    // saveFlag: 0x01=저장, 0x00=저장안함  
    // newCameraId: 0x00 또는 0xFF=변경없음, 그외=새 ID (2번 전송)
    const data = [baudRateParam, saveFlag, newCameraId, newCameraId];
    return this.buildCommand(0x44, data);
  }

  // Baud Rate 코드 변환 헬퍼
  getBaudRateParam(baudRate) {
    const baudRateMap = {
      9600: 0x01,
      19200: 0x02, 
      28800: 0x03,
      38400: 0x04,
      57600: 0x05,
      115200: 0x06
    };
    return baudRateMap[baudRate] || 0x00; // 없으면 변경없음
  }

  // 데이터 읽기 명령
  buildReadDataCommand(startAddress, packetSize) {
    const addrBuf = Buffer.allocUnsafe(4);
    addrBuf.writeInt32LE(startAddress);
    
    // 패킷 크기를 Little Endian으로 전송 (768 = 0x0300 -> 0x00, 0x03)
    const actualSize = packetSize || this.config.packetSize;
    const sizeLow = actualSize & 0xFF;
    const sizeHigh = (actualSize >> 8) & 0xFF;
    
    const data = [...addrBuf, sizeLow, sizeHigh];  // Little Endian!
    return this.buildCommand(0x48, data);
  }

  setupEventHandlers() {
    this.port.on('open', () => {
      console.log(`Camera port opened: ${this.port.path}`);
      this.onPortOpen();
    });

    this.port.on('data', (data) => {
      this.handleData(data);
    });

    this.port.on('error', (err) => {
      console.error('Serial port error:', err);
    });
  }

  handleData(data) {
    this.dataBuffer = Buffer.concat([this.dataBuffer, data]);
    
    // 스냅샷 준비 응답 체크
    if (data[0] === 0x90 && data[1] === 0xEB && data[3] === 0x40 && 
        data.length === 19 && this.captureState === 0) {
      this.handleSnapshotReady(data);
      return;
    }

    // 데이터 패킷 체크
    if (!this.started) {
      for (let i = 0; i < this.dataBuffer.length - 3; i++) {
        if (this.dataBuffer[i] === 0x90 && 
            this.dataBuffer[i + 1] === 0xEB && 
            this.dataBuffer[i + 2] === this.config.cameraId && 
            this.dataBuffer[i + 3] === 0x49) {
          this.started = true;
          this.dataBuffer = this.dataBuffer.slice(i);
          break;
        }
      }
    }

    // 패킷 처리
    if (this.started && this.dataBuffer.length >= this.getCurrentPacketSize() + 8) {
      this.processPacket();
    }
  }

  handleSnapshotReady(data) {
    this.packetCounter = 0;
    console.log("Snapshot ready signal received");
    
    this.snapshotSize = data.readInt32LE(7);
    console.log(`Snapshot size: ${this.snapshotSize} bytes`);
    
    this.remainingBytesSize = (this.snapshotSize % this.config.packetSize);
    this.packetNum = Math.floor(this.snapshotSize / this.config.packetSize);
    
    console.log(`Total packets: ${this.packetNum}`);
    console.log(`Last packet size: ${this.remainingBytesSize} bytes`);
    
    this.captureState = 1;
  }

  getCurrentPacketSize() {
    // 마지막 패킷인 경우 남은 바이트 크기 반환
    if (this.packetCounter === this.packetNum && this.remainingBytesSize > 0) {
      return this.remainingBytesSize;
    }
    return this.config.packetSize;
  }

  processPacket() {
    const currentPacketSize = this.getCurrentPacketSize();
    const requiredData = this.dataBuffer.slice(6, currentPacketSize + 6);
    
    this.imageBuffer = Buffer.concat([this.imageBuffer, requiredData]);
    
    console.log(`Packet ${this.packetCounter + 1}/${this.packetNum + 1} received (${currentPacketSize} bytes)`);
    
    this.dataBuffer = this.dataBuffer.slice(currentPacketSize + 8);
    
    // 다음 패킷 처리
    if (this.packetCounter < this.packetNum - 1) {
      this.packetCounter++;
      this.captureState = 1;
    } else if (this.packetCounter === this.packetNum - 1) {
      this.packetCounter++;
      this.captureState = 1;
    } else if (this.packetCounter >= this.packetNum) {
      this.captureState = 3;
    }
    
    this.started = false;
  }

  captureImage() {
    console.log(`Capture attempt ${this.tryCount + 1}, state: ${this.captureState}`);

    switch(this.captureState) {
      case 0: // 캡처 시작
        this.tryCount++;
        if (this.tryCount > 5) {
          console.error("Camera not responding");
          clearInterval(this.captureIntervalId);
          return;
        }
        
        this.imageBuffer = Buffer.alloc(0);
        this.captureStartTime = Date.now(); // 시간 측정 시작
        const snapshotCmd = this.buildSnapshotCommand();
        console.log(`Sending snapshot command: ${snapshotCmd.toString('hex')}`);
        this.port.write(snapshotCmd);
        break;

      case 1: // 패킷 요청
        this.isSaved = false;
        const startAddr = this.packetCounter * this.config.packetSize;
        const currentPacketSize = this.getCurrentPacketSize();
        const readCmd = this.buildReadDataCommand(startAddr, currentPacketSize);
        console.log(`Requesting packet ${this.packetCounter + 1} from address 0x${startAddr.toString(16)} (${currentPacketSize} bytes)`);
        console.log(`Read command hex: ${readCmd.toString('hex')}`);
        this.port.write(readCmd);
        this.captureState = 2;
        break;

      case 2: // 패킷 대기
        // 타임아웃 체크 추가 가능
        break;

      case 3: // 이미지 저장
        if (!this.isSaved) {
          clearInterval(this.captureIntervalId);
          
          if (this.snapshotSize === this.imageBuffer.length) {
            console.log("Image complete, saving...");
            this.saveImage();
          } else {
            console.error(`Size mismatch: expected ${this.snapshotSize}, got ${this.imageBuffer.length}`);
          }
        }
        break;
    }
  }

  saveImage() {
    this.captureEndTime = Date.now(); // 시간 측정 종료
    const captureTime = this.captureEndTime - this.captureStartTime;
    
    const timestamp = Date.now();
    const fileName = `${timestamp}.jpg`;
    const filePath = `./images/${fileName}`;
    
    if (!fs.existsSync('./images')) {
      fs.mkdirSync('./images', { recursive: true });
    }
    
    fs.writeFile(filePath, this.imageBuffer, (err) => {
      if (err) {
        console.error('Save error:', err);
        return;
      }
      
      console.log(`\n✅ Image saved: ${fileName}`);
      console.log(`   Size: ${this.imageBuffer.length} bytes`);
      console.log(`   Resolution: ${this.getResolutionName()}`);
      console.log(`   Quality: ${this.config.quality}/8`);
      console.log(`   Packet size: ${this.config.packetSize} bytes`);
      console.log(`   Total packets: ${this.packetNum + 1}`);
      console.log(`   ⏱️  Capture time: ${captureTime}ms (${(captureTime/1000).toFixed(2)}s)`);
      console.log(`   📊 Transfer rate: ${((this.imageBuffer.length / 1024) / (captureTime / 1000)).toFixed(2)} KB/s`);
      
      this.isSaved = true;
      this.captureState = 0;
      
      // 테스트 종료
      setTimeout(() => process.exit(0), 1000);
    });
  }

  getResolutionName() {
    const resMap = {
      0x01: 'QQVGA', 0x03: 'QVGA', 0x05: 'VGA',
      0x07: 'SVGA', 0x09: 'XGA', 0x0B: 'SXGA', 0x0D: 'UXGA'
    };
    return resMap[this.config.resolution.width] || 'Unknown';
  }

  onPortOpen() {
    console.log('\n=== Spinel Camera Test ===');
    console.log(`Camera ID: 0x${this.config.cameraId.toString(16).padStart(2, '0')}`);
    console.log(`Resolution: ${this.getResolutionName()}`);
    console.log(`Quality: ${this.config.quality}/8`);
    console.log(`Packet size: ${this.config.packetSize} bytes`);
    console.log('\nStarting capture in 3 seconds...\n');
    
    setTimeout(() => {
      this.tryCount = 0;
      this.captureIntervalId = setInterval(() => this.captureImage(), 100);
    }, 3000);
  }
}

// 메인 실행
const camera = new SpinelCamera('/dev/ttyUSB0', 115200);

// 설정 예제 (옵션)
try {
  // camera.setCameraId(0x01);        // 카메라 ID 설정
  // camera.setResolution('VGA');     // 해상도 설정
  // camera.setQuality(5);             // 품질 설정
  // camera.setPacketSize(768);       // 패킷 크기 설정
} catch (error) {
  console.error('Configuration error:', error.message);
  process.exit(1);
}