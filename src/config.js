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

export const config = Object.freeze({
  server: {
    port: optionalEnv('PORT', '3001'),
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
});

export default config;
