#!/usr/bin/env python3
"""
Migrate OASC images from ewcs_images to oasc_images table
"""

import sqlite3
import sys

def migrate_images():
    try:
        # Connect to database
        conn = sqlite3.connect('data/ewcs.db')
        cursor = conn.cursor()

        # Start transaction
        conn.execute('BEGIN TRANSACTION')

        # Check current state
        cursor.execute("SELECT COUNT(*) FROM ewcs_images WHERE filename LIKE '%.fits'")
        fits_count = cursor.fetchone()[0]
        print(f"Found {fits_count} FITS files in ewcs_images table")

        cursor.execute("SELECT COUNT(*) FROM oasc_images")
        oasc_count = cursor.fetchone()[0]
        print(f"Current OASC images table has {oasc_count} records")

        if fits_count > 0:
            # Copy FITS files to oasc_images table
            print("\nMigrating FITS files to oasc_images table...")
            cursor.execute("""
                INSERT INTO oasc_images (timestamp, filename, created_at)
                SELECT timestamp, filename, created_at
                FROM ewcs_images
                WHERE filename LIKE '%.fits'
            """)

            migrated = cursor.rowcount
            print(f"Migrated {migrated} FITS files to oasc_images")

            # Delete FITS files from ewcs_images table
            print("Removing FITS files from ewcs_images table...")
            cursor.execute("""
                DELETE FROM ewcs_images
                WHERE filename LIKE '%.fits'
            """)

            deleted = cursor.rowcount
            print(f"Removed {deleted} FITS files from ewcs_images")

            # Commit transaction
            conn.commit()
            print("\nMigration completed successfully!")

            # Verify final state
            cursor.execute("SELECT COUNT(*) FROM ewcs_images")
            ewcs_final = cursor.fetchone()[0]
            cursor.execute("SELECT COUNT(*) FROM oasc_images")
            oasc_final = cursor.fetchone()[0]

            print(f"\nFinal state:")
            print(f"  ewcs_images (Spinel): {ewcs_final} records")
            print(f"  oasc_images (OASC): {oasc_final} records")

        else:
            print("No FITS files found in ewcs_images table. Nothing to migrate.")

        conn.close()
        return True

    except Exception as e:
        print(f"Error during migration: {e}")
        if conn:
            conn.rollback()
            conn.close()
        return False

if __name__ == "__main__":
    print("EWCS Image Table Migration Script")
    print("==================================")

    # Ask for confirmation
    response = input("\nThis will move all FITS files from ewcs_images to oasc_images table.\nContinue? (y/n): ")

    if response.lower() == 'y':
        if migrate_images():
            sys.exit(0)
        else:
            sys.exit(1)
    else:
        print("Migration cancelled.")
        sys.exit(0)