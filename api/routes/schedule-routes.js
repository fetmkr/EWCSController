import express from 'express';
import { validateNumber } from '../middleware/validation.js';

export default function createScheduleRoutes(appInstance) {
  const router = express.Router();


  // PIC24 OnOff 스케줄 조회
  router.get('/onoff', async (req, res) => {
    try {
      const schedule = await appInstance.devices.pic24?.getOnOffScheduleFlexible();
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
  router.post('/onoff', async (req, res) => {
    try {
      const { mode, onMin, offMin } = req.body;

      // mode가 없으면 기본값 1 (매시간)
      const scheduleMode = mode !== undefined ? mode : 1;

      // mode 검증
      if (typeof scheduleMode !== 'number' || (scheduleMode !== 0 && scheduleMode !== 1 && scheduleMode !== 2)) {
        return res.status(400).json({
          error: 'mode must be 0 (disabled), 1 (hourly) or 2 (every 10 minutes)'
        });
      }

      // 기본 검증
      if (typeof onMin !== 'number' || typeof offMin !== 'number' ||
          onMin < 0 || offMin < 0) {
        return res.status(400).json({
          error: 'onMin and offMin must be non-negative numbers'
        });
      }

      // 모드별 범위 검증
      if (scheduleMode === 1) {
        if (onMin > 59 || offMin > 59) {
          return res.status(400).json({
            error: 'For hourly mode, onMin and offMin must be 0-59'
          });
        }
      } else if (scheduleMode === 2) {
        if (onMin > 9 || offMin > 9) {
          return res.status(400).json({
            error: 'For every 10min mode, onMin and offMin must be 0-9'
          });
        }
      }

      await appInstance.devices.pic24?.setOnOffScheduleFlexible(scheduleMode, onMin, offMin);

      // 설명 생성
      let description;
      if (scheduleMode === 0) {
        description = 'Disabled';
      } else if (scheduleMode === 1) {
        description = `Every hour: ON at xx:${onMin.toString().padStart(2, '0')}, OFF at xx:${offMin.toString().padStart(2, '0')}`;
      } else {
        description = `Every 10 minutes: ON at x${onMin}, OFF at x${offMin}`;
      }

      res.json({
        success: true,
        mode: scheduleMode,
        onMin,
        offMin,
        description
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // PIC24 위성 스케줄 조회
  router.get('/satellite', async (req, res) => {
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
  router.post('/satellite', async (req, res) => {
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


  return router;
}