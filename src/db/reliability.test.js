import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isTransientDatabaseError,
  retryTransientDatabaseOperation,
  safeRollback,
} from './reliability.js';

test('classifies network and PostgreSQL connection errors as transient', () => {
  assert.equal(isTransientDatabaseError({ code: 'ECONNRESET' }), true);
  assert.equal(isTransientDatabaseError({ code: '08006' }), true);
  assert.equal(isTransientDatabaseError({ code: '57P01' }), true);
  assert.equal(isTransientDatabaseError({
    message: 'outer error',
    cause: new Error('Connection terminated unexpectedly'),
  }), true);
});

test('does not classify validation and constraint errors as transient', () => {
  assert.equal(isTransientDatabaseError({ code: '23505' }), false);
  assert.equal(isTransientDatabaseError(new Error('Task not found')), false);
});

test('retries one transient failure and returns the second result', async () => {
  let attempts = 0;
  const retriedAttempts = [];
  const result = await retryTransientDatabaseOperation(
    async () => {
      attempts += 1;
      if (attempts === 1) {
        throw Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
      }
      return 'ok';
    },
    {
      retries: 1,
      delayMs: 0,
      onRetry: (_error, attempt) => retriedAttempts.push(attempt),
    }
  );

  assert.equal(result, 'ok');
  assert.equal(attempts, 2);
  assert.deepEqual(retriedAttempts, [1]);
});

test('does not retry a non-transient database error', async () => {
  let attempts = 0;
  const error = Object.assign(new Error('duplicate key'), { code: '23505' });

  await assert.rejects(
    retryTransientDatabaseOperation(
      async () => {
        attempts += 1;
        throw error;
      },
      { retries: 1, delayMs: 0 }
    ),
    candidate => candidate === error
  );

  assert.equal(attempts, 1);
});

test('stops after the configured transient retry limit', async () => {
  let attempts = 0;
  const error = Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });

  await assert.rejects(
    retryTransientDatabaseOperation(
      async () => {
        attempts += 1;
        throw error;
      },
      { retries: 1, delayMs: 0 }
    ),
    candidate => candidate === error
  );

  assert.equal(attempts, 2);
});

test('safeRollback destroys clients for connection errors', async () => {
  const queries = [];
  const client = {
    query: async sql => {
      queries.push(sql);
    },
  };

  const destroyClient = await safeRollback(
    client,
    Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })
  );

  assert.deepEqual(queries, ['ROLLBACK']);
  assert.equal(destroyClient, true);
});

test('safeRollback preserves a healthy client after a normal error', async () => {
  const client = {
    query: async () => {},
  };

  const destroyClient = await safeRollback(
    client,
    Object.assign(new Error('constraint failure'), { code: '23505' })
  );

  assert.equal(destroyClient, false);
});

test('safeRollback does not replace the original error when rollback fails', async () => {
  const client = {
    query: async () => {
      throw new Error('rollback connection lost');
    },
  };

  const destroyClient = await safeRollback(
    client,
    Object.assign(new Error('original failure'), { code: '23505' })
  );

  assert.equal(destroyClient, true);
});
