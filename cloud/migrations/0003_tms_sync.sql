-- Migration 0003: TMS Cloud Sync Cache Table
CREATE TABLE IF NOT EXISTS tms_sync_data (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
