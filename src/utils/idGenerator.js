/**
 * ID 生成工具
 */

/**
 * 生成唯一 ID
 * @param {string} prefix - ID 前缀
 * @returns {string} 唯一 ID
 */
export function generateId(prefix = 'id') {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 11);
  return `${prefix}_${timestamp}_${random}`;
}

/**
 * 生成空间 ID
 */
export function generateSpaceId() {
  return generateId('space');
}

/**
 * 生成会话 ID
 */
export function generateSessionId() {
  return generateId('session');
}

/**
 * 生成任务 ID
 */
export function generateTaskId() {
  return generateId('task');
}

export default {
  generateId,
  generateSpaceId,
  generateSessionId,
  generateTaskId
};