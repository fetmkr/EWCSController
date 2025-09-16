#!/usr/bin/env node
/**
 * Database Migration Script
 * Migrates ewcs_data table from old schema to new schema
 * - Changes mode column name to power_save_mode
 */

import Database from 'better-sqlite3';
import fs from 'fs';

const DB_PATH = './data/ewcs.db';
const BACKUP_PATH = './data/ewcs.db.backup';

console.log('🔄 Starting database migration...');

// Create backup
if (fs.existsSync(DB_PATH)) {
  console.log('📦 Creating backup...');
  fs.copyFileSync(DB_PATH, BACKUP_PATH);
  console.log(`✅ Backup created: ${BACKUP_PATH}`);
}

const db = new Database(DB_PATH);

try {
  // Check current schema
  const currentColumns = db.prepare('PRAGMA table_info(ewcs_data)').all();
  console.log('📋 Current table structure:', currentColumns.map(c => c.name).join(', '));

  // Begin transaction
  db.exec('BEGIN TRANSACTION');

  // Create new table with correct schema
  console.log('🔨 Creating new table with updated schema...');
  db.exec(`
    CREATE TABLE IF NOT EXISTS ewcs_data_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      station_name TEXT,
      power_save_mode TEXT DEFAULT 'normal',
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
      -- 전력 모니터링 데이터 (ADC 채널)
      chan1_current REAL,  -- CS125 전류 (기존 없음, 0으로 설정)
      chan2_current REAL,  -- 이리디움 전류 (기존 iridium_current)
      chan3_current REAL,  -- 카메라 전류 (기존 camera_current)
      chan4_current REAL,  -- 배터리 전류 (기존 battery_voltage)
      -- 태양광 충전기 데이터
      pv_vol REAL,
      pv_cur REAL,
      load_vol REAL,
      load_cur REAL,
      bat_temp REAL,
      dev_temp REAL,
      charg_equip_stat INTEGER,
      dischg_equip_stat INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migrate data
  console.log('📊 Migrating existing data...');
  db.exec(`
    INSERT INTO ewcs_data_new (
      id, timestamp, station_name, power_save_mode,
      cs125_current, cs125_visibility, cs125_synop, cs125_temp, cs125_humidity,
      sht45_temp, sht45_humidity, rpi_temp,
      chan1_current, chan2_current, chan3_current, chan4_current,
      pv_vol, pv_cur, load_vol, load_cur, bat_temp, dev_temp,
      charg_equip_stat, dischg_equip_stat, created_at
    )
    SELECT
      id, timestamp, station_name, mode as power_save_mode,
      cs125_current, cs125_visibility, cs125_synop, cs125_temp, cs125_humidity,
      sht45_temp, sht45_humidity, rpi_temp,
      chan1_current,
      chan2_current,
      chan3_current,
      chan4_current,
      pv_vol, pv_cur, load_vol, load_cur, bat_temp, dev_temp,
      charg_equip_stat, dischg_equip_stat, created_at
    FROM ewcs_data
  `);

  // Drop old table and rename new one
  console.log('🔄 Replacing old table...');
  db.exec('DROP TABLE ewcs_data');
  db.exec('ALTER TABLE ewcs_data_new RENAME TO ewcs_data');

  // Commit transaction
  db.exec('COMMIT');

  // Verify migration
  const newColumns = db.prepare('PRAGMA table_info(ewcs_data)').all();
  const rowCount = db.prepare('SELECT COUNT(*) as count FROM ewcs_data').get();

  console.log('✅ Migration completed successfully!');
  console.log('📋 New table structure:', newColumns.map(c => c.name).join(', '));
  console.log('📊 Migrated records:', rowCount.count);

} catch (error) {
  console.error('❌ Migration failed:', error.message);
  db.exec('ROLLBACK');

  // Restore backup if exists
  if (fs.existsSync(BACKUP_PATH)) {
    console.log('🔄 Restoring from backup...');
    fs.copyFileSync(BACKUP_PATH, DB_PATH);
    console.log('✅ Backup restored');
  }

  process.exit(1);
} finally {
  db.close();
}

console.log('🎉 Database migration completed!');
console.log(`💾 Backup kept at: ${BACKUP_PATH}`);