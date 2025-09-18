import express from 'express';
import systemState from '../../utils/system-state.js';
import config from '../../config/app-config.js';

export default function createEwcsRoutes(database, appInstance) {
  const router = express.Router();

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

      const response = {
        query: query,
        count: ewcsData.length,
        data: ewcsData,
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
  router.get('/ewcs_status', (req, res) => {
    try {
      const response = {
        settings: {
          stationName: config.get('stationName'),
          oascExposureTime: config.get('oascExposureTime'),
          lastCleanupDate: config.get('lastCleanupDate')
        },
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
        recent_events: systemState.getRecentEvents(20),
        timestamp: Date.now()
      };

      res.json(response);
    } catch (error) {
      console.error('Failed to get EWCS status:', error);
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