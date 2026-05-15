if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
if (!process.env.NODE_ENV || process.env.NODE_ENV === 'test') {
  process.env.NODE_ENV = 'development';
}
