import express from 'express';
import systemState from '../../utils/system-state.js';

export default function createEwcsRoutes(database) {
  const router = express.Router();

  // 최신 EWCS 데이터 조회
  router.get('/ewcs_data', (req, res) => {
    try {
      // Query parameters
      const limit = parseInt(req.query.limit) || 1;
      const includeImages = req.query.images === 'true';
      
      // Get latest EWCS data from database
      const ewcsData = database.getLatestData('ewcs_data', limit);
      
      const response = {
        data: ewcsData,
        timestamp: Date.now()
      };
      
      // Include image data if requested
      if (includeImages) {
        const imageData = database.getLatestData('ewcs_images', limit);
        response.images = imageData;
      }
      
      res.json(response);
    } catch (error) {
      console.error('Failed to get EWCS data:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // 시스템 상태 조회 (system_state.json)
  router.get('/ewcs_status', (req, res) => {
    try {
      const response = {
        current_status: systemState.getStatus(),
        settings: systemState.getSetting(),
        recent_events: systemState.getRecentEvents(20),
        timestamp: Date.now()
      };
      
      res.json(response);
    } catch (error) {
      console.error('Failed to get EWCS status:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}