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

      // 이미 FITS에서 비닝 처리된 데이터를 그대로 사용
      
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
   * 2x2 비닝 적용 (소프트웨어 비닝)
   * @param {Array} data 원본 이미지 데이터
   * @param {number} width 원본 폭
   * @param {number} height 원본 높이
   * @returns {Object} 비닝된 이미지 데이터
   */
  applyBinning2x2(data, width, height) {
    const newWidth = Math.floor(width / 2);
    const newHeight = Math.floor(height / 2);
    const binnedData = new Array(newWidth * newHeight);

    for (let y = 0; y < newHeight; y++) {
      for (let x = 0; x < newWidth; x++) {
        // 2x2 픽셀의 평균값 계산
        const srcX = x * 2;
        const srcY = y * 2;

        const pixel1 = data[srcY * width + srcX];
        const pixel2 = data[srcY * width + srcX + 1];
        const pixel3 = data[(srcY + 1) * width + srcX];
        const pixel4 = data[(srcY + 1) * width + srcX + 1];

        // 4개 픽셀의 평균
        binnedData[y * newWidth + x] = Math.round((pixel1 + pixel2 + pixel3 + pixel4) / 4);
      }
    }

    return {
      data: binnedData,
      width: newWidth,
      height: newHeight
    };
  }

  /**
   * 이미지를 FITS 형식으로 저장하고 동시에 JPG 썸네일도 생성
   * @param {Object} image 이미지 데이터 객체
   * @param {string} filename 저장할 파일 경로
   * @param {Object} options 옵션 객체 (jpgPath: JPG 저장 경로, quality: JPG 품질)
   */
  async saveAsFits(image, filename, options = {}) {
    if (!image || !image.data) {
      throw new Error('유효한 이미지 데이터가 아닙니다.');
    }

    try {
      let { data, width, height, bitsPerPixel, binning, exposureTime } = image;

      // 2x2 비닝 처리 (FITS에서만)
      if (binning === "2x2") {
        const binnedResult = this.applyBinning2x2(data, width, height);
        data = binnedResult.data;
        width = binnedResult.width;
        height = binnedResult.height;
        console.log(`FITS 2x2 비닝 적용: ${width}x${height}`);

        // 비닝된 데이터를 원본 객체에 업데이트 (JPG에서 사용하기 위해)
        image.data = data;
        image.width = width;
        image.height = height;
      }

      // 바이닝 정보 파싱
      const isBinned = binning === "2x2";

      console.log(`이미지 FITS 변환 시작: ${width}x${height}${isBinned ? ' (2x2 비닝)' : ''}`);

      // 안전한 방법으로 min/max 찾기
      let min = 65535;
      let max = 0;

      for (let i = 0; i < data.length; i++) {
        if (data[i] < min) min = data[i];
        if (data[i] > max) max = data[i];
      }

      console.log(`데이터 범위: ${min} ~ ${max}`);

      // FITS 헤더 생성 (정확한 80자 형식)
      const createHeaderLine = (key, value, comment) => {
        if (key === 'END') {
          return 'END' + ' '.repeat(77);
        }

        let line;
        if (typeof value === 'boolean') {
          line = `${key.padEnd(8)}= ${value ? 'T' : 'F'.padStart(20)}`;
        } else if (typeof value === 'number') {
          line = `${key.padEnd(8)}= ${value.toString().padStart(20)}`;
        } else if (typeof value === 'string') {
          // 문자열은 작은따옴표로 감싸고 최소 8자까지 패딩
          const quotedValue = `'${value.padEnd(8)}'`;
          line = `${key.padEnd(8)}= ${quotedValue.padStart(20)}`;
        }

        if (comment) {
          line += ` / ${comment}`;
        }

        // 정확히 80자로 맞추기
        return line.padEnd(80).substring(0, 80);
      };

      const headerLines = [
        createHeaderLine('SIMPLE', true, 'Standard FITS format'),
        createHeaderLine('BITPIX', -32, '32-bit floating point'), // float으로 변경
        createHeaderLine('NAXIS', 2, 'Number of data axes'),
        createHeaderLine('NAXIS1', width, 'Width in pixels'),
        createHeaderLine('NAXIS2', height, 'Height in pixels'),
        createHeaderLine('EXPTIME', exposureTime || 0, 'Exposure time in seconds'),
        createHeaderLine('INSTRUME', 'SX ECHO2', 'Camera model'),
        createHeaderLine('DETECTOR', 'ICX825AL', 'CCD sensor'),
        createHeaderLine('XPIXSZ', 6.45, 'Pixel size X (microns)'),
        createHeaderLine('YPIXSZ', 6.45, 'Pixel size Y (microns)'),
        createHeaderLine('XBINNING', isBinned ? 2 : 1, 'X binning factor'),
        createHeaderLine('YBINNING', isBinned ? 2 : 1, 'Y binning factor'),
        createHeaderLine('DATE-OBS', new Date().toISOString().substring(0, 19), 'Observation date'),
        createHeaderLine('SOFTWARE', 'SX-Camera', 'Software used'),
        createHeaderLine('DATAMAX', max, 'Maximum pixel value'),
        createHeaderLine('DATAMIN', min, 'Minimum pixel value'),
        createHeaderLine('OBJECT', 'Unknown', 'Target object'),
        createHeaderLine('OBSERVER', 'Unknown', 'Observer name'),
        createHeaderLine('TELESCOP', 'Unknown', 'Telescope used'),
        createHeaderLine('END')
      ];

      // 헤더를 하나의 문자열로 결합
      let headerStr = headerLines.join('');

      // 2880바이트 블록으로 패딩
      const headerBlockSize = Math.ceil(headerStr.length / 2880) * 2880;
      headerStr = headerStr.padEnd(headerBlockSize, ' ');
      const headerBuffer = Buffer.from(headerStr, 'ascii');

      console.log(`FITS 헤더 크기: ${headerBuffer.length} 바이트`);

      // 데이터를 32비트 big-endian float로 변환 (더 호환성 좋음)
      const dataBuffer = Buffer.allocUnsafe(data.length * 4);
      for (let i = 0; i < data.length; i++) {
        // uint16을 float로 변환, big-endian
        dataBuffer.writeFloatBE(data[i], i * 4);
      }

      // 데이터를 2880바이트 블록으로 패딩
      const paddingSize = (2880 - (dataBuffer.length % 2880)) % 2880;
      const paddingBuffer = Buffer.alloc(paddingSize);

      console.log(`이미지 데이터 크기: ${dataBuffer.length} 바이트, 패딩: ${paddingSize} 바이트`);

      // 전체 FITS 파일 생성
      const fitsBuffer = Buffer.concat([headerBuffer, dataBuffer, paddingBuffer]);

      // 파일 저장
      const fs = (await import('fs')).promises;
      await fs.writeFile(filename, fitsBuffer);

      console.log(`이미지가 FITS 형식으로 저장되었습니다: ${filename}`);
      console.log(`총 파일 크기: ${fitsBuffer.length} 바이트`);
      console.log(`헤더 정보: ${width}x${height}, ${exposureTime || 0}초, ${isBinned ? '2x2 비닝' : '풀 해상도'}`);

      // JPG 썸네일도 같이 생성 (같은 비닝된 데이터 사용)
      if (options.jpgPath) {
        await this.createJPGFromBinnedData(data, width, height, bitsPerPixel, options.jpgPath, options.quality || 70, isBinned);
        console.log(`JPG 썸네일 저장: ${options.jpgPath}`);
      }

    } catch (error) {
      throw new Error(`FITS 이미지 저장 실패: ${error.message}`);
    }
  }

  /**
   * 비닝된 데이터로 JPG 파일 생성
   * @param {Array} data 비닝된 이미지 데이터
   * @param {number} width 비닝된 이미지 폭
   * @param {number} height 비닝된 이미지 높이
   * @param {number} bitsPerPixel 비트 깊이
   * @param {string} filename JPG 파일 경로
   * @param {number} quality JPG 품질 (1-100)
   * @param {boolean} isBinned 비닝 적용 여부
   */
  async createJPGFromBinnedData(data, width, height, bitsPerPixel, filename, quality = 70, isBinned = false) {
    try {
      console.log(`JPG 생성 시작: ${width}x${height}${isBinned ? ' (2x2 비닝됨)' : ' (원본)'}`);

      const maxVal = (1 << bitsPerPixel) - 1;
      const buffer = Buffer.alloc(width * height);

      // 데이터 분석을 위한 변수
      let min = maxVal;
      let max = 0;

      // 최소/최대값 찾기 (명암 스트레칭용)
      for (let i = 0; i < width * height; i++) {
        if (data[i] < min) min = data[i];
        if (data[i] > max) max = data[i];
      }

      console.log(`JPG 데이터 범위: ${min} ~ ${max} (${isBinned ? '비닝된' : '원본'} 데이터)`);

      // 히스토그램 클리핑 적용 (비닝된 데이터는 더 관대하게)
      if (max - min > 0) {
        const pixelValues = Array.from(data).sort((a, b) => a - b);
        const clipPercent = isBinned ? 0.005 : 0.001; // 비닝된 데이터는 0.5%, 원본은 0.1% 클리핑
        const clipIndex = Math.floor(pixelValues.length * clipPercent);
        min = pixelValues[clipIndex];
        max = pixelValues[pixelValues.length - 1 - clipIndex];

        console.log(`히스토그램 클리핑 후: ${min} ~ ${max} (${clipPercent*100}% 클리핑)`);
      }

      // 스트레칭 적용해서 8비트로 변환
      const range = max - min;
      for (let i = 0; i < width * height; i++) {
        if (range > 0) {
          // 비닝된 데이터는 좀 더 부드러운 스트레칭 적용
          const normalized = (data[i] - min) / range;
          const stretched = isBinned ?
            Math.pow(normalized, 0.8) : // 비닝된 데이터는 감마 0.8 적용 (더 밝게)
            normalized;                   // 원본 데이터는 선형 스트레칭
          buffer[i] = Math.min(255, Math.max(0, Math.round(stretched * 255)));
        } else {
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