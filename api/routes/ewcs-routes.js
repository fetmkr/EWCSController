import express from 'express';
import logManager from '../../utils/log-manager.js';
import config from '../../config/app-config.js';
import { validateOnOff, validateNumber, validateString } from '../middleware/validation.js';
import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export default function createEwcsRoutes(database, appInstance) {
  const router = express.Router();
  const devices = appInstance.devices;

  // EWCS 데이터 조회 (유연한 날짜 범위 검색 지원)
  router.get('/ewcs_data', (req, res) => {
    try {
      const { from, to, limit, images } = req.query;
      const includeImages = images === 'true';

      // 날짜 범위가 지정된 경우 범위 검색, 그렇지 않으면 최신 데이터
      let ewcsData;
      let query = {};

      if (from || to) {
        // 날짜 범위 검색
        let startTime = 0;
        let endTime = Date.now();

        if (from) {
          startTime = parseTimeParameter(from);
          if (startTime === null) {
            return res.status(400).json({ error: 'Invalid "from" parameter format' });
          }
        }

        if (to) {
          endTime = parseTimeParameter(to);
          if (endTime === null) {
            return res.status(400).json({ error: 'Invalid "to" parameter format' });
          }
        }

        const maxLimit = parseInt(limit) || 100;

        const stmt = database.db.prepare(`
          SELECT * FROM ewcs_data
          WHERE timestamp >= ? AND timestamp <= ?
          ORDER BY timestamp DESC
          LIMIT ?
        `);

        ewcsData = stmt.all(startTime, endTime, maxLimit);

        query = {
          from: startTime,
          to: endTime,
          from_readable: new Date(startTime).toISOString(),
          to_readable: new Date(endTime).toISOString()
        };
      } else {
        // 최신 데이터 (기존 방식)
        const maxLimit = parseInt(limit) || 1;
        ewcsData = database.getLatestData('ewcs_data', maxLimit);
      }

      // Rename created_at to timestamp_readable for consistency
      const dataWithReadableTimestamp = ewcsData.map(item => {
        const { created_at, ...itemWithoutCreatedAt } = item;
        return {
          ...itemWithoutCreatedAt,
          timestamp_readable: created_at
        };
      });

      const response = {
        query: query,
        count: dataWithReadableTimestamp.length,
        data: dataWithReadableTimestamp,
        timestamp: Date.now()
      };

      // Include image data if requested
      if (includeImages) {
        let imageData;
        if (from || to) {
          // 같은 날짜 범위로 이미지도 검색
          const stmt = database.db.prepare(`
            SELECT * FROM ewcs_images
            WHERE timestamp >= ? AND timestamp <= ?
            ORDER BY timestamp DESC
            LIMIT ?
          `);
          imageData = stmt.all(query.from || 0, query.to || Date.now(), parseInt(limit) || 100);
        } else {
          imageData = database.getLatestData('ewcs_images', parseInt(limit) || 1);
        }
        response.images = imageData;
      }

      res.json(response);
    } catch (error) {
      console.error('Failed to get EWCS data:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // EWCS 현재 데이터 (실시간 수집 후 반환)
  router.get('/ewcs_data/now', async (req, res) => {
    try {
      // 실시간 데이터 수집 실행
      await appInstance.runDataCollectionOnce();

      // 수집된 현재 데이터 반환 (ewcs_data와 동일한 형식)
      const currentData = {
        timestamp: appInstance.ewcsData.timestamp,
        station_name: appInstance.ewcsData.stationName,
        // CS125 센서 데이터
        cs125_visibility: appInstance.ewcsData.cs125Visibility,
        cs125_synop: appInstance.ewcsData.cs125SYNOP,
        cs125_temp: appInstance.ewcsData.cs125Temp,
        cs125_humidity: appInstance.ewcsData.cs125Humidity,
        // 환경 센서 데이터
        sht45_temp: appInstance.ewcsData.SHT45Temp,
        sht45_humidity: appInstance.ewcsData.SHT45Humidity,
        rpi_temp: appInstance.ewcsData.rpiTemp,
        // 전력 모니터링 데이터
        chan1_current: appInstance.ewcsData.chan1Current,
        chan2_current: appInstance.ewcsData.chan2Current,
        chan3_current: appInstance.ewcsData.chan3Current,
        chan4_current: appInstance.ewcsData.chan4Current,
        // 태양광 충전기 데이터
        pv_vol: appInstance.ewcsData.PVVol,
        pv_cur: appInstance.ewcsData.PVCur,
        load_vol: appInstance.ewcsData.LoadVol,
        load_cur: appInstance.ewcsData.LoadCur,
        bat_temp: appInstance.ewcsData.BatTemp,
        dev_temp: appInstance.ewcsData.DevTemp,
        charg_equip_stat: appInstance.ewcsData.ChargEquipStat,
        dischg_equip_stat: appInstance.ewcsData.DischgEquipStat
      };

      res.json({
        query: { realtime: true },
        count: 1,
        data: [currentData]
      });
    } catch (error) {
      console.error('Failed to collect real-time EWCS data:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // 시스템 상태 조회 (system_state.json + real-time status)
  router.get('/ewcs_status', async (req, res) => {
    try {
      // 최신 네트워크 정보 업데이트
      if (appInstance && appInstance.updateNetworkInfo) {
        await appInstance.updateNetworkInfo();
      }

      const response = {
        settings: {
          stationName: config.get('stationName'),
          oascExposureTime: config.get('oascExposureTime'),
          lastCleanupDate: config.get('lastCleanupDate')
        },
        schedules: null, // 나중에 설정됨
        network_info: {
          ipAddress: appInstance?.ewcsStatus?.ipAddress || 'N/A',
          gateway: appInstance?.ewcsStatus?.gateway || 'N/A'
        },
        device_connections: appInstance ? {
          cs125Connected: appInstance.ewcsStatus.cs125Connected,
          cameraConnected: appInstance.ewcsStatus.cameraConnected,
          OASCConnected: appInstance.ewcsStatus.OASCConnected,
          EPEVERConnected: appInstance.ewcsStatus.EPEVERConnected,
          ADCConnected: appInstance.ewcsStatus.ADCConnected,
          SHT45Connected: appInstance.ewcsStatus.SHT45Connected
        } : {},
        pic24_info: {
          boot_count: null,
          boot_count_error: 'Will be updated below'
        },
        recent_events: logManager.getRecentEvents(20),
        system_info: {
          uptime: process.uptime(),
          memory: process.memoryUsage()
        },
        timestamp: Date.now()
      };

      // PIC24 정보 추가 (boot count 및 스케줄, 타임아웃 적용)
      if (appInstance?.devices?.pic24) {
        try {
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('PIC24 data retrieval timeout')), 3000);
          });

          // 먼저 boot count 가져오기
          const bootCountResult = await Promise.race([
            appInstance.devices.pic24.getBootCount(),
            timeoutPromise
          ]);

          // 순차적으로 스케줄 정보 가져오기 (동시 호출 시 충돌 방지)
          const onoffSchedule = await Promise.race([
            appInstance.devices.pic24.getOnOffScheduleFlexible(),
            timeoutPromise
          ]);

          const satSchedule = await Promise.race([
            appInstance.devices.pic24.getSatSchedule(),
            timeoutPromise
          ]);

          const [finalOnoffSchedule, finalSatSchedule] = [onoffSchedule, satSchedule];

          response.pic24_info = {
            boot_count: bootCountResult?.success ? bootCountResult.bootCount : null,
            boot_count_error: bootCountResult?.success ? null : bootCountResult?.error
          };

          response.schedules = {
            onoff_schedule: finalOnoffSchedule,
            satellite_schedule: finalSatSchedule
          };
        } catch (error) {
          console.error('Failed to get PIC24 data:', error);
          response.pic24_info = {
            boot_count: null,
            boot_count_error: error.message || 'Failed to retrieve boot count'
          };
          response.schedules = {
            onoff_schedule: null,
            satellite_schedule: null,
            error: error.message || 'Failed to retrieve schedules'
          };
        }
      } else {
        response.pic24_info = {
          boot_count: null,
          boot_count_error: 'PIC24 not available'
        };
        response.schedules = {
          onoff_schedule: null,
          satellite_schedule: null,
          error: 'PIC24 not available'
        };
      }

      res.json(response);
    } catch (error) {
      console.error('Failed to get EWCS status:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // === System Routes ===

  // Station Name 설정
  router.get('/station-name', validateString(1, 16), (req, res) => {
    try {
      const { value } = req.query;
      if (value) {
        let stationName = value.toString().trim();
        const originalLength = stationName.length;

        // 16글자 초과 시 자르기
        if (stationName.length > 16) {
          stationName = stationName.substring(0, 16);
        }

        config.set('stationName', stationName);

        const response = {
          success: true,
          stationName: stationName
        };

        // 잘렸을 때 피드백 추가
        if (originalLength > 16) {
          response.warning = `Station name was truncated from ${originalLength} to 16 characters`;
        }

        res.json(response);
      } else {
        res.json({ stationName: config.get('stationName') });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // === Device Control Routes (formerly from device-routes.js) ===

  // CS125 후드 히터
  router.get('/cs125-heater', validateOnOff, async (req, res) => {
    try {
      const { on } = req.query;

      // CS125 연결 상태 확인
      if (!appInstance.ewcsStatus.cs125Connected) {
        return res.status(503).json({ error: 'CS125 sensor not connected' });
      }

      const result = on === '1' ? await devices.cs125.hoodHeaterOn() : await devices.cs125.hoodHeaterOff();
      res.json({ success: result, status: on });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Spinel 카메라 캡처
  router.get('/spinel/capture', async (req, res) => {
    try {
      if (!devices.camera) {
        return res.status(503).json({ error: 'Spinel camera not available' });
      }
      const result = await appInstance.runSpinelImageCaptureOnce();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // OASC 카메라 캡처
  router.get('/oasc/capture', async (req, res) => {
    try {
      if (!devices.oascCamera) {
        return res.status(503).json({ error: 'OASC camera not available' });
      }
      const result = await appInstance.runOASCImageCaptureOnce();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // PIC24 VOUT 제어
  router.get('/vout1', validateOnOff, async (req, res) => {
    try {
      const { on } = req.query;
      if (!appInstance.devices.pic24) {
        return res.status(503).json({ error: 'PIC24 not available' });
      }

      const result = on === '1' ?
        await appInstance.devices.pic24.turnOnVOUT(1) :
        await appInstance.devices.pic24.turnOffVOUT(1);

      res.json({ success: result.success, vout: 1, status: on });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/vout2', validateOnOff, async (req, res) => {
    try {
      const { on } = req.query;
      if (!appInstance.devices.pic24) {
        return res.status(503).json({ error: 'PIC24 not available' });
      }

      const result = on === '1' ?
        await appInstance.devices.pic24.turnOnVOUT(2) :
        await appInstance.devices.pic24.turnOffVOUT(2);

      res.json({ success: result.success, vout: 2, status: on });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/vout3', validateOnOff, async (req, res) => {
    try {
      const { on } = req.query;
      if (!appInstance.devices.pic24) {
        return res.status(503).json({ error: 'PIC24 not available' });
      }

      const result = on === '1' ?
        await appInstance.devices.pic24.turnOnVOUT(3) :
        await appInstance.devices.pic24.turnOffVOUT(3);

      res.json({ success: result.success, vout: 3, status: on });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/vout4', validateOnOff, async (req, res) => {
    try {
      const { on } = req.query;
      if (!appInstance.devices.pic24) {
        return res.status(503).json({ error: 'PIC24 not available' });
      }

      const result = on === '1' ?
        await appInstance.devices.pic24.turnOnVOUT(4) :
        await appInstance.devices.pic24.turnOffVOUT(4);

      res.json({ success: result.success, vout: 4, status: on });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // PIC24 절전 모드 제어
  router.get('/power-save', validateOnOff, async (req, res) => {
    try {
      const { on } = req.query;
      if (!appInstance.devices.pic24) {
        return res.status(503).json({ error: 'PIC24 not available' });
      }

      const result = on === '1' ?
        await appInstance.devices.pic24.enablePowerSave() :
        await appInstance.devices.pic24.disablePowerSave();

      res.json({ success: result.success, powerSave: on === '1' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // PIC24 위성 전송 시작
  router.post('/satellite/start', async (req, res) => {
    try {
      if (!appInstance.devices.pic24) {
        return res.status(503).json({ error: 'PIC24 not available' });
      }

      const result = await appInstance.devices.pic24.startSatelliteTransmission();
      res.json({
        success: result.success,
        message: result.success ? 'Satellite transmission started' : 'Failed to start satellite transmission'
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // OASC 노출시간
  router.get('/oasc/exposure', (req, res) => {
    try {
      const { value } = req.query;
      if (value) {
        const newExposure = parseFloat(value);
        if (isNaN(newExposure) || newExposure < 0 || newExposure > 3600) {
          return res.status(400).json({ error: 'Value must be between 0 and 3600' });
        }
        config.set('oascExposureTime', newExposure);
        res.json({ success: true, exposureTime: newExposure });
      } else {
        res.json({ exposureTime: config.get('oascExposureTime') });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // 네트워크 설정 변경 (IP, 게이트웨이, 서브넷 마스크)
  router.post('/network/config', async (req, res) => {
    try {
      const { ip, gateway, subnet } = req.body;

      // 필수 필드 검증
      if (!ip || typeof ip !== 'string') {
        return res.status(400).json({ error: 'IP address is required' });
      }

      // IP 주소 형식 검증 (일반적인 IPv4 형식)
      const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
      if (!ipRegex.test(ip)) {
        return res.status(400).json({ error: 'Invalid IP address format' });
      }

      // 게이트웨이 형식 검증 (선택적)
      if (gateway && !ipRegex.test(gateway)) {
        return res.status(400).json({ error: 'Invalid gateway format' });
      }

      // 서브넷 마스크 검증 (CIDR 형식, 선택적)
      let subnetMask = subnet || '24'; // 기본값
      if (subnet) {
        const subnetNum = parseInt(subnet);
        if (isNaN(subnetNum) || subnetNum < 1 || subnetNum > 30) {
          return res.status(400).json({ error: 'Subnet mask must be between 1 and 30' });
        }
        subnetMask = subnet.toString();
      }

      // 현재 설정과 동일한지 확인
      const currentIp = appInstance?.ewcsStatus?.ipAddress;
      const currentGateway = appInstance?.ewcsStatus?.gateway;
      if (currentIp === ip && (!gateway || currentGateway === gateway)) {
        return res.status(400).json({ error: 'Network configuration is already set to these values' });
      }

      // 네트워크 설정 파일 수정
      await updateNetworkConfig(ip, gateway, subnetMask);

      // 응답을 먼저 보내기
      res.json({
        success: true,
        config: {
          ip: ip,
          gateway: gateway || 'unchanged',
          subnet: subnetMask
        },
        message: 'Network configuration changed successfully. Network will restart in 2 seconds...'
      });

      // 응답이 전송될 시간을 주고 네트워크 재시작
      setTimeout(async () => {
        try {
          await restartNetworkService();
          console.log('[Network] Network configuration applied successfully');
        } catch (error) {
          console.error('[Network] Failed to restart network service:', error);
        }
      }, 2000);

    } catch (error) {
      console.error('Failed to change network configuration:', error);
      res.status(500).json({ error: error.message });
    }
  });


  return router;
}

// Parse time parameter - supports epoch timestamp or YYYY-MM-DD-HH-mm format
function parseTimeParameter(timeStr) {
  // Check if it's a number (epoch timestamp)
  if (/^\d+$/.test(timeStr)) {
    return parseInt(timeStr);
  }

  // Try to parse YYYY-MM-DD-HH-mm format
  const match = timeStr.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})$/);
  if (match) {
    const [_, year, month, day, hour, minute] = match;
    const date = new Date(year, month - 1, day, hour, minute);
    return date.getTime();
  }

  // Try ISO format as fallback
  const date = new Date(timeStr);
  if (!isNaN(date.getTime())) {
    return date.getTime();
  }

  return null;
}

// 네트워크 설정 파일 수정 함수
async function updateNetworkConfig(newIp, newGateway = null, subnetMask = '24') {
  const configPath = '/etc/systemd/network/10-eth0.network';

  try {
    // 현재 설정 파일 읽기
    const currentConfig = await fs.readFile(configPath, 'utf8');

    // Address 라인 수정 (IP와 서브넷 마스크)
    let updatedConfig = currentConfig.replace(
      /^Address=.*$/m,
      `Address=${newIp}/${subnetMask}`
    );

    // Gateway 라인 수정 (새 게이트웨이가 제공된 경우에만)
    if (newGateway) {
      updatedConfig = updatedConfig.replace(
        /^Gateway=.*$/m,
        `Gateway=${newGateway}`
      );
    }

    // 백업 파일 생성
    const backupPath = `${configPath}.backup.${Date.now()}`;
    await fs.writeFile(backupPath, currentConfig);
    console.log(`[Network] Backup created: ${backupPath}`);

    // 새 설정 파일 쓰기
    await fs.writeFile(configPath, updatedConfig);
    console.log(`[Network] Updated config file - IP: ${newIp}/${subnetMask}${newGateway ? `, Gateway: ${newGateway}` : ''}`);

    return true;
  } catch (error) {
    console.error('[Network] Failed to update config file:', error);
    throw new Error(`Failed to update network config: ${error.message}`);
  }
}

// systemd-networkd 재시작 함수
async function restartNetworkService() {
  try {
    console.log('[Network] Restarting systemd-networkd...');
    await execAsync('sudo systemctl restart systemd-networkd');
    console.log('[Network] systemd-networkd restarted successfully');
    return true;
  } catch (error) {
    console.error('[Network] Failed to restart systemd-networkd:', error);
    throw new Error(`Failed to restart network service: ${error.message}`);
  }
}