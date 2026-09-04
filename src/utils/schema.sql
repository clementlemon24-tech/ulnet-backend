-- ULNet PostgreSQL Database Schema
-- Run this once to create all tables.

-- ─── Users ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY,
  name          VARCHAR(200) NOT NULL,
  email         VARCHAR(320) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          VARCHAR(20) NOT NULL DEFAULT 'parent', -- 'parent' | 'child' | 'admin'
  fcm_token     TEXT,  -- Firebase Cloud Messaging token for push notifications
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ─── Children ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS children (
  id            UUID PRIMARY KEY,
  parent_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  child_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          VARCHAR(200) NOT NULL,
  age           SMALLINT NOT NULL,
  avatar        VARCHAR(10) DEFAULT '👦',
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_children_parent ON children(parent_id);

-- ─── User Settings ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_settings (
  user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  settings   JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Activity Log ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS activity_log (
  id          UUID PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        VARCHAR(50) NOT NULL,   -- 'image' | 'text' | 'url'
  reason      VARCHAR(100),           -- 'adult' | 'violence' | 'scam' | 'hate_speech' etc
  url         TEXT,
  platform    VARCHAR(100),
  content     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_user    ON activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_reason  ON activity_log(reason);

-- ─── Daily Reports ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS daily_reports (
  id               UUID PRIMARY KEY,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_date      DATE NOT NULL,
  blocked_total    INT NOT NULL DEFAULT 0,
  scams_blocked    INT NOT NULL DEFAULT 0,
  explicit_blocked INT NOT NULL DEFAULT 0,
  screen_time_data JSONB DEFAULT '{}',
  raw_summary      JSONB DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, report_date)
);

CREATE INDEX IF NOT EXISTS idx_reports_user ON daily_reports(user_id, report_date DESC);

-- ─── Screen Time ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS screen_time (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id      UUID NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  platform      VARCHAR(100) NOT NULL,
  minutes       INT NOT NULL DEFAULT 0,
  recorded_date DATE NOT NULL DEFAULT CURRENT_DATE,
  UNIQUE (child_id, platform, recorded_date)
);

CREATE INDEX IF NOT EXISTS idx_screentime_child ON screen_time(child_id, recorded_date);

-- ─── Auth Tokens ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS refresh_tokens (
  user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS password_resets (
  user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

-- ─── Subscriptions (for billing) ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS subscriptions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan       VARCHAR(50) NOT NULL DEFAULT 'free', -- 'free' | 'family' | 'school'
  status     VARCHAR(50) NOT NULL DEFAULT 'active',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_subs_user ON subscriptions(user_id);
