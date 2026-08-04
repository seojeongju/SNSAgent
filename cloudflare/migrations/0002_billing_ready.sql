-- SNSAgent D1: billing-ready + generation history
PRAGMA foreign_keys = ON;

-- Extend users for future auth (nullable for now)
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN plan_code TEXT NOT NULL DEFAULT 'free';

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,              -- free | pro | business
  name TEXT NOT NULL,
  generations_per_month INTEGER NOT NULL,
  seats INTEGER NOT NULL DEFAULT 1,
  stripe_price_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',  -- active | past_due | canceled | trialing
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  current_period_end TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id) REFERENCES plans(id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

CREATE TABLE IF NOT EXISTS usage_counters (
  user_id TEXT NOT NULL,
  period TEXT NOT NULL,                  -- YYYY-MM
  generations_used INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, period),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS generations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  content_type TEXT NOT NULL,
  topic TEXT NOT NULL,
  tone TEXT,
  result_json TEXT NOT NULL,
  r2_key TEXT,
  openai_usage_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_generations_user_created
  ON generations(user_id, created_at DESC);

-- Seed default plans
INSERT OR IGNORE INTO plans (id, code, name, generations_per_month, seats) VALUES
  ('plan_free', 'free', 'Free', 20, 1),
  ('plan_pro', 'pro', 'Pro', 500, 1),
  ('plan_business', 'business', 'Business', 5000, 5);
