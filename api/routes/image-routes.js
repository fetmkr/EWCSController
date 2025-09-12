import express from 'express';
import path from 'path';
import fs from 'fs';

export default function createImageRoutes(database) {
  const router = express.Router();

  // Static serving for both camera image directories
  router.use('/spinel', express.static(path.join(process.cwd(), 'ewcs_images')));
  router.use('/oasc', express.static(path.join(process.cwd(), 'oasc_images')));

  // Get latest images from specific camera
  router.get('/:camera/latest/:limit?', (req, res) => {
    const isApiRoute = req.originalUrl.startsWith('/api/');
    
    if (!isApiRoute) {
      // HTML response for non-API routes (/images/...)
      return handleLatestImagesHTML(req, res);
    }
    
    // JSON response for API calls (/api/images/...)
    try {
      const { camera } = req.params;
      const limit = parseInt(req.params.limit) || 10;
      
      if (!['spinel', 'oasc'].includes(camera)) {
        return res.status(400).json({ error: 'Invalid camera. Use "spinel" or "oasc"' });
      }
      
      const folderName = camera === 'spinel' ? 'ewcs_images' : 'oasc_images';
      const imagePath = path.join(process.cwd(), folderName);
      
      // Get files from directory and sort by modification time
      const files = getRecentImageFiles(imagePath, limit);
      const imageList = files.map(file => ({
        fullUrl: `${req.protocol}://${req.get('host')}/api/images/${camera}/${path.relative(imagePath, file.path)}`,
        filename: path.basename(file.path),
        timestamp: file.mtime,
        camera: camera
      }));
      
      res.json({
        camera: camera,
        count: imageList.length,
        images: imageList,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('Failed to get latest images:', error);
      res.status(500).json({ error: error.message });
    }
  });


  // Get images by time range for specific camera
  router.get('/:camera/last/:hours', (req, res) => {
    try {
      const { camera } = req.params;
      const hours = parseInt(req.params.hours) || 1;
      
      if (!['spinel', 'oasc'].includes(camera)) {
        return res.status(400).json({ error: 'Invalid camera. Use "spinel" or "oasc"' });
      }
      
      const startTime = Date.now() - (hours * 60 * 60 * 1000);
      const folderName = camera === 'spinel' ? 'ewcs_images' : 'oasc_images';
      const imagePath = path.join(process.cwd(), folderName);
      
      const files = getImagesByTimeRange(imagePath, startTime, Date.now());
      const imageList = files.map(file => ({
        fullUrl: `${req.protocol}://${req.get('host')}/api/images/${camera}/${path.relative(imagePath, file.path)}`,
        filename: path.basename(file.path),
        timestamp: file.mtime,
        camera: camera
      }));
      
      res.json({
        camera: camera,
        hours: hours,
        count: imageList.length,
        images: imageList,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('Failed to get images by time range:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}

// HTML response handler for latest images
function handleLatestImagesHTML(req, res) {
  try {
    const { camera } = req.params;
    const limit = parseInt(req.params.limit) || 10;
    
    if (!['spinel', 'oasc'].includes(camera)) {
      return res.status(400).send('<h1>Error: Invalid camera. Use "spinel" or "oasc"</h1>');
    }
    
    const folderName = camera === 'spinel' ? 'ewcs_images' : 'oasc_images';
    const imagePath = path.join(process.cwd(), folderName);
    
    const files = getRecentImageFiles(imagePath, limit);
    
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
        <a href="/images/spinel/latest/20">Spinel Camera</a>
        <a href="/images/oasc/latest/20">OASC Camera</a>
    </div>
    
    <h1>${camera.toUpperCase()} Camera - Latest ${limit} Images</h1>
    <p>Total images: ${files.length}</p>
    
    <div class="image-grid">`;

    files.forEach(file => {
      const relativePath = path.relative(imagePath, file.path);
      const imageUrl = `/api/images/${camera}/${relativePath}`;
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

    res.send(html);
  } catch (error) {
    console.error('Failed to generate HTML view:', error);
    res.status(500).send('<h1>Error loading images</h1>');
  }
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
          scanDirectory(fullPath);
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
          scanDirectory(fullPath);
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