#!/usr/bin/env node
/**
 * Spinel SC20MPF 시리얼 카메라 제어 모듈
 * SXH Protocol v4.0 기반 통신
 * 
 * 지원 기능:
 * - 스냅샷 캡처 (0x40)
 * - 이미지 데이터 전송 (0x48) 
 * - 카메라 연결 테스트 (0x01)
 * - Baud Rate & Address ID 설정 (0x44)
 * 
 * 프로토콜 구조: [90 EB] [Camera ID] [Command] [Data Length Low] [Data Length High] [Data...] [C1 C2]
 * 
 * @author Claude Code
 * @version 1.0.0
 * @protocol SXH Protocol v4.0
 */

import { SerialPort } from 'serialport';
import fs from 'fs';

/**
 * Spinel 시리얼 카메라 제어 클래스
 * SXH Protocol v4.0을 사용하여 카메라와 통신
 */
class SpinelCamera {
  /**
   * SpinelCamera 생성자
   * @param {string} portPath - 시리얼 포트 경로 (기본: /dev/ttyUSB0)
   * @param {number} baudRate - 통신 속도 (기본: 115200)
   */
  constructor(portPath = '/dev/ttyUSB0', baudRate = 115200) {
    // 카메라 기본 설정
    this.config = {
      cameraId: 0x01,        // 카메라 주소 ID (멀티 카메라 지원)
      packetSize: 768,       // 이미지 데이터 패킷 크기 (512~2048 바이트)
      resolution: {
        width: 0x05,         // 해상도 설정 - VGA (640x480) 
        height: 0x05
      },
      quality: 0x02,         // JPEG 압축 품질 (1~8)
      mode: 0x00            // 캡처 모드
    };

    // 캡처 상태 관리 변수들
    this.captureState = 0;           // 캡처 단계 (0:대기, 1:패킷요청, 2:수신대기, 3:저장)
    this.packetCounter = 0;          // 현재 수신한 패킷 번호
    this.packetNum = 0;              // 전체 패킷 개수
    this.snapshotSize = 0;           // 스냅샷 전체 크기 (바이트)
    this.dataBuffer = Buffer.alloc(0);    // 시리얼 수신 데이터 임시 버퍼
    this.imageBuffer = Buffer.alloc(0);   // 이미지 데이터 조립 버퍼
    this.started = false;            // 패킷 시작 시퀀스 감지 상태
    this.remainingBytesSize = 0;     // 마지막 패킷 크기
    this.isSaved = false;            // 이미지 저장 완료 플래그
    this.captureIntervalId = null;   // 캡처 타이머 ID
    this.tryCount = 0;               // 캡처 시도 횟수
    
    // 성능 측정용 변수들
    this.captureStartTime = 0;       // 캡처 시작 시간
    this.captureEndTime = 0;         // 캡처 완료 시간
    
    // 테스트 응답 대기용
    this.testPromiseResolve = null;  // 테스트 Promise resolve 함수

    // 시리얼 포트 초기화
    this.port = new SerialPort({
      path: portPath,
      baudRate: baudRate
    });

    // 이벤트 핸들러 설정
    this.setupEventHandlers();
  }

  /**
   * 카메라 주소 ID 설정 (멀티 카메라 환경에서 사용)
   * @param {number} id - 카메라 ID (0~255)
   */
  setCameraId(id) {
    if (id < 0 || id > 255) {
      throw new Error('Camera ID must be between 0 and 255');
    }
    this.config.cameraId = id;
    console.log(`Camera ID set to: 0x${id.toString(16).padStart(2, '0')}`);
  }

  /**
   * 패킷 크기 설정 (문서 권장: 512~2048 바이트 범위)
   * 큰 패킷일수록 전송 효율은 좋아지지만 메모리 사용량 증가
   * @param {number} size - 패킷 크기 (512, 768, 1024, 1536, 2048 등)
   */
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
  
  /**
   * 이미지 크기에 따른 최적 패킷 크기 자동 선택
   * @param {number} imageSize - 이미지 크기 (바이트)
   * @returns {number} 최적 패킷 크기
   */
  getOptimalPacketSize(imageSize) {
    // 작은 이미지: 512 바이트
    if (imageSize < 50000) return 512;
    // 중간 이미지: 1024 바이트 (1K - 문서 권장)
    if (imageSize < 200000) return 1024;
    // 큰 이미지: 2048 바이트 (최대 효율)
    return 2048;
  }

  /**
   * 해상도 설정 (프리셋 방식)
   * @param {string} preset - 해상도 프리셋 (QQVGA, QVGA, VGA, SVGA, XGA, SXGA, UXGA)
   */
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

  /**
   * JPEG 압축 품질 설정
   * @param {number} quality - 품질 (1~8, 1=최저품질, 8=최고품질)
   */
  setQuality(quality) {
    if (quality < 1 || quality > 8) {
      throw new Error('Quality must be between 1 (lowest) and 8 (highest)');
    }
    this.config.quality = quality;
    console.log(`JPEG quality set to: ${quality}/8`);
  }

  /**
   * SXH 프로토콜 명령어 빌드 (공통 함수)
   * 모든 명령어는 이 함수를 통해 생성됨
   * @param {number} cmdType - 명령어 타입 (0x01, 0x40, 0x44, 0x48 등)
   * @param {Array} data - 명령어 데이터 배열
   * @returns {Buffer} 완성된 명령어 버퍼
   */
  buildCommand(cmdType, data = []) {
    const header = [0x90, 0xEB];        // SXH 프로토콜 헤더
    const cameraId = this.config.cameraId;  // 대상 카메라 ID
    
    // 데이터 길이 계산 (Little Endian)
    const dataLen = data.length;
    const lenLow = dataLen & 0xFF;       // 하위 바이트
    const lenHigh = (dataLen >> 8) & 0xFF;  // 상위 바이트
    
    // 명령어 조합: [헤더] [카메라ID] [명령] [길이] [데이터]
    let cmd = [...header, cameraId, cmdType, lenLow, lenHigh, ...data];
    
    // 체크섬 계산 및 추가 (현재는 고정값 사용)
    const checksum = this.calculateChecksum(cmd);
    cmd.push(...checksum);
    
    return Buffer.from(cmd);
  }

  /**
   * 체크섬 계산 (현재는 고정값 사용, 실제 체크섬 로직 구현 필요)
   * @param {Array} data - 체크섬 계산할 데이터
   * @returns {Array} 체크섬 [C1, C2]
   */
  calculateChecksum(data) {
    // 간단한 체크섬 - 실제 프로토콜에 맞게 수정 필요
    return [0xC1, 0xC2];
  }

  /**
   * 스냅샷 캡처 명령 생성 (0x40)
   * 카메라에게 사진 촬영을 지시하는 명령
   * @returns {Buffer} 스냅샷 명령어
   */
  buildSnapshotCommand() {
    const data = [
      this.config.mode,               // 캡처 모드
      this.config.quality,            // JPEG 압축 품질
      this.config.resolution.width,   // 해상도 가로
      this.config.resolution.height   // 해상도 세로
    ];
    return this.buildCommand(0x40, data);
  }

  /**
   * 카메라 연결 테스트 명령 생성 (0x01)
   * 카메라가 살아있는지 확인하는 명령 (핑 테스트)
   * @returns {Buffer} 테스트 명령어
   */
  buildTestCommand() {
    const data = [0x55, 0xAA]; // PDF 예시 데이터 (응답시 순서가 바뀜)
    return this.buildCommand(0x01, data);
  }

  /**
   * Baud Rate & Address ID 설정 명령 생성 (0x44)
   * 카메라의 통신속도와 주소를 변경하는 명령 (주의: 설정 후 통신 두절 가능)
   * @param {number} baudRateParam - Baud Rate 파라미터 (0x00=변경없음, 0x01~0x06)
   * @param {number} saveFlag - 저장 여부 (0x01=영구저장, 0x00=임시적용)
   * @param {number} newCameraId - 새 카메라 ID (0x00=변경없음)
   * @returns {Buffer} 설정 명령어
   */
  buildSetConfigCommand(baudRateParam = 0x00, saveFlag = 0x01, newCameraId = 0x00) {
    // baudRateParam: 0x00=변경없음, 0x01=9600, 0x02=19200, 0x03=28800, 0x04=38400, 0x05=57600, 0x06=115200
    // saveFlag: 0x01=EEPROM 저장, 0x00=RAM만 적용  
    // newCameraId: 0x00 또는 0xFF=변경없음, 그외=새 ID (2번 전송하여 확인)
    const data = [baudRateParam, saveFlag, newCameraId, newCameraId];
    return this.buildCommand(0x44, data);
  }

  /**
   * Baud Rate 숫자를 프로토콜 파라미터로 변환하는 헬퍼 함수
   * @param {number} baudRate - Baud Rate 값 (9600, 19200, 28800, 38400, 57600, 115200)
   * @returns {number} 프로토콜 파라미터 (0x01~0x06)
   */
  getBaudRateParam(baudRate) {
    const baudRateMap = {
      9600: 0x01,     // 9600 bps
      19200: 0x02,    // 19200 bps
      28800: 0x03,    // 28800 bps
      38400: 0x04,    // 38400 bps
      57600: 0x05,    // 57600 bps
      115200: 0x06    // 115200 bps (현재 사용중)
    };
    return baudRateMap[baudRate] || 0x00; // 지원하지 않는 속도면 변경없음
  }

  /**
   * 이미지 데이터 읽기 명령 생성 (0x48)
   * 스냅샷 후 이미지를 패킷 단위로 전송받는 명령
   * @param {number} startAddress - 읽기 시작 주소
   * @param {number} packetSize - 요청할 패킷 크기 (옵션)
   * @returns {Buffer} 데이터 읽기 명령어
   */
  buildReadDataCommand(startAddress, packetSize) {
    const addrBuf = Buffer.allocUnsafe(4);
    addrBuf.writeInt32LE(startAddress);  // 시작 주소 (Little Endian)
    
    // 패킷 크기를 Little Endian으로 전송 (768 = 0x0300 -> 0x00, 0x03)
    const actualSize = packetSize || this.config.packetSize;
    const sizeLow = actualSize & 0xFF;        // 하위 바이트
    const sizeHigh = (actualSize >> 8) & 0xFF; // 상위 바이트
    
    const data = [...addrBuf, sizeLow, sizeHigh];  // Little Endian!
    return this.buildCommand(0x48, data);
  }

  /**
   * 시리얼 포트 이벤트 핸들러 설정
   * 포트 열림, 데이터 수신, 에러 처리 이벤트 등록
   */
  setupEventHandlers() {
    this.port.on('open', () => {
      console.log(`Camera port opened: ${this.port.path}`);
      this.onPortOpen();
    });

    this.port.on('data', (data) => {
      this.handleData(data);  // 수신 데이터 처리
    });

    this.port.on('error', (err) => {
      console.error('Serial port error:', err);
    });
  }

  /**
   * 시리얼 데이터 수신 처리 (메인 데이터 핸들러)
   * SXH 프로토콜에 따라 수신 데이터를 파싱하고 처리
   * @param {Buffer} data - 수신된 데이터
   */
  handleData(data) {
    this.dataBuffer = Buffer.concat([this.dataBuffer, data]);
    
    // 테스트 명령 응답 체크 (0x01 명령에 대한 응답)
    if (data[0] === 0x90 && data[1] === 0xEB && data[2] === this.config.cameraId && 
        data[3] === 0x01 && data.length === 11) {
      this.handleTestResponse(data);
      return;
    }
    
    // 스냅샷 준비 완료 응답 체크 (0x40 명령에 대한 응답)
    if (data[0] === 0x90 && data[1] === 0xEB && data[3] === 0x40 && 
        data.length === 19 && this.captureState === 0) {
      this.handleSnapshotReady(data);
      return;
    }

    // 이미지 데이터 패킷 시작 시퀀스 감지 (0x49 응답)
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

    // 충분한 데이터가 수신되면 패킷 처리
    if (this.started && this.dataBuffer.length >= this.getCurrentPacketSize() + 8) {
      this.processPacket();
    }
  }

  /**
   * 테스트 명령 응답 처리
   * PDF: 응답 데이터는 00 aa 55 (00 + 순서바뀐 55 aa)
   * @param {Buffer} data - 테스트 응답 데이터 (11바이트)
   */
  handleTestResponse(data) {
    console.log('Test response received:', data.toString('hex'));
    
    // 응답 데이터 확인: 00 aa 55
    if (data[6] === 0x00 && data[7] === 0xAA && data[8] === 0x55) {
      const cameraId = data[2];
      console.log(`[CAMERA] Test OK - Camera ID: 0x${cameraId.toString(16).padStart(2, '0')} connected`);
      
      if (this.testPromiseResolve) {
        this.testPromiseResolve({ success: true, cameraId });
        this.testPromiseResolve = null;
      }
    } else {
      console.log('[CAMERA] Test response data mismatch');
      
      if (this.testPromiseResolve) {
        this.testPromiseResolve({ success: false, reason: 'data_mismatch' });
        this.testPromiseResolve = null;
      }
    }
  }

  /**
   * 스냅샷 준비 완료 신호 처리
   * 카메라에서 촬영 완료 및 이미지 크기 정보를 받아 처리
   * @param {Buffer} data - 스냅샷 준비 완료 데이터 (19바이트)
   */
  handleSnapshotReady(data) {
    this.packetCounter = 0;
    console.log("Snapshot ready signal received");
    
    // 이미지 전체 크기 추출 (7번째 바이트부터 4바이트, Little Endian)
    this.snapshotSize = data.readInt32LE(7);
    console.log(`Snapshot size: ${this.snapshotSize} bytes`);
    
    // 패킷 분할 계산
    this.remainingBytesSize = (this.snapshotSize % this.config.packetSize);
    this.packetNum = Math.floor(this.snapshotSize / this.config.packetSize);
    
    console.log(`Packet size: ${this.config.packetSize} bytes`);
    console.log(`Total packets: ${this.packetNum}`);
    console.log(`Last packet size: ${this.remainingBytesSize} bytes`);
    
    this.captureState = 1;  // 다음 단계: 패킷 요청
  }

  /**
   * 현재 요청할 패킷 크기 계산
   * 마지막 패킷은 잔여 바이트 크기, 나머지는 기본 패킷 크기
   * @returns {number} 현재 패킷 크기
   */
  getCurrentPacketSize() {
    // 마지막 패킷인 경우 남은 바이트 크기 반환
    if (this.packetCounter === this.packetNum && this.remainingBytesSize > 0) {
      return this.remainingBytesSize;
    }
    return this.config.packetSize;
  }

  /**
   * 수신된 이미지 데이터 패킷 처리
   * SXH 프로토콜에서 실제 이미지 데이터 부분만 추출하여 조립
   */
  processPacket() {
    const currentPacketSize = this.getCurrentPacketSize();
    // 패킷에서 실제 이미지 데이터 부분만 추출 (6바이트 헤더 제외)
    const requiredData = this.dataBuffer.slice(6, currentPacketSize + 6);
    
    // 이미지 버퍼에 데이터 추가 (순서대로 조립)
    this.imageBuffer = Buffer.concat([this.imageBuffer, requiredData]);
    
    console.log(`Packet ${this.packetCounter + 1}/${this.packetNum + 1} received (${currentPacketSize} bytes)`);
    
    // 처리된 데이터는 버퍼에서 제거
    this.dataBuffer = this.dataBuffer.slice(currentPacketSize + 8);
    
    // 다음 패킷 처리 로직
    if (this.packetCounter < this.packetNum - 1) {
      // 일반 패킷: 다음 패킷 요청
      this.packetCounter++;
      this.captureState = 1;
    } else if (this.packetCounter === this.packetNum - 1) {
      // 마지막 전 패킷: 잔여 바이트 패킷 요청
      this.packetCounter++;
      this.captureState = 1;
    } else if (this.packetCounter >= this.packetNum) {
      // 모든 패킷 수신 완료: 파일 저장 단계로
      this.captureState = 3;
    }
    
    this.started = false;  // 다음 패킷 대기
  }

  /**
   * 이미지 캡처 메인 로직 (상태기계)
   * 100ms 간격으로 호출되어 캡처 과정을 단계별로 진행
   * State 0: 캡처 명령 전송 -> State 1: 패킷 요청 -> State 2: 대기 -> State 3: 저장
   */
  captureImage() {
    console.log(`Capture attempt ${this.tryCount + 1}, state: ${this.captureState}`);

    switch(this.captureState) {
      case 0: // 캡처 시작 단계
        this.tryCount++;
        if (this.tryCount > 5) {
          console.error("Camera not responding");
          clearInterval(this.captureIntervalId);
          return;
        }
        
        // 캡처 준비 및 스냅샷 명령 전송
        this.imageBuffer = Buffer.alloc(0);
        this.captureStartTime = Date.now(); // 성능 측정 시작
        const snapshotCmd = this.buildSnapshotCommand();
        console.log(`Sending snapshot command: ${snapshotCmd.toString('hex')}`);
        this.port.write(snapshotCmd);
        break;

      case 1: // 패킷 요청 단계
        this.isSaved = false;
        const startAddr = this.packetCounter * this.config.packetSize;
        const currentPacketSize = this.getCurrentPacketSize();
        const readCmd = this.buildReadDataCommand(startAddr, currentPacketSize);
        console.log(`Requesting packet ${this.packetCounter + 1} from address 0x${startAddr.toString(16)} (${currentPacketSize} bytes)`);
        console.log(`Read command hex: ${readCmd.toString('hex')}`);
        this.port.write(readCmd);
        this.captureState = 2;  // 응답 대기 상태로 전환
        break;

      case 2: // 패킷 응답 대기 단계
        // 데이터 수신을 기다리는 상태 (타임아웃 처리 가능)
        break;

      case 3: // 이미지 저장 단계
        if (!this.isSaved) {
          clearInterval(this.captureIntervalId);
          
          // 이미지 크기 검증 후 저장
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

  /**
   * 이미지 파일 저장 처리
   * 수신한 이미지 데이터를 JPEG 파일로 저장하고 성능 통계 출력
   */
  saveImage() {
    this.captureEndTime = Date.now(); // 성능 측정 종료
    const captureTime = this.captureEndTime - this.captureStartTime;
    
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    
    const baseDirectory = './ewcs-image';
    const directoryPath = `${baseDirectory}/${year}-${month}`;
    const timestamp = Date.now();
    const fileName = `${timestamp}.jpg`;
    const filePath = `${directoryPath}/${fileName}`;
    
    // 이미지 디렉토리 생성
    if (!fs.existsSync(directoryPath)) {
      fs.mkdirSync(directoryPath, { recursive: true });
    }
    
    // 파일 저장 (비동기)
    fs.writeFile(filePath, this.imageBuffer, (err) => {
      if (err) {
        console.error('Save error:', err);
        return;
      }
      
      // 저장 완료 및 성능 통계 출력
      console.log(`\n✅ Image saved: ${fileName}`);
      console.log(`   Size: ${this.imageBuffer.length} bytes`);
      console.log(`   Resolution: ${this.getResolutionName()}`);
      console.log(`   Quality: ${this.config.quality}/8`);
      console.log(`   Packet size: ${this.config.packetSize} bytes`);
      console.log(`   Total packets: ${this.packetNum + 1}`);
      console.log(`   ⏱️  Capture time: ${captureTime}ms (${(captureTime/1000).toFixed(2)}s)`);
      console.log(`   📊 Transfer rate: ${((this.imageBuffer.length / 1024) / (captureTime / 1000)).toFixed(2)} KB/s`);
      
      this.isSaved = true;
      this.captureState = 0;  // 캡처 완료, 초기 상태로 복귀
      
      // 테스트 종료 코드 제거 - 모듈에서는 자동 종료하지 않음
      // setTimeout(() => process.exit(0), 1000);  // 제거됨
    });
  }

  /**
   * 해상도 코드를 문자열로 변환하는 헬퍼 함수
   * @returns {string} 해상도 이름
   */
  getResolutionName() {
    const resMap = {
      0x01: 'QQVGA', 0x03: 'QVGA', 0x05: 'VGA',
      0x07: 'SVGA', 0x09: 'XGA', 0x0B: 'SXGA', 0x0D: 'UXGA'
    };
    return resMap[this.config.resolution.width] || 'Unknown';
  }

  /**
   * 카메라 연결 테스트 (공개 메소드)
   * @returns {Promise} 테스트 결과
   */
  async testConnection() {
    if (!this.port?.isOpen) {
      return { success: false, reason: 'port_not_open' };
    }

    return new Promise((resolve) => {
      this.testPromiseResolve = resolve;
      
      const testCmd = this.buildTestCommand();
      console.log(`[CAMERA] Sending test command: ${testCmd.toString('hex')}`);
      this.port.write(testCmd);
      
      // 2초 타임아웃
      setTimeout(() => {
        if (this.testPromiseResolve) {
          console.log('[CAMERA] No response - Camera not connected');
          this.testPromiseResolve({ success: false, reason: 'timeout' });
          this.testPromiseResolve = null;
        }
      }, 2000);
    });
  }

  /**
   * 이미지 캡처 시작 (공개 메소드)
   * 외부에서 호출하여 사진 촬영을 시작
   * @param {number} interval - 캡처 시도 간격 (기본: 100ms)
   * @returns {Object} 시작 결과
   */
  async startCapture(interval = 100) {
    if (this.captureIntervalId) {
      console.log('Camera is already capturing, skipping...');
      return { success: false, reason: 'already_capturing' };
    }
    
    try {
      // 상태 초기화
      this.captureState = 0;
      this.packetCounter = 0;
      this.tryCount = 0;
      this.isSaved = false;
      this.imageBuffer = Buffer.alloc(0);
      this.dataBuffer = Buffer.alloc(0);
      
      console.log('Starting image capture...');
      
      // 주기적 캡처 프로세스 시작 (100ms 간격)
      this.captureIntervalId = setInterval(() => {
        this.captureImage();
      }, interval);
      
      return { success: true };
      
    } catch (error) {
      this.stopCapture();
      throw error;
    }
  }

  /**
   * 이미지 캡처 중지 (공개 메소드)
   * 진행중인 캡처 프로세스를 중지하고 상태 초기화
   */
  stopCapture() {
    if (this.captureIntervalId) {
      clearInterval(this.captureIntervalId);
      this.captureIntervalId = null;
    }
    
    this.captureState = 0;
    this.isSaved = false;
    console.log('Capture stopped');
  }

  /**
   * 포트 열림 이벤트 처리
   * 시리얼 포트가 성공적으로 열렸을 때 실행되는 초기화 로직
   */
  onPortOpen() {
    console.log(`Spinel Camera connected: 0x${this.config.cameraId.toString(16).padStart(2, '0')}`);
    console.log(`Resolution: ${this.getResolutionName()}, Quality: ${this.config.quality}/8, Packet: ${this.config.packetSize}B`);
    
    // 자동 캡처 제거 - 외부에서 호출하도록 변경
    // setTimeout(() => { this.startCapture(); }, 3000);  // 제거됨
  }

  /**
   * 카메라 상태 정보 조회 (공개 메소드)
   * @returns {Object} 현재 카메라 상태
   */
  getStatus() {
    return {
      isCapturing: this.captureIntervalId !== null,
      captureState: this.captureState,
      packetCounter: this.packetCounter,
      totalPackets: this.packetNum,
      imageSize: this.imageBuffer.length,
      expectedSize: this.snapshotSize,
      lastUpdate: Date.now()
    };
  }

  /**
   * 카메라 설정 정보 조회 (공개 메소드)
   * @returns {Object} 현재 카메라 설정
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * 카메라 연결 해제 및 리소스 정리 (공개 메소드)
   * 시리얼 포트를 닫고 모든 타이머를 정리
   */
  async close() {
    try {
      // 캡처 중지
      this.stopCapture();

      // 시리얼 포트 닫기
      if (this.port && this.port.isOpen) {
        await new Promise((resolve) => {
          this.port.close((err) => {
            if (err) console.error('Port close error:', err);
            resolve();
          });
        });
      }

      console.log('Spinel Camera closed');
      
    } catch (error) {
      console.error('Camera close error:', error);
      throw error;
    }
  }

  /**
   * 카메라 헬스체크 (공개 메소드)
   * 카메라 연결 상태 및 정상 작동 여부 확인
   * @returns {Object} 헬스체크 결과
   */
  isHealthy() {
    return {
      serialConnected: this.port?.isOpen || false,
      isCapturing: this.captureIntervalId !== null,
      lastCaptureTime: this.captureEndTime,
      configValid: this.config.cameraId > 0 && this.config.packetSize >= 512
    };
  }
}

// Spinel Camera 모듈 export (테스트 코드 제거됨)
export default SpinelCamera;