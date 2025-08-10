// lib/sx-camera.js
import { join } from 'path';
import { writeFile } from 'fs/promises';

// 네이티브 모듈 로드
import { native } from './native-loader.js';
const nativeModule = native;

/**
 * Starlight Xpress 카메라 클래스
 */
export class SXCamera {
  /**
   * 생성자
   */
  constructor() {
    this._camera = new nativeModule.SXCamera();
  }

  /**
   * 카메라 연결
   * @returns {boolean} 연결 성공 여부
   */
  connect() {
    return this._camera.open();
  }

  /**
   * 카메라 연결 해제
   */
  disconnect() {
    if (this.isConnected()) {
      this._camera.close();
    }
  }

  /**
   * 카메라 연결 상태 확인
   * @returns {boolean} 연결 여부
   */
  isConnected() {
    return this._camera.isConnected();
  }

  /**
   * 마지막 오류 메시지 가져오기
   * @returns {string} 오류 메시지
   */
  getLastError() {
    return this._camera.getLastError();
  }

  /**
   * 카메라 정보 가져오기
   * @returns {Object} 카메라 정보 객체
   */
  getCameraInfo() {
    if (!this.isConnected()) {
      throw new Error('카메라가 연결되어 있지 않습니다.');
    }

    try {
      const model = this._camera.getCameraModel();
      const firmwareVersion = this._camera.getFirmwareVersion();

      return {
        model: model.modelName,
        modelCode: model.modelCode,
        firmwareVersion: firmwareVersion
      };
    } catch (error) {
      throw new Error(`카메라 정보 가져오기 실패: ${error.message}`);
    }
  }

  /**
   * 이미지 촬영
   * @param {number} exposureTime 노출 시간(초)
   * @returns {Object} 이미지 데이터 객체
   */
  captureImage(exposureTime = 1.0) {
    if (!this.isConnected()) {
      throw new Error('카메라가 연결되어 있지 않습니다.');
    }

    try {
      return this._camera.captureImage(exposureTime);
    } catch (error) {
      throw new Error(`이미지 캡처 실패: ${error.message}`);
    }
  }

  /**
   * 이미지를 PGM 형식으로 저장
   * @param {Object} image 이미지 데이터 객체
   * @param {string} filename 저장할 파일 경로
   */
  async saveAsPGM(image, filename) {
    if (!image || !image.data) {
      throw new Error('유효한 이미지 데이터가 아닙니다.');
    }

    const { data, width, height, bitsPerPixel } = image;

    // PGM 헤더 생성
    const header = `P5\n${width} ${height}\n${(1 << bitsPerPixel) - 1}\n`;
    
    // 바이너리 데이터 준비
    const maxVal = (1 << bitsPerPixel) - 1;
    const buffer = Buffer.alloc(width * height);

    // 16비트 데이터를 8비트로 변환 (PGM용)
    for (let i = 0; i < width * height; i++) {
      // 16비트에서 8비트로 스케일링
      buffer[i] = Math.round((data[i] / maxVal) * 255);
    }

    // 파일 저장
    const headerBuffer = Buffer.from(header);
    const finalBuffer = Buffer.concat([headerBuffer, buffer]);
    await writeFile(filename, finalBuffer);
  }

  /**
   * 이미지를 JPG 형식으로 저장
   * @param {Object} image 이미지 데이터 객체
   * @param {string} filename 저장할 파일 경로
   * @param {Object} options 옵션 객체 (quality: 품질(1-100), stretch: 명암 스트레칭 여부)
   */
  async saveAsJPG(image, filename, options = {}) {
    if (!image || !image.data) {
      throw new Error('유효한 이미지 데이터가 아닙니다.');
    }

    try {
      // 옵션 설정
      const quality = options.quality || 90; // 기본 품질 90
      const stretch = options.stretch !== undefined ? options.stretch : true; // 기본적으로 명암 스트레칭 활성화
      
      const { data, width, height, bitsPerPixel } = image;
      
      // 16비트 데이터를 8비트 raw 버퍼로 변환
      const maxVal = (1 << bitsPerPixel) - 1;
      const buffer = Buffer.alloc(width * height);
      
      // 데이터 분석을 위한 변수
      let min = maxVal;
      let max = 0;
      
      // 최소/최대값 찾기 (명암 스트레칭용)
      if (stretch) {
        for (let i = 0; i < width * height; i++) {
          if (data[i] < min) min = data[i];
          if (data[i] > max) max = data[i];
        }
        
        // 최소/최대값이 너무 극단적이면 조정 (이상치 제거)
        if (max - min > 0) {
          // 히스토그램 클리핑 (상위 0.1%, 하위 0.1% 제외)
          const pixelValues = Array.from(data).sort((a, b) => a - b);
          const clipIndex = Math.floor(pixelValues.length * 0.001);
          min = pixelValues[clipIndex];
          max = pixelValues[pixelValues.length - 1 - clipIndex];
        }
      }
      
      // 스트레칭 적용
      const range = max - min;
      for (let i = 0; i < width * height; i++) {
        // 명암 스트레칭 적용
        if (stretch && range > 0) {
          // 0-255 범위로 변환
          buffer[i] = Math.min(255, Math.max(0, Math.round(((data[i] - min) / range) * 255)));
        } else {
          // 단순 스케일링
          buffer[i] = Math.round((data[i] / maxVal) * 255);
        }
      }
      
      // sharp 라이브러리로 raw 데이터를 JPG로 변환
      const sharp = (await import('sharp')).default;
      await sharp(buffer, {
        raw: {
          width,
          height,
          channels: 1
        }
      })
      .jpeg({ quality })
      .toFile(filename);
      
      console.log(`이미지가 JPG 형식으로 저장되었습니다: ${filename}`);
    } catch (error) {
      throw new Error(`JPG 이미지 저장 실패: ${error.message}`);
    }
  }

  /**
   * 카메라 디버깅 함수
   * @returns {boolean} 디버깅 성공 여부
   */
  debugCamera() {
    if (!this.isConnected()) {
      throw new Error('카메라가 연결되어 있지 않습니다.');
    }
    
    try {
      // 네이티브 디버깅 함수 호출
      return this._camera.debugCamera();
    } catch (error) {
      console.error('카메라 디버깅 중 오류 발생:', error);
      throw error;
    }
  }
}