#!/usr/bin/env python3
"""
Remove cs125_current column from ewcs_data table
"""

import sqlite3
import sys

def migrate_cs125_current():
    try:
        # Connect to database
        conn = sqlite3.connect('data/ewcs.db')
        cursor = conn.cursor()

        # Start transaction
        conn.execute('BEGIN TRANSACTION')

        # Check if cs125_current column exists
        cursor.execute("PRAGMA table_info(ewcs_data)")
        columns = cursor.fetchall()
        column_names = [col[1] for col in columns]

        if 'cs125_current' in column_names:
            print("Found cs125_current column in ewcs_data table")
            print("Current columns:", column_names)

            # Create new table without cs125_current column
            cursor.execute("""
                CREATE TABLE ewcs_data_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp INTEGER NOT NULL,
                    station_name TEXT,
                    power_save_mode TEXT DEFAULT 'normal',
                    -- CS125 센서 데이터
                    cs125_visibility REAL,
                    cs125_synop INTEGER,
                    cs125_temp REAL,
                    cs125_humidity REAL,
                    -- 환경 센서 데이터
                    sht45_temp REAL,
                    sht45_humidity REAL,
                    rpi_temp REAL,
                    -- 전력 모니터링 데이터 (ADC 채널)
                    chan1_current REAL,  -- CS125 전류
                    chan2_current REAL,  -- 이리디움 전류
                    chan3_current REAL,  -- 카메라 전류
                    chan4_current REAL,  -- 배터리/기타 전류
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
            """)

            # Copy data from old table to new table (excluding cs125_current)
            cursor.execute("""
                INSERT INTO ewcs_data_new (
                    id, timestamp, station_name, power_save_mode,
                    cs125_visibility, cs125_synop, cs125_temp, cs125_humidity,
                    sht45_temp, sht45_humidity, rpi_temp,
                    chan1_current, chan2_current, chan3_current, chan4_current,
                    pv_vol, pv_cur, load_vol, load_cur, bat_temp, dev_temp,
                    charg_equip_stat, dischg_equip_stat, created_at
                )
                SELECT
                    id, timestamp, station_name, power_save_mode,
                    cs125_visibility, cs125_synop, cs125_temp, cs125_humidity,
                    sht45_temp, sht45_humidity, rpi_temp,
                    chan1_current, chan2_current, chan3_current, chan4_current,
                    pv_vol, pv_cur, load_vol, load_cur, bat_temp, dev_temp,
                    charg_equip_stat, dischg_equip_stat, created_at
                FROM ewcs_data
            """)

            rows_migrated = cursor.rowcount
            print(f"Migrated {rows_migrated} rows to new table")

            # Drop old table
            cursor.execute("DROP TABLE ewcs_data")

            # Rename new table
            cursor.execute("ALTER TABLE ewcs_data_new RENAME TO ewcs_data")

            # Recreate index
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_ewcs_data_timestamp ON ewcs_data(timestamp)")

            # Commit transaction
            conn.commit()
            print("Successfully removed cs125_current column from ewcs_data table")

            # Verify final state
            cursor.execute("PRAGMA table_info(ewcs_data)")
            new_columns = cursor.fetchall()
            new_column_names = [col[1] for col in new_columns]
            print("New columns:", new_column_names)

        else:
            print("cs125_current column not found in ewcs_data table. Nothing to migrate.")

        conn.close()
        return True

    except Exception as e:
        print(f"Error during migration: {e}")
        if conn:
            conn.rollback()
            conn.close()
        return False

if __name__ == "__main__":
    print("EWCS cs125_current Column Removal Script")
    print("=======================================")

    # Ask for confirmation
    response = input("\nThis will remove the cs125_current column from ewcs_data table.\nContinue? (y/n): ")

    if response.lower() == 'y':
        if migrate_cs125_current():
            sys.exit(0)
        else:
            sys.exit(1)
    else:
        print("Migration cancelled.")
        sys.exit(0)