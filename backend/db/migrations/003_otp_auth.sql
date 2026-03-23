-- ============================================================
-- RoadReady — Migration 003: OTP Authentication
-- ============================================================

-- OTP codes table
-- Stores hashed OTPs with expiry, attempt tracking, and rate limiting.
-- One active OTP per phone at a time — new code invalidates the previous one.

CREATE TABLE otp_codes (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone           VARCHAR(20) NOT NULL,
  code_hash       VARCHAR(255) NOT NULL,    -- bcrypt hash of the 6-digit code
  purpose         VARCHAR(20) NOT NULL DEFAULT 'login',  -- login | register | verify
  expires_at      TIMESTAMPTZ NOT NULL,
  attempts        SMALLINT    NOT NULL DEFAULT 0,
  max_attempts    SMALLINT    NOT NULL DEFAULT 5,
  used            BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at         TIMESTAMPTZ,
  ip_address      VARCHAR(45),             -- IPv4 or IPv6
  user_agent      VARCHAR(500)
);

-- Index for fast lookup by phone (most common query)
CREATE INDEX idx_otp_phone ON otp_codes(phone, created_at DESC);
-- Index to quickly find active (unused, unexpired) codes
CREATE INDEX idx_otp_active ON otp_codes(phone, used, expires_at)
  WHERE used = FALSE;

-- OTP send rate limiting table
-- Tracks how many OTPs were sent to a phone/IP in a time window.
-- Prevents SMS bombing attacks.

CREATE TABLE otp_rate_limits (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  key         VARCHAR(60) NOT NULL,        -- phone or IP address
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  count       SMALLINT    NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX idx_otp_rl_key_window
  ON otp_rate_limits(key, window_start);
CREATE INDEX idx_otp_rl_key ON otp_rate_limits(key);

-- Drop password_hash requirement — OTP replaces it.
-- We keep the column for admin accounts that use password login.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- Mark existing users as phone-verified if they registered before OTP
-- (they verified via password, so we trust their phone)
UPDATE users SET is_verified = TRUE WHERE password_hash IS NOT NULL;
