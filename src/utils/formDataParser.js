/**
 * 表单数据解析工具
 * 将扁平化的表单数据转换为嵌套的状态结构
 */

/**
 * 解析表单数据
 * 将扁平化的表单数据（如 { 'goal.examDate': '2024-06-20' }）转换为嵌套结构
 *
 * @param {Object} formData - 扁平化的表单数据
 * @returns {Object} 嵌套的状态对象
 *
 * @example
 * 输入: { 'goal.examDate': '2024-06-20', 'goal.targetScore': 85 }
 * 输出: { goal: { examDate: '2024-06-20', targetScore: 85 } }
 */
export function parseFormData(formData) {
  const result = {};

  for (const key in formData) {
    if (formData.hasOwnProperty(key)) {
      const keys = key.split('.');
      let current = result;

      // 遍历路径，构建嵌套对象
      for (let i = 0; i < keys.length - 1; i++) {
        if (!current[keys[i]]) {
          current[keys[i]] = {};
        }
        current = current[keys[i]];
      }

      // 设置最终值
      current[keys[keys.length - 1]] = formData[key];
    }
  }

  return result;
}

/**
 * 合并表单数据到状态
 * 深度合并表单数据和现有状态
 *
 * @param {Object} state - 当前状态
 * @param {Object} formData - 扁平化的表单数据
 * @returns {Object} 合并后的状态
 *
 * @example
 * state = { goal: { primaryGoal: '期末考试' } }
 * formData = { 'goal.examDate': '2024-06-20' }
 * 输出: {
 *   goal: { primaryGoal: '期末考试', examDate: '2024-06-20' }
 * }
 */
export function mergeFormDataToState(state, formData) {
  const parsedData = parseFormData(formData);

  // 深度合并目标信息
  const mergedGoal = {
    ...state.goal,
    ...parsedData.goal
  };

  // 处理科目信息（如果是数组）
  const mergedSubjects = parsedData.subjects !== undefined
    ? parsedData.subjects
    : state.subjects;

  // 深度合并可用性信息
  const mergedAvailability = {
    ...state.availability,
    ...parsedData.availability
  };

  // 返回合并后的状态
  return {
    ...state,
    goal: mergedGoal,
    subjects: mergedSubjects,
    availability: mergedAvailability
  };
}

/**
 * 从状态中提取表单字段
 * 将嵌套状态转换为扁平化的表单数据
 *
 * @param {Object} state - 当前状态
 * @returns {Object} 扁平化的表单数据
 *
 * @example
 * 输入: { goal: { examDate: '2024-06-20', targetScore: 85 } }
 * 输出: { 'goal.examDate': '2024-06-20', 'goal.targetScore': 85 }
 */
export function extractFormData(state) {
  const result = {};

  function flatten(obj, prefix = '') {
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const value = obj[key];
        const newKey = prefix ? `${prefix}.${key}` : key;

        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          flatten(value, newKey);
        } else {
          result[newKey] = value;
        }
      }
    }
  }

  flatten(state);
  return result;
}

/**
 * 验证表单数据
 * 检查必需字段是否存在
 *
 * @param {Object} formData - 表单数据
 * @param {string[]} requiredFields - 必需字段列表
 * @returns {Object} { valid: boolean, missing: string[] }
 */
export function validateFormData(formData, requiredFields) {
  const missing = [];

  for (const field of requiredFields) {
    if (formData[field] === undefined || formData[field] === null || formData[field] === '') {
      missing.push(field);
    }
  }

  return {
    valid: missing.length === 0,
    missing
  };
}

export default {
  parseFormData,
  mergeFormDataToState,
  extractFormData,
  validateFormData
};
