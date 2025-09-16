import express from 'express';
import { validateOnOff, validateNumber } from '../middleware/validation.js';
import config from '../../config/app-config.js';

export default function createDeviceRoutes(devices, appInstance) {
  const router = express.Router();


  // CS125 후드 히터
  // router.get('/cs125-heater', validateOnOff, async (req, res) => {
  //   try {
  //     const { on } = req.query;
  //     await devices.cs125.setHoodHeater(on === '1');
  //     res.json({ success: true, status: on });
  //   } catch (error) {
  //     res.status(500).json({ error: error.message });
  //   }
  // });


  // OASC 카메라 상태
  router.get('/oasc/status', (req, res) => {
    try {
      const response = {
        camera_available: !!devices.oascCamera,
        camera_connected: devices.oascCamera ? devices.oascCamera.isConnected : false,
        timestamp: Date.now()
      };
      res.json(response);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Spinel 카메라 상태
  router.get('/spinel/status', (req, res) => {
    try {
      const response = {
        camera_available: !!devices.camera,
        camera_connected: devices.camera ? devices.camera.isConnected : false,
        timestamp: Date.now()
      };
      res.json(response);
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
      await appInstance.runSpinelImageCaptureOnce();
      res.json({ success: true, message: 'Spinel capture initiated' });
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
      await appInstance.runOASCImageCaptureOnce();
      res.json({ success: true, message: 'OASC capture initiated' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // PIC24 VOUT 제어
  router.get('/vout1', validateOnOff, async (req, res) => {
    try {
      const { on } = req.query;
      if (on === '1') {
        await appInstance.devices.pic24?.turnOnVOUT(1);
      } else {
        await appInstance.devices.pic24?.turnOffVOUT(1);
      }
      res.json({ success: true, vout: 1, status: on });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/vout2', validateOnOff, async (req, res) => {
    try {
      const { on } = req.query;
      if (on === '1') {
        await appInstance.devices.pic24?.turnOnVOUT(2);
      } else {
        await appInstance.devices.pic24?.turnOffVOUT(2);
      }
      res.json({ success: true, vout: 2, status: on });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/vout3', validateOnOff, async (req, res) => {
    try {
      const { on } = req.query;
      if (on === '1') {
        await appInstance.devices.pic24?.turnOnVOUT(3);
      } else {
        await appInstance.devices.pic24?.turnOffVOUT(3);
      }
      res.json({ success: true, vout: 3, status: on });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/vout4', validateOnOff, async (req, res) => {
    try {
      const { on } = req.query;
      if (on === '1') {
        await appInstance.devices.pic24?.turnOnVOUT(4);
      } else {
        await appInstance.devices.pic24?.turnOffVOUT(4);
      }
      res.json({ success: true, vout: 4, status: on });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // PIC24 절전 모드 제어
  router.get('/power-save', validateOnOff, async (req, res) => {
    try {
      const { on } = req.query;
      if (on === '1') {
        await appInstance.devices.pic24?.enablePowerSave();
      } else {
        await appInstance.devices.pic24?.disablePowerSave();
      }
      res.json({ success: true, powerSave: on === '1' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // PIC24 위성 전송 시작
  router.post('/satellite/start', async (req, res) => {
    try {
      await appInstance.devices.pic24?.startSatelliteTransmission();
      res.json({ success: true, message: 'Satellite transmission started' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // OASC 노출시간
  router.get('/oasc/exposure', validateNumber(1, 30), (req, res) => {
    try {
      const { value } = req.query;
      if (value) {
        const newExposure = parseFloat(value);
        config.set('oascExposureTime', newExposure);
        res.json({ success: true, exposureTime: newExposure });
      } else {
        res.json({ exposureTime: config.get('oascExposureTime') });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}