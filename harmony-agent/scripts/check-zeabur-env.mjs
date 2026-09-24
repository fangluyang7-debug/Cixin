import { existsSync } from 'node:fs';

const required = ['JWT_SECRET', 'MAINTENANCE_API_TOKEN'];
const errors = [];
const databaseUrl = process.env.DATABASE_URL?.trim() ?? '';

if (process.env.NODE_ENV !== 'production') errors.push('NODE_ENV must be production');
if (process.env.ALLOW_MOCK_PROVIDERS !== 'false') errors.push('ALLOW_MOCK_PROVIDERS must be false');
if (process.env.OBJECT_STORAGE_PROVIDER !== 'tencent_cos') {
  errors.push('OBJECT_STORAGE_PROVIDER must be tencent_cos');
}
if (!/^file:\/data\/[A-Za-z0-9][A-Za-z0-9._-]*\.(?:db|sqlite|sqlite3)$/.test(databaseUrl) ||
    databaseUrl.includes('..')) {
  errors.push('DATABASE_URL must be a SQLite file inside /data');
}
if (!existsSync('/data')) errors.push('persistent /data mount path is absent');
for (const key of required) {
  const value = process.env[key]?.trim() ?? '';
  if (!value || /^replace[-_ ]|^your[-_ ]/i.test(value)) errors.push(`${key} is missing`);
}

if (errors.length > 0) {
  for (const error of errors) console.error(`Zeabur preflight: ${error}`);
  process.exit(1);
}
console.log('Zeabur preflight passed: persistent database path and security configuration are present. Check /api/v1/health/readiness for COS configuration.');
