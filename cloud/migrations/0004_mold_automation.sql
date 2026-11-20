CREATE TABLE IF NOT EXISTS mold_automation_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1))
);

CREATE TABLE IF NOT EXISTS mold_automation_plan (
  mold TEXT NOT NULL,
  milestone TEXT NOT NULL,
  source_date TEXT NOT NULL,
  target INTEGER NOT NULL,
  shots INTEGER NOT NULL,
  planned_date TEXT,
  closed_date TEXT,
  PRIMARY KEY (mold, milestone)
);
