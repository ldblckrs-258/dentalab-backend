// Always point the app under test at the dedicated test database, even when
// TEST_DATABASE_URL is not exported (e.g. a bare `pnpm run test:e2e`). Without
// this the app would fall back to .env's DATABASE_URL (the main dev DB), whose
// seed data differs from what globalSetup prepares — causing auth/login 401s.
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://dentalab:dentalab_secret@localhost:5480/dentalab_test?schema=public';
process.env.TEST_DATABASE_URL = TEST_DATABASE_URL;
process.env.DATABASE_URL = TEST_DATABASE_URL;
if (!process.env.NODE_ENV || process.env.NODE_ENV === 'test') {
  process.env.NODE_ENV = 'development';
}
process.env.DISABLE_RATE_LIMIT = 'true';
// Never hit the real Resend API from tests — it burns email quota.
process.env.EMAIL_ENABLED = 'false';
