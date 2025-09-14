import express from 'express';
import { validateNumber } from '../middleware/validation.js';
import config from '../../config/app-config.js';

export default function createSystemRoutes() {
  const router = express.Router();

  // 설정 조회
  router.get('/config', (req, res) => {
    try {
      const publicConfig = {
        stationName: config.get('stationName'),
        mode: config.get('mode'),
        dataSavePeriod: config.get('dataSavePeriod'),
        spinelSavePeriod: config.get('spinelSavePeriod'),
        oascSavePeriod: config.get('oascSavePeriod'),
        oascExposureTime: config.get('oascExposureTime')
      };
      res.json(publicConfig);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // 데이터 저장 주기
  router.get('/data-period', validateNumber(10, 3600), (req, res) => {
    try {
      const { value } = req.query;
      if (value) {
        config.set('dataSavePeriod', parseInt(value));
        res.json({ success: true, period: parseInt(value) });
      } else {
        res.json({ period: config.get('dataSavePeriod') });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // 스피넬 카메라 저장 주기
  router.get('/spinel-period', validateNumber(30, 1800), (req, res) => {
    try {
      const { value } = req.query;
      if (value) {
        config.set('spinelSavePeriod', parseInt(value));
        res.json({ success: true, period: parseInt(value) });
      } else {
        res.json({ period: config.get('spinelSavePeriod') });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // OASC 카메라 저장 주기
  router.get('/oasc-period', validateNumber(60, 3600), (req, res) => {
    try {
      const { value } = req.query;
      if (value) {
        const newPeriod = parseInt(value);
        const currentExposure = config.get('oascExposureTime') || 10.0;

        if (currentExposure > newPeriod) {
          return res.status(400).json({
            error: `저장 주기(${newPeriod}초)는 노출시간(${currentExposure}초)보다 길어야 합니다.`
          });
        }

        config.set('oascSavePeriod', newPeriod);
        res.json({ success: true, period: newPeriod });
      } else {
        res.json({ period: config.get('oascSavePeriod') });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // OASC 노출시간
  router.get('/oasc-exposure', validateNumber(1, 30), (req, res) => {
    try {
      const { value } = req.query;
      if (value) {
        const newExposure = parseFloat(value);
        const currentPeriod = config.get('oascSavePeriod') || 300;

        if (newExposure > currentPeriod) {
          return res.status(400).json({
            error: `노출시간(${newExposure}초)은 저장 주기(${currentPeriod}초)보다 짧아야 합니다.`
          });
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