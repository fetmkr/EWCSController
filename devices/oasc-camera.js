// OASC Camera Device Module - Starlight Xpress All Sky Camera
// 기존 OASC app.js 코드를 그대로 유지하면서 EWCS 패턴에 맞게 래핑

import { SXCamera } from '../oasc/lib/sx-camera.js';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class OASCCamera {
  constructor() {
    this.camera = null;
    this.isConnected = false;
    this.isCapturing = false;
    this.data = {
      lastCaptureTime: null,
      lastImageFile: null,
      cameraInfo: null,
      status: 'disconnected'
    };
    
    // OASC 이미지 저장 경로
    this.imagesBaseDir = path.join(__dirname, '../oasc-images');
  }

  /**
   * 현재 시간을 포맷된 문자열로 반환하는 함수 (기존 OASC 코드 그대로)
   */
  getFormattedTime() {
    const now = new Date();
    return now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  }

  /**
   * 월별 폴더 경로 생성 (EWCS 스타일)
   */
  getMonthlyImageDir() {
    const now = new Date();
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    return path.join(this.imagesBaseDir, `${year}-${month}`);
  }

  async initialize() {
    try {
      console.log('[OASC] Initializing Starlight Xpress Camera...');
      
      // 카메라 객체 생성 (기존 OASC 코드 그대로)
      this.camera = new SXCamera();
      
      // 베이스 이미지 디렉토리 생성
      await mkdir(this.imagesBaseDir, { recursive: true });
      
      console.log('[OASC] OASC Camera module initialized');
      return true;
    } catch (error) {
      console.error('[OASC] Failed to initialize OASC Camera:', error);
      throw error;
    }
  }

  async connect() {
    try {
      if (this.isConnected) {
        console.log('[OASC] Camera already connected');
        return true;
      }

      console.log('[OASC] 카메라 연결 시도...');
      const connected = this.camera.connect();
      
      if (!connected) {
        const error = this.camera.getLastError();
        console.error('[OASC] 카메라 연결 실패:', error);
        this.data.status = 'connection_failed';
        return false;
      }

      this.isConnected = true;
      this.data.status = 'connected';
      console.log('[OASC] 카메라 연결 성공!');

      // 카메라 정보 가져오기 (기존 OASC 코드 그대로)
      try {
        const cameraInfo = this.camera.getCameraInfo();
        this.data.cameraInfo = cameraInfo;
        console.log('[OASC] 카메라 정보:');
        console.log(`[OASC]  - 모델: ${cameraInfo.model} (코드: ${cameraInfo.modelCode})`);
        console.log(`[OASC]  - 펌웨어 버전: ${cameraInfo.firmwareVersion}`);
      } catch (error) {
        console.error('[OASC] 카메라 정보 가져오기 실패:', error.message);
      }

      return true;
    } catch (error) {
      console.error('[OASC] Camera connection error:', error);
      this.data.status = 'error';
      return false;
    }
  }

  async disconnect() {
    try {
      if (!this.isConnected) {
        return true;
      }

      console.log('[OASC] 카메라 연결 해제...');
      this.camera.disconnect();
      this.isConnected = false;
      this.data.status = 'disconnected';
      console.log('[OASC] 카메라 연결 해제 완료');
      return true;
    } catch (error) {
      console.error('[OASC] Camera disconnect error:', error);
      return false;
    }
  }

  /**
   * 이미지 캡처 (기존 OASC 코드 로직 그대로 유지)
   * @param {number|string} exposureTimeOrOptions - 노출 시간 또는 옵션 객체
   * @param {string} customDir - 사용자 지정 저장 폴더 (옵션)
   */
  async captureImage(exposureTimeOrOptions = 10.0, customDir = null) {
    try {
      if (!this.isConnected) {
        throw new Error('Camera not connected');
      }

      if (this.isCapturing) {
        throw new Error('Camera is already capturing');
      }

      // 파라미터 처리: 첫 번째 인수가 문자열이면 filename으로 처리
      let exposureTime = 10.0;
      let customFilename = null;
      
      if (typeof exposureTimeOrOptions === 'string') {
        customFilename = exposureTimeOrOptions;
      } else if (typeof exposureTimeOrOptions === 'number') {
        exposureTime = exposureTimeOrOptions;
      }

      this.isCapturing = true;
      this.data.status = 'capturing';
      
      console.log(`[OASC] 이미지 캡처 시작 (노출 시간: ${exposureTime}초)...`);

      // 이미지 캡처 (기존 OASC 코드 그대로)
      const image = this.camera.captureImage(exposureTime);
      console.log(`[OASC] 이미지 캡처 완료: ${image.width}x${image.height}, ${image.bitsPerPixel}비트`);

      // 저장 디렉토리 결정
      let imagesDir;
      if (customDir) {
        // 사용자 지정 폴더가 있으면 월별 구조 추가
        const now = new Date();
        const year = now.getFullYear();
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        imagesDir = path.join(customDir, `${year}-${month}`);
      } else {
        // 기본 월별 이미지 저장 디렉토리
        imagesDir = this.getMonthlyImageDir();
      }
      
      await mkdir(imagesDir, { recursive: true });

      // 파일명 결정
      let filename;
      if (customFilename) {
        // 사용자 지정 파일명 사용
        filename = customFilename.endsWith('.jpg') ? customFilename : `${customFilename}.jpg`;
      } else {
        // 기본 타임스탬프 파일명 생성
        const timestamp = this.getFormattedTime();
        filename = `oasc_${timestamp}.jpg`;
      }
      
      // JPG 형식으로 저장 (기존 OASC 코드 설정 그대로: 명암 스트레칭 및 90% 품질)
      const jpgFilename = join(imagesDir, filename);
      
      // 이미지 저장 시작
      await this.camera.saveAsJPG(image, jpgFilename, { quality: 90, stretch: true });
      console.log(`[OASC] 이미지 저장 시작: ${jpgFilename}`);

      // 파일 저장 완료 확인 (노출 시간 + 10초 타임아웃)
      // 노출 시간이 길수록 이미지 처리 및 저장 시간도 더 필요
      const saveTimeout = Math.max(15000, (exposureTime * 1000) + 10000); // 최소 15초, 노출시간 + 10초
      console.log(`[OASC] 파일 저장 대기 중... (타임아웃: ${saveTimeout/1000}초)`);
      
      const fileExists = await this.waitForFileSave(jpgFilename, saveTimeout);
      
      if (!fileExists) {
        console.error(`[OASC] 이미지 저장 실패: ${saveTimeout/1000}초 타임아웃`);
        this.data.status = this.isConnected ? 'connected' : 'disconnected';
        this.isCapturing = false;
        return {
          success: false,
          reason: 'save_timeout',
          filename: filename,
          path: jpgFilename
        };
      }

      console.log(`[OASC] 이미지 저장 완료 확인: ${jpgFilename}`);

      // 데이터 업데이트
      this.data.lastCaptureTime = Date.now();
      this.data.lastImageFile = filename;
      this.data.status = 'connected';
      this.isCapturing = false;

      return {
        success: true,
        filename: filename,
        path: jpgFilename,
        savedPath: jpgFilename, // app.js 호환성을 위해 추가
        timestamp: this.data.lastCaptureTime,
        imageInfo: {
          width: image.width,
          height: image.height,
          bitsPerPixel: image.bitsPerPixel
        }
      };

    } catch (error) {
      console.error('[OASC] 이미지 캡처 실패:', error);
      this.data.status = this.isConnected ? 'connected' : 'disconnected';
      this.isCapturing = false;
      throw error;
    }
  }

  /**
   * 파일 저장 완료 대기 (내부 메소드)
   * 지정된 경로에 파일이 생성될 때까지 기다림
   * @param {string} filePath - 확인할 파일 경로
   * @param {number} timeoutMs - 타임아웃 (밀리초)
   * @returns {Promise<boolean>} 파일 존재 여부
   */
  async waitForFileSave(filePath, timeoutMs = 15000) {
    const startTime = Date.now();
    const { existsSync } = await import('fs');
    
    return new Promise((resolve) => {
      const checkFile = setInterval(() => {
        const elapsed = Date.now() - startTime;
        
        if (existsSync(filePath)) {
          clearInterval(checkFile);
          resolve(true);
        } else if (elapsed >= timeoutMs) {
          clearInterval(checkFile);
          resolve(false);
        }
        // 1초마다 체크
      }, 1000);
    });
  }

  /**
   * 카메라 디버깅 테스트 (기존 OASC 코드 그대로)
   */
  async debugCamera() {
    try {
      if (!this.isConnected) {
        throw new Error('Camera not connected');
      }

      console.log('[OASC] 카메라 디버깅 함수 호출...');
      const result = this.camera.debugCamera();
      console.log('[OASC] 디버깅 결과:', result ? '성공' : '실패');
      
      return { success: result };
    } catch (error) {
      console.error('[OASC] 디버깅 중 오류 발생:', error);
      throw error;
    }
  }

  // EWCS 패턴에 맞는 표준 메서드들
  getData() {
    return {
      ...this.data,
      isConnected: this.isConnected,
      isCapturing: this.isCapturing
    };
  }

  /**
   * 카메라 연결 상태 확인 (실제 통신 테스트)
   * getCameraInfo로 연결 상태 검증
   * @returns {Promise<boolean>} 연결 상태
   */
  async checkConnection() {
    try {
      if (!this.camera) {
        return false;
      }

      // getCameraInfo 호출로 실제 연결 상태 확인
      const cameraInfo = this.camera.getCameraInfo();
      
      // 카메라 정보가 정상적으로 반환되면 연결됨
      if (cameraInfo && cameraInfo.model) {
        console.log(`[OASC] Connection OK - Model: ${cameraInfo.model}`);
        return true;
      } else {
        console.log('[OASC] Connection failed - No camera info');
        return false;
      }
    } catch (error) {
      console.error('[OASC] Connection check failed:', error.message);
      return false;
    }
  }

  isHealthy() {
    return {
      healthy: this.isConnected && this.data.status !== 'error',
      status: this.data.status,
      lastError: this.data.lastError || null
    };
  }

  async close() {
    try {
      await this.disconnect();
      console.log('[OASC] OASC Camera module closed');
    } catch (error) {
      console.error('[OASC] Error closing OASC Camera:', error);
    }
  }
}

export default OASCCamera;