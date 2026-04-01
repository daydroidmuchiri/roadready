-- ============================================================
-- RoadReady — Migration 005: Add missing updated_at to jobs
-- ============================================================
--
-- Root cause: queries.js Jobs.updateStatus() sets `updated_at = NOW()`
-- but the jobs table was defined in 001_initial_schema.sql without this
-- column (users and provider_profiles have it; jobs was missed).
--
-- We also attach the existing set_updated_at() trigger so the column
-- is kept current on every UPDATE, consistent with the other tables.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- Back-fill existing rows so the column is never NULL after migration.
UPDATE jobs SET updated_at = created_at WHERE updated_at IS NULL;

-- Attach the existing trigger function (already used by users and
-- provider_profiles) so updated_at is maintained automatically.
-- DROP … IF EXISTS lets this file be re-run safely (idempotent).
DROP TRIGGER IF EXISTS trg_jobs_updated_at ON jobs;

CREATE TRIGGER trg_jobs_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
