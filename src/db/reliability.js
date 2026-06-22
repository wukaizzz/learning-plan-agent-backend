import { logger } from '../logger/index.js';

const TRANSIENT_ERROR_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ECONNREFUSED',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EAI_AGAIN',
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08007',
  '08P01',
  '57P01',
  '57P02',
  '57P03',
]);

const TRANSIENT_MESSAGE_PARTS = [
  'connection terminated',
  'connection timeout',
  'connection reset',
  'socket hang up',
  'read econnreset',
];

function getErrorChain(error) {
  const chain = [];
  const seen = new Set();
  let current = error;

  while (current && typeof current === 'object' && !seen.has(current)) {
    chain.push(current);
    seen.add(current);
    current = current.cause;
  }

  return chain;
}

export function isTransientDatabaseError(error) {
  return getErrorChain(error).some(candidate => {
    const code = String(candidate.code || candidate.errno || '').toUpperCase();
    if (TRANSIENT_ERROR_CODES.has(code) || code.startsWith('08')) {
      return true;
    }

    const message = String(candidate.message || '').toLowerCase();
    return TRANSIENT_MESSAGE_PARTS.some(part => message.includes(part));
  });
}

function wait(delayMs) {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, delayMs));
}

export async function retryTransientDatabaseOperation(
  operation,
  {
    retries = 1,
    delayMs = 300,
    onRetry,
  } = {}
) {
  let attempt = 0;

  while (true) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= retries || !isTransientDatabaseError(error)) {
        throw error;
      }

      attempt += 1;
      onRetry?.(error, attempt);
      await wait(delayMs);
    }
  }
}

export async function safeRollback(client, originalError) {
  let destroyClient = isTransientDatabaseError(originalError);

  try {
    await client.query('ROLLBACK');
  } catch (rollbackError) {
    destroyClient = true;
    logger.warn({
      originalCode: originalError?.code,
      originalError: originalError?.message,
      rollbackCode: rollbackError?.code,
      rollbackError: rollbackError?.message,
    }, 'PostgreSQL rollback failed; discarding client');
  }

  return destroyClient;
}

