-- ============================================================
-- RoadReady — Migration 001: Initial Schema
-- Run via: node db/migrate.js
-- ============================================================

-- ─── Extensions ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";      -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";        -- fuzzy text search on names/addresses

-- ─── Enums ───────────────────────────────────────────────────

CREATE TYPE user_role    AS ENUM ('motorist', 'provider', 'admin');
CREATE TYPE user_status  AS ENUM ('available', 'on_job', 'offline', 'suspended');
CREATE TYPE job_status   AS ENUM (
  'searching', 'matched', 'en_route',
  'on_site', 'in_progress', 'completed', 'cancelled'
);
CREATE TYPE payment_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'refunded');
CREATE TYPE onboard_status AS ENUM ('pending', 'in_progress', 'approved', 'rejected');

-- ─── Users ───────────────────────────────────────────────────

CREATE TABLE users (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              VARCHAR(100) NOT NULL,
  phone             VARCHAR(20)  NOT NULL UNIQUE,
  password_hash     VARCHAR(255),
  role              user_role    NOT NULL DEFAULT 'motorist',
  rating            NUMERIC(3,2) NOT NULL DEFAULT 0.00,
  rating_count      INTEGER      NOT NULL DEFAULT 0,
  status            user_status  NOT NULL DEFAULT 'offline',

  -- Provider location (updated frequently by WebSocket)
  lat               NUMERIC(9,6),
  lng               NUMERIC(9,6),
  location_updated_at TIMESTAMPTZ,

  -- Profile
  avatar_url        VARCHAR(500),
  device_token      VARCHAR(500),   -- FCM push notification token
  is_verified       BOOLEAN      NOT NULL DEFAULT FALSE,

  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ            -- soft delete
);

CREATE INDEX idx_users_phone     ON users(phone);
CREATE INDEX idx_users_role      ON users(role);
CREATE INDEX idx_users_status    ON users(status) WHERE deleted_at IS NULL;
-- Spatial index for nearby-provider queries
CREATE INDEX idx_users_location  ON users(lat, lng)
  WHERE role = 'provider' AND status = 'available' AND deleted_at IS NULL;

-- ─── Provider Profiles ───────────────────────────────────────
-- Extended provider data separated from core user record.

CREATE TABLE provider_profiles (
  user_id           UUID        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

  -- Skills: stored as text array e.g. '{jumpstart,tyre,fuel}'
  skills            TEXT[]      NOT NULL DEFAULT '{}',

  -- Onboarding
  onboard_status    onboard_status NOT NULL DEFAULT 'pending',
  id_verified       BOOLEAN     NOT NULL DEFAULT FALSE,
  id_doc_url        VARCHAR(500),
  equipment_doc_url VARCHAR(500),
  background_check  BOOLEAN     NOT NULL DEFAULT FALSE,
  training_done     BOOLEAN     NOT NULL DEFAULT FALSE,

  -- Bank / M-Pesa payout details
  mpesa_phone       VARCHAR(20),
  bank_name         VARCHAR(100),
  bank_account      VARCHAR(50),

  -- Stats (denormalised for fast dashboard queries)
  total_jobs        INTEGER     NOT NULL DEFAULT 0,
  total_earnings    INTEGER     NOT NULL DEFAULT 0,    -- KES, stored as integer (no fractions)

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Services catalogue ──────────────────────────────────────

CREATE TABLE services (
  id                VARCHAR(30)  PRIMARY KEY,    -- e.g. 'jumpstart'
  name              VARCHAR(100) NOT NULL,
  price             INTEGER      NOT NULL,        -- KES
  commission        INTEGER      NOT NULL,        -- KES (flat fee)
  emoji             VARCHAR(10)  NOT NULL,
  duration_minutes  INTEGER      NOT NULL,
  is_active         BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── Jobs ────────────────────────────────────────────────────

CREATE SEQUENCE job_seq START WITH 1001 INCREMENT BY 1;

CREATE TABLE jobs (
  id                VARCHAR(10)  PRIMARY KEY DEFAULT ('J' || nextval('job_seq')),
  motorist_id       UUID         NOT NULL REFERENCES users(id),
  provider_id       UUID         REFERENCES users(id),
  service_id        VARCHAR(30)  NOT NULL REFERENCES services(id),

  -- Financials (immutable once set)
  price             INTEGER      NOT NULL,    -- KES
  commission        INTEGER      NOT NULL,    -- KES (platform cut)
  provider_earning  INTEGER      GENERATED ALWAYS AS (price - commission) STORED,

  -- Location of breakdown
  address           TEXT         NOT NULL,
  lat               NUMERIC(9,6) NOT NULL,
  lng               NUMERIC(9,6) NOT NULL,

  status            job_status   NOT NULL DEFAULT 'searching',

  -- Timestamps for each status change
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  matched_at        TIMESTAMPTZ,
  en_route_at       TIMESTAMPTZ,
  on_site_at        TIMESTAMPTZ,
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  cancelled_at      TIMESTAMPTZ,
  cancel_reason     TEXT,

  -- Motorist rating of provider (1-5), filled after completion
  motorist_rating   SMALLINT     CHECK (motorist_rating BETWEEN 1 AND 5),
  motorist_review   TEXT,

  -- Provider rating of motorist
  provider_rating   SMALLINT     CHECK (provider_rating BETWEEN 1 AND 5)
);

CREATE INDEX idx_jobs_motorist_id ON jobs(motorist_id);
CREATE INDEX idx_jobs_provider_id ON jobs(provider_id);
CREATE INDEX idx_jobs_status      ON jobs(status);
CREATE INDEX idx_jobs_created_at  ON jobs(created_at DESC);
-- Fast lookup: active jobs for a motorist
CREATE INDEX idx_jobs_active_motorist ON jobs(motorist_id, status)
  WHERE status NOT IN ('completed', 'cancelled');

-- ─── Job Status History ──────────────────────────────────────
-- Full audit trail of every status change.

CREATE TABLE job_status_history (
  id          BIGSERIAL    PRIMARY KEY,
  job_id      VARCHAR(10)  NOT NULL REFERENCES jobs(id),
  from_status job_status,
  to_status   job_status   NOT NULL,
  changed_by  UUID         REFERENCES users(id),
  note        TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_jsh_job_id ON job_status_history(job_id);

-- ─── Payments ────────────────────────────────────────────────

CREATE TABLE payments (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                VARCHAR(10)  NOT NULL REFERENCES jobs(id),
  motorist_id           UUID         NOT NULL REFERENCES users(id),
  amount                INTEGER      NOT NULL,    -- KES

  -- M-Pesa fields
  mpesa_phone           VARCHAR(20)  NOT NULL,
  checkout_request_id   VARCHAR(100) UNIQUE,
  merchant_request_id   VARCHAR(100),
  mpesa_receipt         VARCHAR(50),             -- M-Pesa confirmation code e.g. RH3720XXXX

  status                payment_status NOT NULL DEFAULT 'pending',
  failure_reason        TEXT,

  initiated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  confirmed_at          TIMESTAMPTZ,
  failed_at             TIMESTAMPTZ
);

CREATE INDEX idx_payments_job_id       ON payments(job_id);
CREATE INDEX idx_payments_motorist_id  ON payments(motorist_id);
CREATE INDEX idx_payments_checkout_id  ON payments(checkout_request_id);

-- ─── Provider Payouts ────────────────────────────────────────

CREATE TABLE payouts (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id     UUID         NOT NULL REFERENCES users(id),
  amount          INTEGER      NOT NULL,    -- KES
  job_ids         VARCHAR(10)[] NOT NULL,   -- jobs included in this payout
  mpesa_phone     VARCHAR(20)  NOT NULL,
  mpesa_receipt   VARCHAR(50),
  status          payment_status NOT NULL DEFAULT 'pending',
  initiated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX idx_payouts_provider_id ON payouts(provider_id);

-- ─── Refresh Tokens ──────────────────────────────────────────

CREATE TABLE refresh_tokens (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(255) NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at  TIMESTAMPTZ
);

CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);

-- ─── Trigger: updated_at auto-update ────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_provider_profiles_updated_at
  BEFORE UPDATE ON provider_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Trigger: auto-create provider_profile on provider register ──

CREATE OR REPLACE FUNCTION create_provider_profile()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.role = 'provider' THEN
    INSERT INTO provider_profiles (user_id) VALUES (NEW.id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_create_provider_profile
  AFTER INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION create_provider_profile();

-- ─── Trigger: log all job status changes ────────────────────

CREATE OR REPLACE FUNCTION log_job_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO job_status_history (job_id, from_status, to_status)
    VALUES (NEW.id, OLD.status, NEW.status);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_job_status_history
  AFTER UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION log_job_status_change();

-- ─── Trigger: update provider stats on job completion ────────

CREATE OR REPLACE FUNCTION update_provider_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status != 'completed' AND NEW.provider_id IS NOT NULL THEN
    UPDATE provider_profiles
    SET
      total_jobs     = total_jobs + 1,
      total_earnings = total_earnings + NEW.provider_earning
    WHERE user_id = NEW.provider_id;

    -- Free up the provider
    UPDATE users SET status = 'available' WHERE id = NEW.provider_id;
  END IF;

  -- Free provider if job is cancelled while en-route or on-site
  IF NEW.status = 'cancelled' AND OLD.status IN ('matched','en_route','on_site','in_progress')
     AND NEW.provider_id IS NOT NULL THEN
    UPDATE users SET status = 'available' WHERE id = NEW.provider_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_provider_stats
  AFTER UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION update_provider_stats();

-- ─── Trigger: recalculate user rating on new rating ──────────

CREATE OR REPLACE FUNCTION recalculate_rating()
RETURNS TRIGGER AS $$
BEGIN
  -- Recalculate provider's average rating when motorist submits a rating
  IF NEW.motorist_rating IS NOT NULL AND
     (OLD.motorist_rating IS NULL OR OLD.motorist_rating != NEW.motorist_rating) THEN
    UPDATE users
    SET
      rating       = (
        SELECT ROUND(AVG(motorist_rating)::numeric, 2)
        FROM jobs
        WHERE provider_id = NEW.provider_id AND motorist_rating IS NOT NULL
      ),
      rating_count = (
        SELECT COUNT(*) FROM jobs
        WHERE provider_id = NEW.provider_id AND motorist_rating IS NOT NULL
      )
    WHERE id = NEW.provider_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_recalculate_rating
  AFTER UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION recalculate_rating();

-- ─── Views ───────────────────────────────────────────────────

-- Job details view (joins motorist + provider info)
CREATE VIEW job_details AS
SELECT
  j.*,
  s.name          AS service_name,
  s.emoji         AS service_emoji,
  s.duration_minutes,
  m.name          AS motorist_name,
  m.phone         AS motorist_phone,
  m.rating        AS motorist_rating_avg,
  p.name          AS provider_name,
  p.phone         AS provider_phone,
  p.rating        AS provider_rating_avg,
  p.lat           AS provider_lat,
  p.lng           AS provider_lng
FROM jobs j
JOIN services s ON j.service_id = s.id
JOIN users m    ON j.motorist_id = m.id
LEFT JOIN users p ON j.provider_id = p.id;

-- Today's analytics view
CREATE VIEW analytics_today AS
SELECT
  COUNT(*)                                                     AS total_jobs,
  COUNT(*) FILTER (WHERE status = 'completed')                 AS completed_jobs,
  COUNT(*) FILTER (WHERE status = 'cancelled')                 AS cancelled_jobs,
  COUNT(*) FILTER (WHERE status NOT IN ('completed','cancelled')) AS active_jobs,
  COALESCE(SUM(price)   FILTER (WHERE status = 'completed'), 0) AS total_revenue,
  COALESCE(SUM(commission) FILTER (WHERE status = 'completed'), 0) AS total_commission,
  ROUND(AVG(
    EXTRACT(EPOCH FROM (matched_at - created_at)) / 60.0
  ) FILTER (WHERE matched_at IS NOT NULL), 1)                  AS avg_response_minutes
FROM jobs
WHERE created_at >= CURRENT_DATE;
