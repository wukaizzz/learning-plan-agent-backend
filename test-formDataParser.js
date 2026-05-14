/**
 * 测试表单数据解析工具
 */

import { parseFormData, mergeFormDataToState, extractFormData, validateFormData } from './src/utils/formDataParser.js';
import { createInitialState } from './src/types/workflowState.js';

console.log('🧪 开始测试表单数据解析...\n');

// 测试 1: 解析扁平化的表单数据
console.log('📋 测试 1: 解析扁平化的表单数据');
const flatFormData = {
  'goal.examDate': '2024-06-20',
  'goal.targetScore': 85,
  'subjects': ['数学', '英语'],  // 注意：这只是数组，需要转换为科目对象
  'availability.dailyHours': 2,
  'availability.examDistance': 30
};

// 手动创建科目对象（模拟表单提交后的处理）
const subjectObjects = flatFormData.subjects.map(name => ({
  id: `subject_${name}`,
  name,
  currentLevel:5,
  targetLevel: 8,
  priority: 'high'
}));

const parsedData = parseFormData(flatFormData);
console.log('输入:', JSON.stringify(flatFormData, null, 2));
console.log('输出:', JSON.stringify(parsedData, null, 2));
console.log('✅ 解析成功！\n');

// 测试 2: 合并到初始状态
console.log('📋 测试 2: 合并表单数据到初始状态');
const initialState = createInitialState('test_space', 'test_user');

// 修改表单数据，包含科目对象
const formDataWithSubjects = {
  'goal.examDate': '2024-06-20',
  'goal.targetScore': 85,
  'subjects': subjectObjects,  // 使用科目对象数组
  'availability.dailyHours': 2,
  'availability.examDistance': 30
};

const mergedState = mergeFormDataToState(initialState, formDataWithSubjects);
console.log('初始 state.goal:', JSON.stringify(initialState.goal, null, 2));
console.log('合并后 state.goal:', JSON.stringify(mergedState.goal, null, 2));
console.log('✅ 合并成功！\n');

// 测试 3: 验证数据结构
console.log('📋 测试 3: 验证数据结构');
console.log('检查 mergedState.goal.examDate:', mergedState.goal.examDate);
console.log('检查 mergedState.goal.targetScore:', mergedState.goal.targetScore);
console.log('检查 mergedState.subjects:', mergedState.subjects);
console.log('检查 mergedState.availability.dailyHours:', mergedState.availability.dailyHours);

if (
  mergedState.goal.examDate === '2024-06-20' &&
  mergedState.goal.targetScore === 85 &&
  mergedState.subjects.length === 2 &&
  mergedState.availability.dailyHours === 2
) {
  console.log('✅ 所有字段正确！\n');
} else {
  console.log('❌ 字段验证失败！\n');
}

// 测试 4: 提取表单数据
console.log('📋 测试 4: 从状态提取表单数据');
const extractedFormData = extractFormData(mergedState);
console.log('提取结果:', JSON.stringify(extractedFormData, null, 2));

if (
  extractedFormData['goal.examDate'] === '2024-06-20' &&
  extractedFormData['goal.targetScore'] === 85
) {
  console.log('✅ 提取成功！\n');
} else {
  console.log('❌ 提取失败！\n');
}

// 测试 5: 验证必需字段
console.log('📋 测试 5: 验证必需字段');
const requiredFields = ['goal.examDate', 'goal.targetScore', 'subjects', 'availability.dailyHours'];
const validationResult = validateFormData(extractedFormData, requiredFields);
console.log('验证结果:', validationResult);

if (validationResult.valid) {
  console.log('✅ 所有必需字段都存在！\n');
} else {
  console.log('❌ 缺少字段:', validationResult.missing);
}

// 测试 6: 模拟 analyzeStudyRequirements 访问数据
console.log('📋 测试 6: 模拟 analyzeStudyRequirements 访问数据');
const { goal, subjects, availability } = mergedState;

console.log('模拟 AI 分析提示词:');
const prompt = `
学习目标：${goal.primaryGoal}
考试日期：${goal.examDate || '未设置'}
目标分数：${goal.targetScore || '未设置'}
距离考试：${availability.examDistance} 天
每日可用时间：${availability.dailyHours} 小时

科目信息：
${subjects.map(s => `- ${s.name}：当前水平 ${s.currentLevel}/10，目标水平 ${s.targetLevel}/10`).join('\n')}
`;

console.log(prompt);

if (goal.examDate && goal.targetScore && subjects.length > 0) {
  console.log('✅ AI 能够访问到所有必要数据！\n');
} else {
  console.log('❌ AI 无法访问到部分数据！\n');
}

console.log('🎉 所有测试完成！');
