import express from 'express';
import { validateNumber, validateString } from '../middleware/validation.js';
import config from '../../config/app-config.js';

export default function createSystemRoutes(appInstance) {
  const router = express.Router();

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



  // PIC24 OnOff 스케줄 조회
  router.get('/schedule/onoff', async (req, res) => {
    try {
      const schedule = await appInstance.devices.pic24?.getOnOffSchedule();
      if (schedule) {
        res.json(schedule);
      } else {
        res.status(404).json({ error: 'Schedule not found' });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // PIC24 OnOff 스케줄 설정
  router.post('/schedule/onoff', async (req, res) => {
    try {
      const { onMin, offMin } = req.body;

      if (typeof onMin !== 'number' || typeof offMin !== 'number' ||
          onMin < 0 || onMin > 59 || offMin < 0 || offMin > 59) {
        return res.status(400).json({
          error: 'onMin and offMin must be numbers between 0-59'
        });
      }

      await appInstance.devices.pic24?.setOnOffSchedule(onMin, offMin);
      res.json({
        success: true,
        onMin,
        offMin,
        description: `Every hour: ON at xx:${onMin.toString().padStart(2, '0')}, OFF at xx:${offMin.toString().padStart(2, '0')}`
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // PIC24 위성 스케줄 조회
  router.get('/schedule/satellite', async (req, res) => {
    try {
      const schedule = await appInstance.devices.pic24?.getSatSchedule();
      if (schedule) {
        res.json(schedule);
      } else {
        res.status(404).json({ error: 'Satellite schedule not found' });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // PIC24 위성 스케줄 설정
  router.post('/schedule/satellite', async (req, res) => {
    try {
      const { hour, min } = req.body;

      if (typeof hour !== 'number' || typeof min !== 'number' ||
          hour < 0 || hour > 23 || min < 0 || min > 59) {
        return res.status(400).json({
          error: 'hour must be 0-23, min must be 0-59'
        });
      }

      await appInstance.devices.pic24?.setSatSchedule(hour, min);
      res.json({
        success: true,
        hour,
        min,
        description: `Daily satellite transmission at ${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // 시스템 상태
  router.get('/status', async (req, res) => {
    try {
      const status = {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: Date.now()
      };
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}