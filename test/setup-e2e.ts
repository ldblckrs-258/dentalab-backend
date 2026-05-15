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

  const client2 = new Client({ connectionString });
  try {
    await client2.connect();
    await client2.query(`
      DELETE FROM appointments
      WHERE provider_id = 'b2c3d4e5-f6a7-4890-bcde-f12345678901';
    `);

    await client2.query(`
      INSERT INTO users (id, email, password_hash, full_name, is_active, created_at, updated_at)
      VALUES (
        'a1b2c3d4-e5f6-4789-abcd-ef1234567890',
        'e2e-doctor@dentalab.com',
        '$2b$10$YvH9o5UNbLDdUyaLRvmMy.W3Z0yLkTIL2VX/oiQjqkb4SV0c5OPRS',
        'E2E Doctor',
        true,
        NOW(),
        NOW()
      )
      ON CONFLICT (id) DO NOTHING;
    `);
    await client2.query(`
      INSERT INTO providers (id, user_id, specialty, license_number, is_active, created_at, updated_at)
      VALUES (
        'b2c3d4e5-f6a7-4890-bcde-f12345678901',
        'a1b2c3d4-e5f6-4789-abcd-ef1234567890',
        'General Dentistry',
        'E2E-LIC-001',
        true,
        NOW(),
        NOW()
      )
      ON CONFLICT (id) DO NOTHING;
    `);
  } catch (error) {
    console.error('Failed to seed e2e provider fixture:', error);
    throw error;
  } finally {
    await client2.end();
  }
};
