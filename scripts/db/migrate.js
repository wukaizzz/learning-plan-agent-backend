import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from '../../src/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '../..');
const migrationsDir = path.join(backendRoot, 'src/db/migrations');
const srcDir = path.join(backendRoot, 'src');
const legacyTablePattern = /\b(users|threads|study_plans)\b/;
const ignoredScanDirs = new Set(['migrations']);
const migrationDatabaseUrl = process.env.MIGRATION_DATABASE_URL || config.database.url;
const { Pool } = pg;

function createSslConfig() {
  if (!config.database.ssl) {
    return false;
  }

  return {
    rejectUnauthorized: config.database.sslRejectUnauthorized,
  };
}

function createMigrationPool() {
  if (!migrationDatabaseUrl) {
    throw new Error('Set MIGRATION_DATABASE_URL or DATABASE_URL before running migrations.');
  }

  return new Pool({
    connectionString: migrationDatabaseUrl,
    max: 1,
    idleTimeoutMillis: config.database.idleTimeoutMillis,
    connectionTimeoutMillis: config.database.connectionTimeoutMillis,
    ssl: createSslConfig(),
  });
}

async function listFilesRecursive(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (ignoredScanDirs.has(entry.name)) {
        continue;
      }
      files.push(...await listFilesRecursive(fullPath));
      continue;
    }

    if (entry.isFile() && /\.(js|ts|mjs|cjs)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

async function assertNoLegacySourceReferences() {
  const files = await listFilesRecursive(srcDir);
  const matches = [];

  for (const file of files) {
    const content = await fs.readFile(file, 'utf8');
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (legacyTablePattern.test(line)) {
        matches.push(`${path.relative(backendRoot, file)}:${index + 1}: ${line.trim()}`);
      }
    });
  }

  if (matches.length > 0) {
    throw new Error([
      'Legacy table references found outside migrations. Review before dropping test tables.',
      ...matches
    ].join('\n'));
  }
}

async function tableExists(client, tableName) {
  const result = await client.query('SELECT to_regclass($1) AS table_name', [`public.${tableName}`]);
  return result.rows[0].table_name !== null;
}

async function getTableCount(client, tableName) {
  if (!await tableExists(client, tableName)) {
    return null;
  }

  const result = await client.query(`SELECT count(*)::INTEGER AS count FROM public.${tableName}`);
  return result.rows[0].count;
}

async function getLegacyUserIds(client) {
  if (!await tableExists(client, 'users')) {
    return [];
  }

  const result = await client.query('SELECT id FROM public.users ORDER BY id LIMIT 10');
  return result.rows.map(row => row.id);
}

async function assertLegacyDropIsSafe(client) {
  await assertNoLegacySourceReferences();

  const counts = {
    users: await getTableCount(client, 'users'),
    threads: await getTableCount(client, 'threads'),
    study_plans: await getTableCount(client, 'study_plans'),
  };

  console.log('Legacy table counts before drop:', counts);

  const userIds = await getLegacyUserIds(client);
  const usersSafe = counts.users === null || counts.users === 0 ||
    (counts.users === 1 && userIds[0] === 'default-user');
  const threadsSafe = counts.threads === null || counts.threads === 0;
  const studyPlansSafe = counts.study_plans === null || counts.study_plans === 0;

  if (!usersSafe || !threadsSafe || !studyPlansSafe) {
    throw new Error([
      'Refusing to drop legacy tables because they do not look like test-only data.',
      `users=${counts.users}, userIds=${JSON.stringify(userIds)}`,
      `threads=${counts.threads}`,
      `study_plans=${counts.study_plans}`
    ].join('\n'));
  }
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      filename TEXT PRIMARY KEY,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await client.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'study_agent_dev') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.schema_migrations TO study_agent_dev;
      END IF;

      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'study_agent_user') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.schema_migrations TO study_agent_user;
      END IF;

      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'study_agent_readonly') THEN
        GRANT SELECT ON TABLE public.schema_migrations TO study_agent_readonly;
      END IF;
    END $$;
  `);
}

async function getAppliedMigrations(client) {
  const result = await client.query('SELECT filename FROM public.schema_migrations');
  return new Set(result.rows.map(row => row.filename));
}

async function main() {
  const pool = createMigrationPool();
  const setupClient = await pool.connect();

  try {
    await ensureMigrationsTable(setupClient);
    const applied = await getAppliedMigrations(setupClient);
    const files = (await fs.readdir(migrationsDir))
      .filter(file => file.endsWith('.sql'))
      .sort();

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`Skipping ${file}`);
        continue;
      }

      if (file === '001_drop_test_phase1_tables.sql') {
        await assertLegacyDropIsSafe(setupClient);
      }

      const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');

      try {
        await setupClient.query('BEGIN');
        await setupClient.query(sql);
        await setupClient.query(
          'INSERT INTO public.schema_migrations (filename) VALUES ($1)',
          [file]
        );
        await setupClient.query('COMMIT');
        console.log(`Applied ${file}`);
      } catch (error) {
        await setupClient.query('ROLLBACK');
        throw error;
      }
    }

    console.log('Migrations complete');
  } finally {
    setupClient.release();
    await pool.end();
  }
}

main().catch(error => {
  console.error('Migration failed');
  console.error(error.message);
  process.exitCode = 1;
});
