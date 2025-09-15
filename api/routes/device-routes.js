import express from 'express';
import { validateOnOff } from '../middleware/validation.js';

export default function createDeviceRoutes(devices, appInstance) {
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

  // Spinel 카메라 전원 제어 (via PIC24)
  router.get('/spinel/power', validateOnOff, async (req, res) => {
    try {
      const { on } = req.query;
      if (on === '1') {
        await appInstance.turnOnCamera();
      } else {
        await appInstance.turnOffCamera();
      }
      res.json({ success: true, status: on });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

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
      const result = await devices.camera.startCapture();
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
      const result = await devices.oascCamera.captureImage();
      res.json(result);
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

  // 장치 상태 조회
  router.get('/status', async (req, res) => {
    try {
      const status = {};

      // Get status from each device, removing any 'healthy' fields
      for (const [deviceName, device] of Object.entries(devices)) {
        if (!device) {
          status[deviceName] = { available: false };
          continue;
        }

        try {
          let deviceStatus = {};

          if (device.getStatus) {
            deviceStatus = device.getStatus();
          } else if (device.getFullStatus) {
            deviceStatus = device.getFullStatus();
          } else {
            // Fallback for devices without status methods
            deviceStatus = {
              available: true,
              connected: device.isConnected || device.connected || true
            };
          }

          // Remove 'healthy' field if it exists
          if (deviceStatus.hasOwnProperty('healthy')) {
            delete deviceStatus.healthy;
          }

          status[deviceName] = deviceStatus;

        } catch (error) {
          status[deviceName] = {
            available: true,
            connected: false,
            error: error.message
          };
        }
      }

      res.json(status);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}