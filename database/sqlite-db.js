import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import config from '../config/app-config.js';

class SQLiteDB {
  constructor() {
    this.db = null;
    this.dbPath = config.get('database.path');
    this.isInitialized = false;
  }

  async initialize() {
    if (this.isInitialized) return this.db;

    try {
      // Ensure data directory exists
      const dataDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      // Open database connection
      this.db = new sqlite3.Database(this.dbPath);

      // Enable WAL mode for better performance
      await this.db.exec('PRAGMA journal_mode = WAL;');
      await this.db.exec('PRAGMA synchronous = NORMAL;');
      await this.db.exec('PRAGMA temp_store = MEMORY;');
      await this.db.exec('PRAGMA mmap_size = 268435456;'); // 256MB

      // Create tables
      await this.createTables();
      
      this.isInitialized = true;
      console.log('SQLite database initialized at:', this.dbPath);
      
      return this.db;
    } catch (error) {
      console.error('Failed to initialize SQLite database:', error);
      throw error;
    }
  }

  async createTables() {
    // EWCS sensor data table (원래 ewcs.js와 동일한 모든 필드 포함)
    await this.db.exec(`
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

    // Image metadata table
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS ewcs_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        filename TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_size INTEGER,
        capture_status TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Battery/BMS data table
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS battery_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        device_id INTEGER,
        voltage REAL,
        current REAL,
        soc REAL,
        temperature REAL,
        status TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // System status table
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS system_status (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        cs125_on INTEGER DEFAULT 0,
        camera_on INTEGER DEFAULT 0,
        cs125_hood_heater_on INTEGER DEFAULT 0,
        power_save_mode INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes for better query performance
    await this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_ewcs_data_timestamp ON ewcs_data(timestamp);
    `);
    await this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_ewcs_images_timestamp ON ewcs_images(timestamp);
    `);
    await this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_battery_data_timestamp ON battery_data(timestamp);
    `);
    await this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_system_status_timestamp ON system_status(timestamp);
    `);
  }

  async insertEwcsData(data) {
    await this.ensureInitialized();
    
    const query = `
      INSERT INTO ewcs_data (
        timestamp, station_name, mode,
        cs125_current, cs125_visibility, cs125_synop, cs125_temp, cs125_humidity,
        sht45_temp, sht45_humidity, rpi_temp,
        iridium_current, camera_current, battery_voltage,
        pv_vol, pv_cur, load_vol, load_cur, bat_temp, dev_temp,
        charg_equip_stat, dischg_equip_stat, last_image
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
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
      const result = await this.db.run(query, params);
      return { success: true, id: result.lastID };
    } catch (error) {
      console.error('Failed to insert EWCS data:', error);
      throw error;
    }
  }

  async insertImageData(imageData) {
    await this.ensureInitialized();
    
    const query = `
      INSERT INTO ewcs_images (timestamp, filename, file_path, file_size, capture_status)
      VALUES (?, ?, ?, ?, ?)
    `;
    
    const params = [
      imageData.timestamp || Date.now(),
      imageData.filename,
      imageData.filePath,
      imageData.fileSize || 0,
      imageData.status || 'captured'
    ];

    try {
      const result = await this.db.run(query, params);
      return { success: true, id: result.lastID };
    } catch (error) {
      console.error('Failed to insert image data:', error);
      throw error;
    }
  }

  async insertBatteryData(batteryData) {
    await this.ensureInitialized();
    
    const query = `
      INSERT INTO battery_data (timestamp, device_id, voltage, current, soc, temperature, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    
    const params = [
      batteryData.timestamp || Date.now(),
      batteryData.deviceId,
      batteryData.voltage,
      batteryData.current,
      batteryData.soc,
      batteryData.temperature,
      batteryData.status
    ];

    try {
      const result = await this.db.run(query, params);
      return { success: true, id: result.lastID };
    } catch (error) {
      console.error('Failed to insert battery data:', error);
      throw error;
    }
  }

  async getEwcsData(startTime, endTime, limit = 100) {
    await this.ensureInitialized();
    
    const query = `
      SELECT * FROM ewcs_data 
      WHERE timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp DESC
      LIMIT ?
    `;
    
    try {
      return await this.db.all(query, [startTime, endTime, limit]);
    } catch (error) {
      console.error('Failed to get EWCS data:', error);
      throw error;
    }
  }

  async getImageData(startTime, endTime, limit = 100) {
    await this.ensureInitialized();
    
    const query = `
      SELECT * FROM ewcs_images 
      WHERE timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp DESC
      LIMIT ?
    `;
    
    try {
      return await this.db.all(query, [startTime, endTime, limit]);
    } catch (error) {
      console.error('Failed to get image data:', error);
      throw error;
    }
  }

  async getLatestData(table, limit = 1) {
    await this.ensureInitialized();
    
    const query = `
      SELECT * FROM ${table}
      ORDER BY timestamp DESC
      LIMIT ?
    `;
    
    try {
      const results = await this.db.all(query, [limit]);
      return limit === 1 ? results[0] : results;
    } catch (error) {
      console.error(`Failed to get latest data from ${table}:`, error);
      throw error;
    }
  }

  async deleteOldData(table, maxAge) {
    await this.ensureInitialized();
    
    const cutoffTime = Date.now() - maxAge;
    const query = `DELETE FROM ${table} WHERE timestamp < ?`;
    
    try {
      const result = await this.db.run(query, [cutoffTime]);
      console.log(`Deleted ${result.changes} old records from ${table}`);
      return result.changes;
    } catch (error) {
      console.error(`Failed to delete old data from ${table}:`, error);
      throw error;
    }
  }

  async vacuum() {
    await this.ensureInitialized();
    
    try {
      await this.db.exec('VACUUM;');
      console.log('Database vacuum completed');
    } catch (error) {
      console.error('Database vacuum failed:', error);
      throw error;
    }
  }

  async backup(backupPath) {
    await this.ensureInitialized();
    
    try {
      await this.db.backup(backupPath);
      console.log('Database backup created at:', backupPath);
    } catch (error) {
      console.error('Database backup failed:', error);
      throw error;
    }
  }

  async close() {
    if (this.db) {
      await this.db.close();
      this.db = null;
      this.isInitialized = false;
      console.log('Database connection closed');
    }
  }

  async ensureInitialized() {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  // Helper method to get database stats
  async getStats() {
    await this.ensureInitialized();
    
    try {
      const stats = {};
      const tables = ['ewcs_data', 'ewcs_images', 'battery_data', 'system_status'];
      
      for (const table of tables) {
        const result = await this.db.get(`SELECT COUNT(*) as count FROM ${table}`);
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