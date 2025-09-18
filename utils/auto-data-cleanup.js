import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class AutoDataCleanup {
  constructor() {
    this.config = {
      maxDiskUsagePercent: 80,    // 디스크 사용률 80% 이상일 때만 실행
      criticalDiskUsagePercent: 90, // 90% 이상이면 강제 정리
      minFileAgedays: 365,        // 1년 이상된 파일만 삭제
      minPreserveCount: 2000,     // 최신 2000개 파일 무조건 보존
      maxDeletePercentage: 10,    // 한 번에 최대 10%만 삭제
      minRecentFiles: 100,        // 최근 7일 이내 최소 파일 수
      recentDaysCheck: 7          // 최근 활동 확인 기간
    };

    this.cleanupLog = [];
    this.configPath = path.join(__dirname, '../config.json');
    this.basePaths = {
      spinel: path.join(__dirname, '../ewcs_images'),
      oasc: path.join(__dirname, '../oasc_images'),
      database: path.join(__dirname, '../data')
    };
  }

  /**
   * 디스크 사용률 확인
   * @returns {Promise<number>} 디스크 사용률 (%)
   */
  async getDiskUsage() {
    try {
      const { execAsync } = await import('child_process');
      const { promisify } = await import('util');
      const exec = promisify(execAsync);

      const { stdout } = await exec("df / | tail -1 | awk '{print $5}' | sed 's/%//'");
      return parseInt(stdout.trim());
    } catch (error) {
      console.error('[CLEANUP] Failed to get disk usage:', error.message);
      return 0; // 안전하게 0 반환 (정리 실행 안함)
    }
  }

  /**
   * 시스템 건강 상태 확인
   * @returns {boolean} 시스템이 정상인지 여부
   */
  isSystemHealthy() {
    const now = new Date();

    // 시간 검증 (2024년 이후인지)
    if (now.getFullYear() < 2024) {
      console.error('[CLEANUP] System time error detected - cleanup aborted');
      return false;
    }

    return true;
  }

  /**
   * 최근 파일 개수 확인
   * @param {number} days 확인할 기간 (일)
   * @returns {Promise<number>} 최근 파일 개수
   */
  async getRecentFileCount(days = 7) {
    const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
    let count = 0;

    try {
      for (const [camera, basePath] of Object.entries(this.basePaths)) {
        if (camera === 'database') continue;

        const files = await this.getAllImageFiles(basePath);
        for (const file of files) {
          const timestamp = this.extractTimestampFromFilename(file.name);
          if (timestamp && timestamp > cutoffTime) {
            count++;
          }
        }
      }
    } catch (error) {
      console.error('[CLEANUP] Failed to count recent files:', error.message);
      return 0;
    }

    return count;
  }

  /**
   * 파일명에서 타임스탬프 추출
   * @param {string} filename 파일명
   * @returns {number|null} 타임스탬프 또는 null
   */
  extractTimestampFromFilename(filename) {
    const match = filename.match(/(\d{13})/); // 13자리 타임스탬프
    return match ? parseInt(match[1]) : null;
  }

  /**
   * 모든 이미지 파일 수집
   * @param {string} basePath 기본 경로
   * @returns {Promise<Array>} 파일 정보 배열
   */
  async getAllImageFiles(basePath) {
    const files = [];

    try {
      const exists = await fs.access(basePath).then(() => true).catch(() => false);
      if (!exists) return files;

      await this.scanDirectory(basePath, files);
    } catch (error) {
      console.error(`[CLEANUP] Failed to scan ${basePath}:`, error.message);
    }

    return files;
  }

  /**
   * 디렉토리 재귀 스캔
   * @param {string} dir 스캔할 디렉토리
   * @param {Array} files 파일 목록 배열
   */
  async scanDirectory(dir, files) {
    try {
      const items = await fs.readdir(dir);

      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stats = await fs.stat(fullPath);

        if (stats.isDirectory()) {
          await this.scanDirectory(fullPath, files);
        } else if (item.match(/\.(jpg|fits)$/i)) {
          const timestamp = this.extractTimestampFromFilename(item);
          files.push({
            path: fullPath,
            name: item,
            size: stats.size,
            mtime: stats.mtime.getTime(),
            timestamp: timestamp || stats.mtime.getTime()
          });
        }
      }
    } catch (error) {
      console.error(`[CLEANUP] Error scanning directory ${dir}:`, error.message);
    }
  }

  /**
   * 보수적 정리 실행
   * @returns {Promise<Object>} 정리 결과
   */
  async performConservativeCleanup() {
    const result = {
      success: false,
      deletedFiles: 0,
      deletedSize: 0,
      preservedFiles: 0,
      errors: []
    };

    try {
      // 모든 이미지 파일 수집
      const allFiles = [];
      for (const [camera, basePath] of Object.entries(this.basePaths)) {
        if (camera === 'database') continue;
        const files = await this.getAllImageFiles(basePath);
        allFiles.push(...files);
      }

      // 타임스탬프 기준 정렬 (최신 → 오래된 순)
      allFiles.sort((a, b) => b.timestamp - a.timestamp);

      console.log(`[CLEANUP] Total files found: ${allFiles.length}`);

      // 보존 정책 적용
      const cutoffTime = Date.now() - (this.config.minFileAgedays * 24 * 60 * 60 * 1000);
      const maxDeleteCount = Math.floor(allFiles.length * this.config.maxDeletePercentage / 100);

      // 삭제 대상 파일 선별
      const candidatesForDeletion = allFiles
        .slice(this.config.minPreserveCount) // 최신 N개 보존
        .filter(file => file.timestamp < cutoffTime) // 오래된 파일만
        .slice(0, maxDeleteCount); // 최대 삭제 개수 제한

      console.log(`[CLEANUP] Candidates for deletion: ${candidatesForDeletion.length}`);

      // 실제 삭제 실행
      for (const file of candidatesForDeletion) {
        try {
          await fs.unlink(file.path);
          result.deletedFiles++;
          result.deletedSize += file.size;

          this.cleanupLog.push({
            timestamp: Date.now(),
            action: 'deleted',
            file: file.path,
            size: file.size
          });
        } catch (error) {
          result.errors.push(`Failed to delete ${file.path}: ${error.message}`);
        }
      }

      result.preservedFiles = allFiles.length - result.deletedFiles;
      result.success = true;

      console.log(`[CLEANUP] Cleanup completed: ${result.deletedFiles} files deleted, ${Math.round(result.deletedSize/1024/1024)}MB freed`);

    } catch (error) {
      result.errors.push(`Cleanup failed: ${error.message}`);
      console.error('[CLEANUP] Cleanup failed:', error);
    }

    return result;
  }

  /**
   * config.json에서 마지막 실행 날짜 로드
   * @returns {Promise<string|null>} 마지막 실행 날짜 또는 null
   */
  async getLastExecutionDate() {
    try {
      const configData = await fs.readFile(this.configPath, 'utf8');
      const config = JSON.parse(configData);
      return config.lastCleanupDate || null;
    } catch (error) {
      console.error('[CLEANUP] Failed to read last execution date:', error.message);
      return null;
    }
  }

  /**
   * config.json에 마지막 실행 날짜 저장
   * @param {string} date YYYY-MM-DD 형식 날짜
   */
  async saveLastExecutionDate(date) {
    try {
      const configData = await fs.readFile(this.configPath, 'utf8');
      const config = JSON.parse(configData);
      config.lastCleanupDate = date;
      await fs.writeFile(this.configPath, JSON.stringify(config, null, 2));
      console.log(`[CLEANUP] Saved last execution date: ${date}`);
    } catch (error) {
      console.error('[CLEANUP] Failed to save last execution date:', error.message);
    }
  }

  /**
   * 오늘 이미 실행했는지 확인
   * @returns {Promise<boolean>} 오늘 실행했으면 true
   */
  async hasExecutedToday() {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD 형식
    const lastDate = await this.getLastExecutionDate();
    return lastDate === today;
  }

  /**
   * 자동 정리 메인 함수
   * @returns {Promise<Object>} 실행 결과
   */
  async executeAutoCleanup() {
    console.log('[CLEANUP] Starting auto cleanup check...');

    const result = {
      executed: false,
      reason: '',
      diskUsage: 0,
      recentFiles: 0,
      cleanupResult: null
    };

    try {
      // 0단계: 오늘 이미 실행했는지 확인
      if (await this.hasExecutedToday()) {
        const lastDate = await this.getLastExecutionDate();
        result.reason = `Already executed today (${lastDate})`;
        console.log(`[CLEANUP] ${result.reason}`);
        return result;
      }

      // 1단계: 디스크 사용률 확인
      result.diskUsage = await this.getDiskUsage();
      console.log(`[CLEANUP] Current disk usage: ${result.diskUsage}%`);

      if (result.diskUsage < this.config.maxDiskUsagePercent) {
        result.reason = `Disk usage (${result.diskUsage}%) below threshold (${this.config.maxDiskUsagePercent}%)`;
        return result;
      }

      // 2단계: 시스템 상태 검증
      if (!this.isSystemHealthy()) {
        result.reason = 'System health check failed';
        return result;
      }

      // 3단계: 최근 활동 확인
      result.recentFiles = await this.getRecentFileCount(this.config.recentDaysCheck);
      console.log(`[CLEANUP] Recent files (${this.config.recentDaysCheck}d): ${result.recentFiles}`);

      if (result.recentFiles < this.config.minRecentFiles) {
        result.reason = `Recent file count (${result.recentFiles}) below minimum (${this.config.minRecentFiles})`;
        return result;
      }

      // 4단계: 보수적 정리 실행
      console.log('[CLEANUP] All checks passed, executing cleanup...');
      result.cleanupResult = await this.performConservativeCleanup();
      result.executed = true;
      result.reason = 'Cleanup executed successfully';

      // 실행 날짜 기록 (config.json에 저장)
      const today = new Date().toISOString().split('T')[0];
      await this.saveLastExecutionDate(today);

    } catch (error) {
      result.reason = `Cleanup error: ${error.message}`;
      console.error('[CLEANUP] Auto cleanup error:', error);
    }

    return result;
  }

  /**
   * 정리 로그 조회
   * @param {number} limit 최대 개수
   * @returns {Array} 로그 항목들
   */
  getCleanupLog(limit = 100) {
    return this.cleanupLog.slice(-limit);
  }

  /**
   * 설정 업데이트
   * @param {Object} newConfig 새 설정
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    console.log('[CLEANUP] Configuration updated:', newConfig);
  }
}

export default AutoDataCleanup;