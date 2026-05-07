/**
 * 字段分析服务
 * 用于分析学习空间数据完整性，识别缺失的关键字段
 */

/**
 * 字段定义规则
 */
const FIELD_DEFINITIONS = {
  // 学习目标相关字段
  'goal.examDate': {
    type: 'date',
    label: '考试时间',
    question: '请问你的期末考试是什么时候？这将帮助我制定更合理的学习计划。',
    required: true,
    priority: 1
  },
  'goal.targetScore': {
    type: 'number',
    label: '目标分数',
    question: '你希望在这次考试中达到多少分？',
    placeholder: '请输入目标分数（如：85）',
    required: true,
    priority: 2
  },
  'goal.primaryGoal': {
    type: 'text',
    label: '主要目标',
    question: '请简要描述你的主要学习目标。',
    placeholder: '例如：期末考试获得85分以上',
    required: false,
    priority: 3
  },

  // 学科相关字段
  'subjects': {
    type: 'select',
    label: '考试科目',
    question: '你需要复习哪些科目？',
    options: ['数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治'],
    required: true,
    priority: 1,
    multiple: true
  },
  'subjects[].currentLevel': {
    type: 'number',
    label: '当前水平',
    question: '你在这个科目上的当前水平如何？（0-100分）',
    placeholder: '请输入当前分数',
    required: false,
    priority: 4
  },
  'subjects[].targetLevel': {
    type: 'number',
    label: '目标水平',
    question: '你希望在这个科目上达到什么水平？（0-100分）',
    placeholder: '请输入目标分数',
    required: false,
    priority: 5
  },

  // 时间安排相关字段
  'schedule.availableHoursPerDay': {
    type: 'number',
    label: '每日学习时间',
    question: '你每天能投入多少小时学习？',
    placeholder: '请输入小时数（如：3）',
    required: true,
    priority: 2
  },
  'schedule.availableDays': {
    type: 'select',
    label: '可用日期',
    question: '你每周哪些日期可以学习？',
    options: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
    required: false,
    priority: 6,
    multiple: true
  },
  'schedule.preferredTimeSlots': {
    type: 'select',
    label: '偏好时段',
    question: '你更喜欢在什么时段学习？',
    options: ['早上', '上午', '下午', '晚上', '深夜'],
    required: false,
    priority: 7,
    multiple: true
  }
};

/**
 * 检查字段是否缺失
 * @param {Object} space - 学习空间对象
 * @param {string} fieldPath - 字段路径（如：goal.examDate）
 * @returns {boolean} 是否缺失
 */
function isFieldMissing(space, fieldPath) {
  const parts = fieldPath.split('.');
  let current = space;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    // 处理数组字段（如 subjects[]）
    if (part.endsWith('[]')) {
      const arrayField = part.slice(0, -2);
      current = current[arrayField];
      return !current || !Array.isArray(current) || current.length === 0;
    }

    if (!current || current[part] === undefined || current[part] === null || current[part] === '') {
      return true;
    }

    current = current[part];
  }

  return false;
}

/**
 * 分析学习空间缺失的字段
 * @param {Object} space - 学习空间对象
 * @param {Object} options - 分析选项
 * @returns {Array} 缺失字段列表
 */
export function analyzeMissingFields(space, options = {}) {
  const {
    checkRequiredOnly = false,  // 是否只检查必需字段
    maxFields = 5                // 最多返回多少个缺失字段
  } = options;

  const missingFields = [];

  // 遍历所有字段定义
  for (const [fieldPath, definition] of Object.entries(FIELD_DEFINITIONS)) {
    // 如果只检查必需字段，跳过非必需字段
    if (checkRequiredOnly && !definition.required) {
      continue;
    }

    // 检查字段是否缺失
    if (isFieldMissing(space, fieldPath)) {
      missingFields.push({
        fieldName: fieldPath,
        fieldType: definition.type,
        question: definition.question,
        label: definition.label,
        placeholder: definition.placeholder,
        required: definition.required,
        options: definition.options,
        multiple: definition.multiple,
        priority: definition.priority
      });
    }
  }

  // 按优先级排序
  missingFields.sort((a, b) => a.priority - b.priority);

  // 限制返回数量
  return missingFields.slice(0, maxFields);
}

/**
 * 智能分析：根据用户消息推断需要收集的信息
 * @param {string} userMessage - 用户消息
 * @param {Object} space - 学习空间对象
 * @returns {Object} 分析结果
 */
export function smartAnalyzeFromMessage(userMessage, space) {
  const lowerMessage = userMessage.toLowerCase();
  const missingFields = analyzeMissingFields(space);

  // 根据用户消息内容，调整字段优先级
  const adjustedFields = missingFields.map(field => {
    let adjustedPriority = field.priority;

    // 如果用户提到"考试"，提高考试相关字段的优先级
    if (lowerMessage.includes('考试') || lowerMessage.includes('exam')) {
      if (field.fieldName === 'goal.examDate') {
        adjustedPriority = 1;
      }
      if (field.fieldName === 'subjects') {
        adjustedPriority = 2;
      }
    }

    // 如果用户提到"学习计划"，提高时间安排相关字段的优先级
    if (lowerMessage.includes('学习计划') || lowerMessage.includes('计划')) {
      if (field.fieldName.startsWith('schedule.')) {
        adjustedPriority = Math.max(1, adjustedPriority - 2);
      }
    }

    return { ...field, priority: adjustedPriority };
  });

  // 重新排序
  adjustedFields.sort((a, b) => a.priority - b.priority);

  return {
    missingFields: adjustedFields,
    hasMissingFields: adjustedFields.length > 0,
    suggestedMessage: generateSuggestedMessage(adjustedFields)
  };
}

/**
 * 生成建议的引导消息
 * @param {Array} missingFields - 缺失字段列表
 * @returns {string} 引导消息
 */
function generateSuggestedMessage(missingFields) {
  if (missingFields.length === 0) {
    return '';
  }

  const requiredFields = missingFields.filter(f => f.required);
  const optionalFields = missingFields.filter(f => !f.required);

  let message = '为了制定更好的学习计划，';

  if (requiredFields.length > 0) {
    message += '我需要了解一些关键信息';
    if (optionalFields.length > 0) {
      message += '（另外有些可选信息可以帮助优化计划）';
    }
  } else {
    message += '我想了解一些信息来优化你的学习计划';
  }

  return message;
}

/**
 * 导出字段定义，供外部使用
 */
export { FIELD_DEFINITIONS };
