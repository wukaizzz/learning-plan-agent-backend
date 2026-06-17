import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

let pool;

function createSslConfig() {
  if (!config.database.ssl) {
    return false;
  }

  return {
    rejectUnauthorized: config.database.sslRejectUnauthorized,
  };
}

export function getDatabasePool() {
  if (!config.database.enabled) {
    throw new Error('Database is not configured. Set DATABASE_URL in .env.');
  }

  if (!pool) {
    pool = new Pool({
      connectionString: config.database.url,
      max: config.database.poolMax,
      idleTimeoutMillis: config.database.idleTimeoutMillis,
      connectionTimeoutMillis: config.database.connectionTimeoutMillis,
      ssl: createSslConfig(),
    });

    pool.on('error', (error) => {
      console.error('Unexpected PostgreSQL pool error:', error);
    });
  }

  return pool;
}

export async function query(sql, params = []) {
  return getDatabasePool().query(sql, params);
}

export async function checkDatabaseConnection() {
  const result = await query(`
    SELECT
      current_user,
      current_database(),
      current_setting('transaction_read_only') AS transaction_read_only
  `);

  return result.rows[0];
}

export async function closeDatabasePool() {
  if (!pool) {
    return;
  }

  await pool.end();
  pool = null;
}

export default {
  getDatabasePool,
  query,
  checkDatabaseConnection,
  closeDatabasePool,
};
