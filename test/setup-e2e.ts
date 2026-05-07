import { execSync } from 'child_process';
import { Client } from 'pg';

export default async (): Promise<void> => {
  const connectionString =
    process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      'TEST_DATABASE_URL or DATABASE_URL must be set for e2e tests',
    );
  }

  const client = new Client({ connectionString });

  try {
    await client.connect();
    await client.query('CREATE EXTENSION IF NOT EXISTS btree_gist;');
  } catch (error) {
    console.error(
      'Failed to enable btree_gist extension in test database:',
      error,
    );
    throw error;
  } finally {
    await client.end();
  }

  execSync('pnpm exec prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: connectionString },
  });
};
