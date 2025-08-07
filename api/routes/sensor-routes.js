import express from 'express';
import { validateNumber } from '../middleware/validation.js';

export default function createSensorRoutes(database, devices) {
  const router = express.Router();

  // 현재 센서 데이터
  router.get('/current', async (req, res) => {
    try {
      const data = {
        cs125: devices.cs125.getData(),
        sht45: devices.sht45.getData(),
        bms: devices.bms.getData(),
        adc: devices.adc.getAllChannelData(),
        timestamp: Date.now()
      };
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // 히스토리 데이터
  router.get('/history', async (req, res) => {
    try {
      const start = parseInt(req.query.start) || (Date.now() - 24*60*60*1000);
      const end = parseInt(req.query.end) || Date.now();
      const limit = parseInt(req.query.limit) || 100;
      
      const data = await database.getEwcsData(start, end, limit);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // 배터리 데이터
  router.get('/battery', async (req, res) => {
    try {
      const data = devices.bms.getData();
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // 온습도 데이터
  router.get('/temperature', async (req, res) => {
    try {
      const data = devices.sht45.getData();
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}