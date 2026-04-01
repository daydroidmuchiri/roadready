-- ============================================================
-- RoadReady — Migration 004: Schema additions for v7 fixes
-- ============================================================

-- Photo evidence on jobs (for dispute resolution)
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS evidence_url VARCHAR(500);

-- Track which upload type each upload is
-- (already stored in provider_profiles as id_doc_url / equipment_doc_url)

-- Index for payout pending query (frequently called)
CREATE INDEX IF NOT EXISTS idx_jobs_payout_pending
  ON jobs(provider_id, status)
  WHERE status = 'completed';

-- Composite index for "all my completed jobs not yet in a payout"
-- The actual exclusion uses unnest(job_ids) which can't be indexed,
-- but the base scan is much faster with this index
CREATE INDEX IF NOT EXISTS idx_payouts_provider_jobs
  ON payouts USING GIN (job_ids)
  WHERE status IN ('pending', 'processing', 'completed');

-- OTP cleanup — remove used/expired codes older than 7 days
-- (run periodically via a cron job or Railway cron service)
-- CREATE INDEX for the cleanup query
CREATE INDEX IF NOT EXISTS idx_otp_cleanup
  ON otp_codes(created_at)
  WHERE used = TRUE;

-- Rate limit cleanup index
CREATE INDEX IF NOT EXISTS idx_otp_rl_cleanup
  ON otp_rate_limits(window_start);

-- Store provider's preferred payout phone on users table for convenience
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS payout_phone VARCHAR(20);

-- Sync payout_phone from provider_profiles on existing rows
UPDATE users u
SET payout_phone = pp.mpesa_phone
FROM provider_profiles pp
WHERE u.id = pp.user_id
  AND pp.mpesa_phone IS NOT NULL
  AND u.payout_phone IS NULL;

-- B2C conversation tracking for provider payouts
ALTER TABLE payouts
  ADD COLUMN IF NOT EXISTS b2c_conversation_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS failure_reason       TEXT;

CREATE INDEX IF NOT EXISTS idx_payouts_b2c_conv
  ON payouts(b2c_conversation_id)
  WHERE b2c_conversation_id IS NOT NULL;
