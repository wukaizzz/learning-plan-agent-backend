/**
 * 集中配置模块
 * 所有环境变量在此读取、校验、导出
 * 其他文件不再直接访问 process.env
 *
 * 加载策略：
 * 1. 启动脚本 `node --import dotenv/config` 先于所有模块加载 .env
 * 2. 本文件 `import 'dotenv/config'` 作为兜底保障
 * 3. requireEnv() 在启动阶段即抛错，不会等到运行时才发现缺失
 */

import 'dotenv/config';

function requireEnv(key) {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}. Please set it in .env file.`);
  }
  return value;
}

function optionalEnv(key, defaultValue = '') {
  return process.env[key] || defaultValue;
}

function optionalIntEnv(key, defaultValue) {
  const value = process.env[key];
  if (!value) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid integer environment variable: ${key}.`);
  }

  return parsed;
}

function optionalBoolEnv(key, defaultValue = false) {
  const value = process.env[key];
  if (!value) {
    return defaultValue;
  }

  return value === 'true' || value === '1';
}

const databaseUrl = optionalEnv('DATABASE_URL');
const checkpointerBackend = optionalEnv('CHECKPOINTER_BACKEND', 'auto');

if (!['auto', 'memory', 'postgres'].includes(checkpointerBackend)) {
  throw new Error('CHECKPOINTER_BACKEND must be one of: auto, memory, postgres.');
}

const checkpointerSchema = optionalEnv('CHECKPOINTER_SCHEMA', 'langgraph');
if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(checkpointerSchema)) {
  throw new Error('CHECKPOINTER_SCHEMA must be a valid PostgreSQL identifier.');
}

export const config = Object.freeze({
  server: {
    port: optionalEnv('PORT', '3001'),
  },
  database: {
    enabled: !!databaseUrl,
    url: databaseUrl,
    ssl: optionalBoolEnv('DATABASE_SSL', false),
    sslRejectUnauthorized: optionalBoolEnv('DATABASE_SSL_REJECT_UNAUTHORIZED', true),
    poolMax: optionalIntEnv('DATABASE_POOL_MAX', 3),
    idleTimeoutMillis: optionalIntEnv('DATABASE_IDLE_TIMEOUT_MS', 30000),
    connectionTimeoutMillis: optionalIntEnv('DATABASE_CONNECTION_TIMEOUT_MS', 5000),
  },
  checkpointer: {
    backend: checkpointerBackend,
    schema: checkpointerSchema,
  },
  app: {
    defaultDevUserId: optionalEnv('DEFAULT_DEV_USER_ID', 'default-user'),
  },
  deepseek: {
    apiKey: requireEnv('DEEPSEEK_API_KEY'),
    baseUrl: optionalEnv('DEEPSEEK_API_URL', 'https://api.deepseek.com')
      .replace('/chat/completions', ''),
  },
  ark: {
    apiKey: optionalEnv('ARK_API_KEY'),
    baseUrl: optionalEnv('ARK_API_URL', 'https://ark.cn-beijing.volces.com/api/v3/chat/completions'),
    model: optionalEnv('ARK_MODEL', 'doubao-seed-2-0-lite-260215'),
  },
  mimo: {
    apiKey: optionalEnv('MIMO_API_KEY'),
    baseUrl: optionalEnv('MIMO_API_URL', 'https://token-plan-cn.xiaomimimo.com/v1'),
    model: optionalEnv('MIMO_MODEL', 'mimo-v2.5-pro'),
  },
});

export default config;
