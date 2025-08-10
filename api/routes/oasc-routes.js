import express from 'express';

export default function createOascRoutes(database, devices) {
  const router = express.Router();

  // OASC 이미지 데이터 조회
  router.get('/oasc_images', (req, res) => {
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

  // OASC 카메라 수동 촬영
  router.post('/oasc_capture', async (req, res) => {
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

  // OASC 카메라 상태 조회
  router.get('/oasc_status', (req, res) => {
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

  return router;
}