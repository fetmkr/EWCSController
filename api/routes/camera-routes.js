import express from 'express';

export default function createCameraRoutes(database, devices) {
  const router = express.Router();

  // OASC 카메라 수동 촬영
  router.post('/oasc/capture', async (req, res) => {
    try {
      if (!devices.oascCamera) {
        return res.status(503).json({ error: 'OASC camera not available' });
      }

      if (!devices.oascCamera.isConnected) {
        return res.status(500).json({ error: 'OASC camera not connected' });
      }

      const result = await devices.oascCamera.captureImage();
      
      if (result.success && result.filename) {
        // Save image metadata to database
        database.insertOascImageData({
          timestamp: Date.now(),
          filename: result.filename
        });
      }
      
      res.json(result);
    } catch (error) {
      console.error('OASC capture failed:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Spinel 카메라 수동 촬영
  router.post('/spinel/capture', async (req, res) => {
    try {
      if (!devices.camera) {
        return res.status(503).json({ error: 'Spinel camera not available' });
      }

      const result = await devices.camera.startCapture();
      
      if (result.success && result.filename) {
        // Save image metadata to database
        database.insertImageData({
          timestamp: Date.now(),
          filename: result.filename,
          camera: 'spinel'
        });
      }
      
      res.json(result);
    } catch (error) {
      console.error('Spinel capture failed:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // OASC 카메라 상태 조회
  router.get('/oasc/status', (req, res) => {
    try {
      const response = {
        camera_available: !!devices.oascCamera,
        camera_connected: devices.oascCamera ? devices.oascCamera.isConnected : false,
        timestamp: Date.now()
      };
      
      res.json(response);
    } catch (error) {
      console.error('Failed to get OASC status:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Spinel 카메라 상태 조회
  router.get('/spinel/status', (req, res) => {
    try {
      const response = {
        camera_available: !!devices.camera,
        camera_connected: devices.camera ? devices.camera.isConnected : false,
        timestamp: Date.now()
      };
      
      res.json(response);
    } catch (error) {
      console.error('Failed to get Spinel status:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // OASC 이미지 데이터 조회
  router.get('/oasc/images', (req, res) => {
    try {
      // Query parameters
      const limit = parseInt(req.query.limit) || 10;
      
      // Get latest OASC image data from database
      const imageData = database.getLatestData('oasc_images', limit);
      
      const response = {
        data: imageData,
        timestamp: Date.now()
      };
      
      res.json(response);
    } catch (error) {
      console.error('Failed to get OASC image data:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Spinel 이미지 데이터 조회
  router.get('/spinel/images', (req, res) => {
    try {
      // Query parameters
      const limit = parseInt(req.query.limit) || 10;
      
      // Get latest Spinel image data from database
      const imageData = database.getLatestData('images', limit);
      
      const response = {
        data: imageData,
        timestamp: Date.now()
      };
      
      res.json(response);
    } catch (error) {
      console.error('Failed to get Spinel image data:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}