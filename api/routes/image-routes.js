import express from 'express';
import path from 'path';
import fs from 'fs';

export default function createImageRoutes(database) {
  const router = express.Router();

  // Static serving for viewer (HTML gallery)
  router.get('/:camera/viewer', (req, res) => {
    try {
      const { camera } = req.params;
      const limit = parseInt(req.query.limit) || 20;

      if (!['spinel', 'oasc'].includes(camera)) {
        return res.status(400).send('<h1>Error: Invalid camera. Use "spinel" or "oasc"</h1>');
      }

      const folderName = camera === 'spinel' ? 'ewcs_images' : 'oasc_images';
      const imagePath = path.join(process.cwd(), folderName);

      const files = getRecentImageFiles(imagePath, limit);

      let html = generateImageViewerHTML(camera, files, imagePath);
      res.send(html);
    } catch (error) {
      console.error('Failed to generate viewer:', error);
      res.status(500).send('<h1>Error loading images</h1>');
    }
  });

  // Static file serving for actual images
  router.use('/spinel', express.static(path.join(process.cwd(), 'ewcs_images')));
  router.use('/oasc', express.static(path.join(process.cwd(), 'oasc_images')));

  // Get image metadata with flexible date range search
  router.get('/:camera/data', (req, res) => {
    try {
      const { camera } = req.params;
      const { from, to, limit } = req.query;

      if (!['spinel', 'oasc'].includes(camera)) {
        return res.status(400).json({ error: 'Invalid camera. Use "spinel" or "oasc"' });
      }

      // Parse date parameters
      let startTime = 0;
      let endTime = Date.now();

      if (from) {
        startTime = parseTimeParameter(from);
        if (startTime === null) {
          return res.status(400).json({ error: 'Invalid "from" parameter format' });
        }
      }

      if (to) {
        endTime = parseTimeParameter(to);
        if (endTime === null) {
          return res.status(400).json({ error: 'Invalid "to" parameter format' });
        }
      }

      // 파라미터 없으면 최신 1개, 있으면 지정된 개수 (기본 100)
      const maxLimit = limit ? parseInt(limit) : (from || to ? 100 : 1);

      // Get from database
      const tableName = camera === 'spinel' ? 'ewcs_images' : 'oasc_images';
      const stmt = database.db.prepare(`
        SELECT * FROM ${tableName}
        WHERE timestamp >= ? AND timestamp <= ?
        ORDER BY timestamp DESC
        LIMIT ?
      `);

      const imageData = stmt.all(startTime, endTime, maxLimit);

      // Add readable timestamp for each image and remove created_at
      const imagesWithReadableTime = imageData.map(img => {
        const { created_at, ...imgWithoutCreatedAt } = img;
        return {
          ...imgWithoutCreatedAt,
          timestamp_readable: new Date(img.timestamp).toISOString()
        };
      });

      res.json({
        camera: camera,
        query: {
          from: startTime,
          to: endTime,
          from_readable: new Date(startTime).toISOString(),
          to_readable: new Date(endTime).toISOString()
        },
        count: imagesWithReadableTime.length,
        images: imagesWithReadableTime,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('Failed to get images:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}

// Parse time parameter - supports epoch timestamp or YYYY-MM-DD-HH-mm format
function parseTimeParameter(timeStr) {
  // Check if it's a number (epoch timestamp)
  if (/^\d+$/.test(timeStr)) {
    return parseInt(timeStr);
  }

  // Try to parse YYYY-MM-DD-HH-mm format
  const match = timeStr.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})$/);
  if (match) {
    const [_, year, month, day, hour, minute] = match;
    const date = new Date(year, month - 1, day, hour, minute);
    return date.getTime();
  }

  // Try ISO format as fallback
  const date = new Date(timeStr);
  if (!isNaN(date.getTime())) {
    return date.getTime();
  }

  return null;
}

// HTML viewer generator
function generateImageViewerHTML(camera, files, imagePath) {
  let html = `
<!DOCTYPE html>
<html>
<head>
    <title>${camera.toUpperCase()} Camera - Latest Images</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .image-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-top: 20px; }
        .image-item { border: 1px solid #ddd; padding: 10px; border-radius: 5px; }
        .image-item img { max-width: 100%; height: 200px; object-fit: cover; border-radius: 3px; }
        .image-info { margin-top: 10px; font-size: 14px; color: #666; }
        h1 { color: #333; }
        .nav { margin-bottom: 20px; }
        .nav a { margin-right: 15px; text-decoration: none; color: #007bff; }
        .nav a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <div class="nav">
        <a href="/api/image/spinel/viewer">Spinel Camera</a>
        <a href="/api/image/oasc/viewer">OASC Camera</a>
    </div>

    <h1>${camera.toUpperCase()} Camera - Image Viewer</h1>
    <p>Total images: ${files.length}</p>
    
    <div class="image-grid">`;

    files.forEach(file => {
      const relativePath = path.relative(imagePath, file.path);
      const imageUrl = `/file/image/${camera}/${relativePath}`;
      const timestamp = new Date(file.mtime).toLocaleString();
      
      html += `
        <div class="image-item">
            <a href="${imageUrl}" target="_blank">
                <img src="${imageUrl}" alt="${path.basename(file.path)}" />
            </a>
            <div class="image-info">
                <strong>${path.basename(file.path)}</strong><br/>
                ${timestamp}<br/>
                <a href="${imageUrl}" target="_blank">View Full Size</a>
            </div>
        </div>`;
    });

    html += `
    </div>
</body>
</html>`;

  return html;
}

// Helper function to get recent image files
function getRecentImageFiles(directory, limit = 10) {
  try {
    if (!fs.existsSync(directory)) return [];

    const files = [];

    function scanDirectory(dir) {
      const items = fs.readdirSync(dir);

      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stats = fs.statSync(fullPath);

        if (stats.isDirectory()) {
          // OASC 카메라의 경우 jpg 폴더를 우선적으로 탐색
          if (item === 'jpg') {
            scanDirectory(fullPath);
          } else if (!dir.includes('/jpg')) {
            // jpg 폴더가 아닌 경우에만 재귀 탐색
            scanDirectory(fullPath);
          }
        } else if (item.endsWith('.jpg')) {
          files.push({
            path: fullPath,
            mtime: stats.mtime.getTime()
          });
        }
      }
    }

    scanDirectory(directory);
    return files.sort((a, b) => b.mtime - a.mtime).slice(0, limit);
  } catch (error) {
    console.error('Error scanning directory:', directory, error);
    return [];
  }
}

// Helper function to get images by time range
function getImagesByTimeRange(directory, startTime, endTime) {
  try {
    if (!fs.existsSync(directory)) return [];

    const files = [];

    function scanDirectory(dir) {
      const items = fs.readdirSync(dir);

      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stats = fs.statSync(fullPath);

        if (stats.isDirectory()) {
          // OASC 카메라의 경우 jpg 폴더를 우선적으로 탐색
          if (item === 'jpg') {
            scanDirectory(fullPath);
          } else if (!dir.includes('/jpg')) {
            // jpg 폴더가 아닌 경우에만 재귀 탐색
            scanDirectory(fullPath);
          }
        } else if (item.endsWith('.jpg')) {
          const mtime = stats.mtime.getTime();
          if (mtime >= startTime && mtime <= endTime) {
            files.push({
              path: fullPath,
              mtime: mtime
            });
          }
        }
      }
    }

    scanDirectory(directory);
    return files.sort((a, b) => b.mtime - a.mtime);
  } catch (error) {
    console.error('Error scanning directory:', directory, error);
    return [];
  }
}