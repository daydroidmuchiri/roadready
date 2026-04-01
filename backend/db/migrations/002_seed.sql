-- ============================================================
-- RoadReady — Migration 002: Seed Data
-- ============================================================

-- ─── Services catalogue ──────────────────────────────────────

INSERT INTO services (id, name, price, commission, emoji, duration_minutes) VALUES
  ('jumpstart', 'Battery Jumpstart', 900,  150, '🔋', 20),
  ('tyre',      'Flat Tyre Change',  700,  120, '🛞', 25),
  ('fuel',      'Fuel Delivery',     1400, 240, '⛽', 30),
  ('lockout',   'Lockout Service',   2000, 350, '🔑', 20),
  ('tow',       'Tow Service',       5500, 900, '🚛', 45),
  ('repair',    'Roadside Repair',   2500, 400, '🔧', 60)
ON CONFLICT (id) DO UPDATE SET
  name             = EXCLUDED.name,
  price            = EXCLUDED.price,
  commission       = EXCLUDED.commission,
  emoji            = EXCLUDED.emoji,
  duration_minutes = EXCLUDED.duration_minutes;

-- ─── Demo users (development only) ───────────────────────────
-- Passwords are all 'password123' hashed with bcrypt (12 rounds)
-- DO NOT use these in production — they are for local dev only.

DO $$
DECLARE
  -- bcrypt hash of 'password123' with 12 rounds
  hash TEXT := '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewXYu.p6B5V4WORO';
BEGIN

-- Admin
INSERT INTO users (id, name, phone, password_hash, role, status, is_verified)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Admin User', '0700000001', hash, 'admin', 'available', TRUE
) ON CONFLICT (phone) DO NOTHING;

-- Motorist 1
INSERT INTO users (id, name, phone, password_hash, role, status, is_verified)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  'Alice Njoroge', '0712345678', hash, 'motorist', 'offline', TRUE
) ON CONFLICT (phone) DO NOTHING;

-- Motorist 2
INSERT INTO users (id, name, phone, password_hash, role, status, is_verified)
VALUES (
  '00000000-0000-0000-0000-000000000003',
  'Brian Mutua', '0712345679', hash, 'motorist', 'offline', TRUE
) ON CONFLICT (phone) DO NOTHING;

-- Provider 1 — Grace Wangari (Westlands)
INSERT INTO users (id, name, phone, password_hash, role, status, is_verified, rating, rating_count, lat, lng)
VALUES (
  '00000000-0000-0000-0000-000000000010',
  'Grace Wangari', '0723456789', hash, 'provider', 'available', TRUE,
  4.90, 312, -1.2641, 36.8033
) ON CONFLICT (phone) DO NOTHING;

INSERT INTO provider_profiles (user_id, skills, onboard_status, id_verified, background_check, training_done, total_jobs, total_earnings, mpesa_phone)
VALUES (
  '00000000-0000-0000-0000-000000000010',
  ARRAY['jumpstart','tyre','fuel'], 'approved', TRUE, TRUE, TRUE, 312, 192640, '0723456789'
) ON CONFLICT (user_id) DO NOTHING;

-- Provider 2 — Peter Kamau (Karen)
INSERT INTO users (id, name, phone, password_hash, role, status, is_verified, rating, rating_count, lat, lng)
VALUES (
  '00000000-0000-0000-0000-000000000011',
  'Peter Kamau', '0734567890', hash, 'provider', 'available', TRUE,
  4.80, 289, -1.3167, 36.7800
) ON CONFLICT (phone) DO NOTHING;

INSERT INTO provider_profiles (user_id, skills, onboard_status, id_verified, background_check, training_done, total_jobs, total_earnings, mpesa_phone)
VALUES (
  '00000000-0000-0000-0000-000000000011',
  ARRAY['repair','tow','lockout'], 'approved', TRUE, TRUE, TRUE, 289, 412750, '0734567890'
) ON CONFLICT (user_id) DO NOTHING;

-- Provider 3 — James Mwangi (South B)
INSERT INTO users (id, name, phone, password_hash, role, status, is_verified, rating, rating_count, lat, lng)
VALUES (
  '00000000-0000-0000-0000-000000000012',
  'James Mwangi', '0745678901', hash, 'provider', 'available', TRUE,
  4.60, 178, -1.3040, 36.8295
) ON CONFLICT (phone) DO NOTHING;

INSERT INTO provider_profiles (user_id, skills, onboard_status, id_verified, background_check, training_done, total_jobs, total_earnings, mpesa_phone)
VALUES (
  '00000000-0000-0000-0000-000000000012',
  ARRAY['lockout','jumpstart','tyre'], 'approved', TRUE, TRUE, TRUE, 178, 115400, '0745678901'
) ON CONFLICT (user_id) DO NOTHING;

-- Provider 4 — Sarah Kinyua (Parklands) — pending onboarding
INSERT INTO users (id, name, phone, password_hash, role, status, is_verified, rating, rating_count, lat, lng)
VALUES (
  '00000000-0000-0000-0000-000000000013',
  'Sarah Kinyua', '0756789012', hash, 'provider', 'offline', FALSE,
  0.00, 0, -1.2590, 36.8100
) ON CONFLICT (phone) DO NOTHING;

INSERT INTO provider_profiles (user_id, skills, onboard_status, id_verified, training_done, mpesa_phone)
VALUES (
  '00000000-0000-0000-0000-000000000013',
  ARRAY['tyre','fuel'], 'in_progress', TRUE, FALSE, '0756789012'
) ON CONFLICT (user_id) DO NOTHING;

END $$;

-- ─── Demo job (for testing) ───────────────────────────────────
-- NOTE: id is J9001 (not J1001) so it never collides with the sequence
-- (job_seq starts at 1001 and counts up). The setval call below ensures
-- all sequence-generated IDs start above 9000.

INSERT INTO jobs (id, motorist_id, provider_id, service_id, price, commission, address, lat, lng, status, created_at, matched_at)
VALUES (
  'J9001',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000010',
  'jumpstart',
  900, 150,
  'Parklands Rd, Westlands',
  -1.2633, 36.8035,
  'completed',
  NOW() - INTERVAL '2 hours',
  NOW() - INTERVAL '1 hour 45 minutes'
) ON CONFLICT (id) DO NOTHING;

-- The sequence (job_seq) stays at its default start of 1001, so
-- test-generated jobs will be J1001, J1002 … well below J9001.
