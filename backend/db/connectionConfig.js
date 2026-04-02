const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const MANAGED_SSL_HOST_MARKERS = [
  'railway',
  'rlwy',
  'render.com',
  'heroku',
  'supabase',
  'neon',
  'amazonaws.com',
];

function parseBoolean(value) {
  if (value == null) return null;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

function resolveSslConfig(connectionString) {
  const explicit = parseBoolean(process.env.DATABASE_SSL);
  if (explicit === true) return { rejectUnauthorized: false };
  if (explicit === false) return false;

  if (!connectionString) {
    return process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false;
  }

  try {
    const parsed = new URL(connectionString);
    const host = (parsed.hostname || '').toLowerCase();
    const sslMode = (parsed.searchParams.get('sslmode') || '').toLowerCase();

    if (['require', 'prefer', 'verify-ca', 'verify-full'].includes(sslMode)) {
      return { rejectUnauthorized: false };
    }

    if (LOCAL_DB_HOSTS.has(host)) {
      return false;
    }

    if (MANAGED_SSL_HOST_MARKERS.some(marker => host.includes(marker))) {
      return { rejectUnauthorized: false };
    }
  } catch {
    // Fall back to env-based defaults when the connection string is not parseable.
  }

  return process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false;
}

module.exports = { resolveSslConfig };
