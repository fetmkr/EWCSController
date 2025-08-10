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
   */
  async captureImage(exposureTime = 10.0) {
    try {
      if (!this.isConnected) {
        throw new Error('Camera not connected');
      }

      if (this.isCapturing) {
        throw new Error('Camera is already capturing');
      }

      this.isCapturing = true;
      this.data.status = 'capturing';
      
      console.log(`[OASC] 이미지 캡처 시작 (노출 시간: ${exposureTime}초)...`);

      // 이미지 캡처 (기존 OASC 코드 그대로)
      const image = this.camera.captureImage(exposureTime);
      console.log(`[OASC] 이미지 캡처 완료: ${image.width}x${image.height}, ${image.bitsPerPixel}비트`);

      // 월별 이미지 저장 디렉토리 생성
      const imagesDir = this.getMonthlyImageDir();
      await mkdir(imagesDir, { recursive: true });

      // 타임스탬프를 이용한 파일명 생성 (기존 OASC 코드 그대로)
      const timestamp = this.getFormattedTime();
      
      // JPG 형식으로 저장 (기존 OASC 코드 설정 그대로: 명암 스트레칭 및 90% 품질)
      const jpgFilename = join(imagesDir, `oasc_${timestamp}.jpg`);
      await this.camera.saveAsJPG(image, jpgFilename, { quality: 90, stretch: true });
      console.log(`[OASC] 이미지가 저장되었습니다: ${jpgFilename}`);

      // 데이터 업데이트
      this.data.lastCaptureTime = Date.now();
      this.data.lastImageFile = `oasc_${timestamp}.jpg`;
      this.data.status = 'connected';
      this.isCapturing = false;

      return {
        success: true,
        filename: `oasc_${timestamp}.jpg`,
        path: jpgFilename,
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