import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import config from '../config/app-config.js';

class SQLiteDB {
  constructor() {
    this.db = null;
    this.dbPath = config.get('database.path');
    this.isInitialized = false;
  }

  initialize() {
    if (this.isInitialized) return this.db;

    try {
      // Ensure data directory exists
      const dataDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      // Open database connection with better-sqlite3
      this.db = new Database(this.dbPath);

      // Enable WAL mode for better performance
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');
      this.db.pragma('temp_store = MEMORY');
      this.db.pragma('mmap_size = 268435456'); // 256MB

      // Create tables
      this.createTables();
      
      // Prepare statements for better performance
      this.prepareStatements();
      
      this.isInitialized = true;
      console.log('SQLite database initialized at:', this.dbPath);
      
      return this.db;
    } catch (error) {
      console.error('Failed to initialize SQLite database:', error);
      throw error;
    }
  }

  createTables() {
    // EWCS sensor data table (원래 ewcs.js와 동일한 모든 필드 포함)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ewcs_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        station_name TEXT,
        mode TEXT DEFAULT 'normal',
        -- CS125 센서 데이터
        cs125_current REAL,
        cs125_visibility REAL,
        cs125_synop INTEGER,
        cs125_temp REAL,
        cs125_humidity REAL,
        -- 환경 센서 데이터
        sht45_temp REAL,
        sht45_humidity REAL,
        rpi_temp REAL,
        -- 전력 모니터링 데이터
        iridium_current REAL,
        camera_current REAL,
        battery_voltage REAL,
        -- 태양광 충전기 데이터
        pv_vol REAL,
        pv_cur REAL,
        load_vol REAL,
        load_cur REAL,
        bat_temp REAL,
        dev_temp REAL,
        charg_equip_stat INTEGER,
        dischg_equip_stat INTEGER,
        -- 이미지 정보
        last_image TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Image metadata table (simplified)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ewcs_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        filename TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // OASC image metadata table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS oasc_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        filename TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes for better query performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_ewcs_data_timestamp ON ewcs_data(timestamp);
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_ewcs_images_timestamp ON ewcs_images(timestamp);
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_oasc_images_timestamp ON oasc_images(timestamp);
    `);
  }

  prepareStatements() {
    // Prepare insert statements for better performance
    this.stmts = {
      insertEwcsData: this.db.prepare(`
        INSERT INTO ewcs_data (
          timestamp, station_name, mode,
          cs125_current, cs125_visibility, cs125_synop, cs125_temp, cs125_humidity,
          sht45_temp, sht45_humidity, rpi_temp,
          iridium_current, camera_current, battery_voltage,
          pv_vol, pv_cur, load_vol, load_cur, bat_temp, dev_temp,
          charg_equip_stat, dischg_equip_stat, last_image
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      
      insertImageData: this.db.prepare(`
        INSERT INTO ewcs_images (timestamp, filename)
        VALUES (?, ?)
      `),

      insertOascImageData: this.db.prepare(`
        INSERT INTO oasc_images (timestamp, filename)
        VALUES (?, ?)
      `),
      
      getLatestEwcsData: this.db.prepare(`
        SELECT * FROM ewcs_data
        ORDER BY timestamp DESC
        LIMIT ?
      `),
      
      getLatestImageData: this.db.prepare(`
        SELECT * FROM ewcs_images
        ORDER BY timestamp DESC
        LIMIT ?
      `),

      getLatestOascImageData: this.db.prepare(`
        SELECT * FROM oasc_images
        ORDER BY timestamp DESC
        LIMIT ?
      `),
      
      getEwcsDataRange: this.db.prepare(`
        SELECT * FROM ewcs_data 
        WHERE timestamp >= ? AND timestamp <= ?
        ORDER BY timestamp DESC
        LIMIT ?
      `),
      
      getImageDataRange: this.db.prepare(`
        SELECT * FROM ewcs_images 
        WHERE timestamp >= ? AND timestamp <= ?
        ORDER BY timestamp DESC
        LIMIT ?
      `),

      getOascImageDataRange: this.db.prepare(`
        SELECT * FROM oasc_images 
        WHERE timestamp >= ? AND timestamp <= ?
        ORDER BY timestamp DESC
        LIMIT ?
      `),
      
      deleteOldEwcsData: this.db.prepare(`
        DELETE FROM ewcs_data WHERE timestamp < ?
      `),
      
      deleteOldImageData: this.db.prepare(`
        DELETE FROM ewcs_images WHERE timestamp < ?
      `),

      deleteOldOascImageData: this.db.prepare(`
        DELETE FROM oasc_images WHERE timestamp < ?
      `)
    };
  }

  insertEwcsData(data) {
    this.ensureInitialized();
    
    const params = [
      data.timestamp || Date.now(),
      data.stationName,
      data.mode || 'normal',
      // CS125 센서 데이터
      data.cs125Current || 0,
      data.cs125Visibility || 0,
      data.cs125SYNOP || 0,
      data.cs125Temp || 0,
      data.cs125Humidity || 0,
      // 환경 센서 데이터
      data.SHT45Temp || 0,
      data.SHT45Humidity || 0,
      data.rpiTemp || 0,
      // 전력 모니터링 데이터
      data.iridiumCurrent || 0,
      data.cameraCurrent || 0,
      data.batteryVoltage || 0,
      // 태양광 충전기 데이터
      data.PVVol || 0,
      data.PVCur || 0,
      data.LoadVol || 0,
      data.LoadCur || 0,
      data.BatTemp || 0,
      data.DevTemp || 0,
      data.ChargEquipStat || 0,
      data.DischgEquipStat || 0,
      // 이미지 정보
      data.lastImage || ''
    ];

    try {
      const result = this.stmts.insertEwcsData.run(...params);
      return { success: true, id: result.lastInsertRowid };
    } catch (error) {
      console.error('Failed to insert EWCS data:', error);
      throw error;
    }
  }

  insertImageData(imageData) {
    this.ensureInitialized();
    
    const params = [
      imageData.timestamp || Date.now(),
      imageData.filename
    ];

    try {
      const result = this.stmts.insertImageData.run(...params);
      return { success: true, id: result.lastInsertRowid };
    } catch (error) {
      console.error('Failed to insert image data:', error);
      throw error;
    }
  }

  insertOascImageData(imageData) {
    this.ensureInitialized();
    
    const params = [
      imageData.timestamp || Date.now(),
      imageData.filename
    ];

    try {
      const result = this.stmts.insertOascImageData.run(...params);
      return { success: true, id: result.lastInsertRowid };
    } catch (error) {
      console.error('Failed to insert OASC image data:', error);
      throw error;
    }
  }

  getEwcsData(startTime, endTime, limit = 100) {
    this.ensureInitialized();
    
    try {
      return this.stmts.getEwcsDataRange.all(startTime, endTime, limit);
    } catch (error) {
      console.error('Failed to get EWCS data:', error);
      throw error;
    }
  }

  getImageData(startTime, endTime, limit = 100) {
    this.ensureInitialized();
    
    try {
      return this.stmts.getImageDataRange.all(startTime, endTime, limit);
    } catch (error) {
      console.error('Failed to get image data:', error);
      throw error;
    }
  }

  getLatestData(table, limit = 1) {
    this.ensureInitialized();
    
    try {
      let results;
      if (table === 'ewcs_data') {
        results = this.stmts.getLatestEwcsData.all(limit);
      } else if (table === 'ewcs_images') {
        results = this.stmts.getLatestImageData.all(limit);
      } else if (table === 'oasc_images') {
        results = this.stmts.getLatestOascImageData.all(limit);
      } else {
        // Fallback for other tables
        const stmt = this.db.prepare(`
          SELECT * FROM ${table}
          ORDER BY timestamp DESC
          LIMIT ?
        `);
        results = stmt.all(limit);
      }
      
      return results;
    } catch (error) {
      console.error(`Failed to get latest data from ${table}:`, error);
      throw error;
    }
  }

  deleteOldData(table, maxAge) {
    this.ensureInitialized();
    
    const cutoffTime = Date.now() - maxAge;
    
    try {
      let result;
      if (table === 'ewcs_data') {
        result = this.stmts.deleteOldEwcsData.run(cutoffTime);
      } else if (table === 'ewcs_images') {
        result = this.stmts.deleteOldImageData.run(cutoffTime);
      } else if (table === 'oasc_images') {
        result = this.stmts.deleteOldOascImageData.run(cutoffTime);
      } else {
        const stmt = this.db.prepare(`DELETE FROM ${table} WHERE timestamp < ?`);
        result = stmt.run(cutoffTime);
      }
      
      console.log(`Deleted ${result.changes} old records from ${table}`);
      return result.changes;
    } catch (error) {
      console.error(`Failed to delete old data from ${table}:`, error);
      throw error;
    }
  }

  vacuum() {
    this.ensureInitialized();
    
    try {
      this.db.exec('VACUUM');
      console.log('Database vacuum completed');
    } catch (error) {
      console.error('Database vacuum failed:', error);
      throw error;
    }
  }

  backup(backupPath) {
    this.ensureInitialized();
    
    try {
      this.db.backup(backupPath);
      console.log('Database backup created at:', backupPath);
    } catch (error) {
      console.error('Database backup failed:', error);
      throw error;
    }
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.isInitialized = false;
      console.log('Database connection closed');
    }
  }

  ensureInitialized() {
    if (!this.isInitialized) {
      this.initialize();
    }
  }

  // Helper method to get database stats
  getStats() {
    this.ensureInitialized();
    
    try {
      const stats = {};
      const tables = ['ewcs_data', 'ewcs_images', 'oasc_images'];
      
      for (const table of tables) {
        const stmt = this.db.prepare(`SELECT COUNT(*) as count FROM ${table}`);
        const result = stmt.get();
        stats[table] = result.count;
      }
      
      // Database size
      const dbStats = fs.statSync(this.dbPath);
      stats.fileSize = dbStats.size;
      
      return stats;
    } catch (error) {
      console.error('Failed to get database stats:', error);
      throw error;
    }
  }
}

// Singleton instance
const database = new SQLiteDB();

export default database;
export { SQLiteDB };