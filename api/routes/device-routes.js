import express from 'express';
import { validateOnOff } from '../middleware/validation.js';

export default function createDeviceRoutes(devices) {
  const router = express.Router();
  
  // CS125 센서 제어
  router.get('/cs125', validateOnOff, async (req, res) => {
    try {
      const { on } = req.query;
      if (on === '1') {
        await devices.cs125.turnOn();
      } else {
        await devices.cs125.turnOff();
      }
      res.json({ success: true, status: on });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // CS125 후드 히터
  router.get('/cs125-heater', validateOnOff, async (req, res) => {
    try {
      const { on } = req.query;
      await devices.cs125.setHoodHeater(on === '1');
      res.json({ success: true, status: on });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // 카메라 제어
  router.get('/camera', validateOnOff, async (req, res) => {
    try {
      const { on } = req.query;
      if (on === '1') {
        await devices.camera.turnOn();
      } else {
        await devices.camera.turnOff();
      }
      res.json({ success: true, status: on });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // 카메라 캡처
  router.get('/camera-capture', async (req, res) => {
    try {
      const result = await devices.camera.startCapture();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // 장치 상태 조회
  router.get('/status', async (req, res) => {
    try {
      const status = {
        cs125: devices.cs125.getStatus(),
        camera: devices.camera.getStatus(),
        bms: devices.bms.getStatus(),
        sht45: devices.sht45.getStatus(),
        gpio: devices.gpio.getFullStatus()
      };
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}