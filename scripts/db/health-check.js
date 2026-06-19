import { query, closeDatabasePool } from '../../src/db/pool.js';

try {
  const nowResult = await query('SELECT now() AS now');
  const databaseResult = await query('SELECT current_database() AS current_database');

  console.log('PostgreSQL connection ok');
  console.log(`now: ${nowResult.rows[0].now.toISOString()}`);
  console.log(`database: ${databaseResult.rows[0].current_database}`);
} catch (error) {
  console.error('PostgreSQL health check failed');
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await closeDatabasePool();
}
