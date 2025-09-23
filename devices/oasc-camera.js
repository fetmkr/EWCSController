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
    this.imagesBaseDir = path.join(__dirname, '../oasc_images');
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
      //console.log('[OASC] Initializing Starlight Xpress Camera...');
      
      // 카메라 객체 생성 (기존 OASC 코드 그대로)
      this.camera = new SXCamera();
      
      // 베이스 이미지 디렉토리 생성
      await mkdir(this.imagesBaseDir, { recursive: true });
      
      console.log('[OASC] OASC Camera module initialized');
      return { success: true };
    } catch (error) {
      console.error('[OASC] Failed to initialize OASC Camera:', error);
      return { success: false, error: error.message };
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
        //console.log('[OASC] 카메라 정보:');
        //console.log(`[OASC]  - 모델: ${cameraInfo.model} (코드: ${cameraInfo.modelCode})`);
        //console.log(`[OASC]  - 펌웨어 버전: ${cameraInfo.firmwareVersion}`);
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
   * 이미지 캡처 - FITS 원본 저장 + JPG 썸네일 생성
   * @param {number|string|object} exposureTimeOrOptions - 노출 시간 또는 옵션 객체
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

      // 파라미터 처리
      let exposureTime = 10.0;
      let customFilename = null;

      if (typeof exposureTimeOrOptions === 'string') {
        customFilename = exposureTimeOrOptions;
      } else if (typeof exposureTimeOrOptions === 'number') {
        exposureTime = exposureTimeOrOptions;
      } else if (typeof exposureTimeOrOptions === 'object' && exposureTimeOrOptions !== null) {
        exposureTime = exposureTimeOrOptions.exposureTime || 10.0;
        customFilename = exposureTimeOrOptions.filename || null;
      }

      this.isCapturing = true;
      this.data.status = 'capturing';

      console.log(`[OASC] 이미지 캡처 시작 (노출 시간: ${exposureTime}초)...`);

      // 이미지 캡처
      const image = this.camera.captureImage(exposureTime);
      console.log(`[OASC] 이미지 캡처 완료: ${image.width}x${image.height}, ${image.bitsPerPixel}비트`);

      // FITS 저장을 위한 binning 정보 추가 (saveAsFits에서 비닝 처리됨)
      image.binning = "2x2";
      image.exposureTime = exposureTime;

      // 저장 디렉토리 결정
      let imagesDir;
      if (customDir) {
        const now = new Date();
        const year = now.getFullYear();
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        imagesDir = path.join(customDir, `${year}-${month}`);
      } else {
        imagesDir = this.getMonthlyImageDir();
      }

      await mkdir(imagesDir, { recursive: true });

      // JPG 서브폴더 생성
      const jpgDir = path.join(imagesDir, 'jpg');
      await mkdir(jpgDir, { recursive: true });

      // 파일명 결정 (타임스탬프 기반)
      const timestamp = Date.now();
      const baseFilename = customFilename || timestamp.toString();

      // FITS 파일 저장과 동시에 JPG 썸네일 생성
      const fitsFilename = join(imagesDir, `${baseFilename}.fits`);
      const jpgFilename = join(jpgDir, `${baseFilename}.jpg`);

      await this.camera.saveAsFits(image, fitsFilename, {
        exposureTime,
        jpgPath: jpgFilename,
        quality: 70
      });
      console.log(`[OASC] FITS 원본 저장: ${fitsFilename}`);
      console.log(`[OASC] JPG 썸네일 저장: ${jpgFilename}`);

      // 파일 저장 완료 확인 (FITS 파일 확인)
      const saveTimeout = Math.max(15000, (exposureTime * 1000) + 10000);
      console.log(`[OASC] 파일 저장 대기 중... (타임아웃: ${saveTimeout/1000}초)`);

      const fitsExists = await this.waitForFileSave(fitsFilename, saveTimeout);
      const jpgExists = await this.waitForFileSave(jpgFilename, 5000); // JPG는 5초만 대기

      if (!fitsExists || !jpgExists) {
        console.error(`[OASC] 이미지 저장 실패: ${!fitsExists ? 'FITS' : 'JPG'} 저장 타임아웃`);
        this.data.status = this.isConnected ? 'connected' : 'disconnected';
        this.isCapturing = false;
        return {
          success: false,
          reason: 'save_timeout',
          filename: baseFilename,
          fitsPath: fitsFilename,
          jpgPath: jpgFilename
        };
      }

      console.log(`[OASC] 이미지 저장 완료: FITS & JPG`);

      // 데이터 업데이트
      this.data.lastCaptureTime = Date.now();
      this.data.lastImageFile = `${baseFilename}.fits`;
      this.data.lastJpgFile = `jpg/${baseFilename}.jpg`;  // 프리뷰용 경로
      this.data.status = 'connected';
      this.isCapturing = false;

      return {
        success: true,
        filename: `${baseFilename}.fits`,
        fitsPath: fitsFilename,
        jpgPath: jpgFilename,
        savedPath: fitsFilename,  // app.js 호환성
        previewPath: jpgFilename,  // 웹 뷰어용
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

      // 이미 연결된 상태라면 USB 재접근 시도하지 않음
      if (this.isConnected && this.data.cameraInfo) {
        console.log(`[OASC] Connection OK - Model: ${this.data.cameraInfo.model}`);
        return true;
      }

      // 연결되지 않은 경우에만 실제 연결 상태 확인
      if (!this.isConnected) {
        try {
          const cameraInfo = this.camera.getCameraInfo();

          if (cameraInfo && cameraInfo.model) {
            this.isConnected = true;
            this.data.cameraInfo = cameraInfo;
            this.data.status = 'connected';
            console.log(`[OASC] Connection OK - Model: ${cameraInfo.model}`);
            return true;
          }
        } catch (error) {
          // USB 접근 실패 시 연결 상태 리셋
          this.isConnected = false;
          this.data.status = 'disconnected';
          console.log('[OASC] Connection failed - USB access error:', error.message);
          return false;
        }
      }

      console.log('[OASC] Connection failed - No camera info');
      return false;
    } catch (error) {
      console.error('[OASC] Connection check failed:', error.message);
      this.isConnected = false;
      this.data.status = 'error';
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