-- SNSAgent: platform accounts + publish jobs
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS platform_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL, -- instagram_reels | youtube_shorts | tiktok | facebook
  account_id TEXT,
  account_name TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TEXT,
  metadata_json TEXT,
  status TEXT NOT NULL DEFAULT 'connected', -- connected | expired | revoked
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, platform),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_platform_accounts_user
  ON platform_accounts(user_id, platform);

CREATE TABLE IF NOT EXISTS publish_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  generation_id TEXT,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  -- pending | processing | published | failed | manual_ready
  caption TEXT,
  title TEXT,
  media_r2_key TEXT,
  media_url TEXT,
  external_post_id TEXT,
  external_url TEXT,
  error_message TEXT,
  result_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_publish_jobs_user_created
  ON publish_jobs(user_id, created_at DESC);
