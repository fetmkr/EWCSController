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
        data: config.get('data'),
        network: config.get('network')
      };
      res.json(publicConfig);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // 스테이션 이름 설정
  router.get('/station-name', (req, res) => {
    try {
      const { name } = req.query;
      if (name) {
        config.set('stationName', name);
        res.json({ success: true, stationName: name });
      } else {
        res.json({ stationName: config.get('stationName') });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // 모드 설정
  router.get('/mode', (req, res) => {
    try {
      const { mode } = req.query;
      if (mode && ['normal', 'emergency'].includes(mode)) {
        config.set('mode', mode);
        res.json({ success: true, mode: mode });
      } else {
        res.json({ mode: config.get('mode') });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // 데이터 저장 주기 설정
  router.get('/data-period', validateNumber(10, 3600), (req, res) => {
    try {
      const { value } = req.query;
      if (value) {
        config.set('data.savePeriod', parseInt(value));
        res.json({ success: true, period: parseInt(value) });
      } else {
        res.json({ period: config.get('data.savePeriod') });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // 이미지 저장 주기 설정
  router.get('/image-period', validateNumber(10, 3600), (req, res) => {
    try {
      const { value } = req.query;
      if (value) {
        config.set('data.imageSavePeriod', parseInt(value));
        res.json({ success: true, period: parseInt(value) });
      } else {
        res.json({ period: config.get('data.imageSavePeriod') });
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