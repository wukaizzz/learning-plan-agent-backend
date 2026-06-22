/**
 * 首次计划生成工作流
 * LangGraph 工作流实现 - 用于首次创建学习计划
 *
 * 改造要点:
 * 1. invoke → stream，支持逐节点推送 SSE
 * 2. 节点签名 (state, config)，通过 config.configurable.onEvent 推送中间事件
 * 3. analyze_requirements 使用 R1 推理模型（reasoning_content → thinking 事件）
 * 4. generate_plan 使用 V3 对话模型（withStructuredOutput + 确定性调度）
 */

import { StateGraph, END, Annotation } from '@langchain/langgraph';
import { checkpointer } from '../utils/checkpointer.js';
import { createInitialState } from '../types/workflowState.js';
import { streamReasoner, streamChat, structuredOutput, streamChatWithThinking } from '../services/llmService.js';
import { RiskAssessmentSchema, TaskFrameworkSchema } from '../types/llmSchemas.js';
import { logger } from '../logger/index.js';
import { deterministicallyScheduleTasks } from '../services/studyScheduler.js';
import { buildPlanBlocks } from '../services/planBlockBuilder.js';
import {
  buildFinalizedCheckpointUpdate,
  hydrateFinalizedWorkflowState,
  persistFinalizedWorkflowPlan,
} from '../services/workflowPlanPersistence.js';

const StateAnnotation = Annotation.Root({
  studySpaceId: Annotation(),
  userId: Annotation(),
  goal: Annotation(),
  subjects: Annotation(),
  availability: Annotation(),
  currentPlan: Annotation(),
  tasksSnapshot: Annotation(),
  progress: Annotation(),
  riskAssessment: Annotation(),
  workflow: Annotation(),
  uiBlocks: Annotation(),
  interruption: Annotation(),
  metadata: Annotation()
});

function getOnEvent(config) {
  return config?.configurable?.onEvent || (() => {});
}

function getExecutionId(config) {
  return config?.configurable?.executionId;
}

function emitAgentStep(config, { stepId, status, title, summary, description, metadata }) {
  const onEvent = getOnEvent(config);
  const executionId = getExecutionId(config);
  if (!executionId) return;
  onEvent({
    type: 'agent_step_update',
    executionId,
    stepId,
    status,
    ...(title ? { title } : {}),
    ...(summary ? { summary } : {}),
    ...(description ? { description } : {}),
    ...(metadata ? { metadata } : {})
  });
}

// ============================================================
// 节点函数实现
// ============================================================

async function loadSpaceContext(state, config) {
  const onEvent = getOnEvent(config);
  logger.info({ spaceId: state.studySpaceId, step: 'load_space_context' }, 'Load space context');

  onEvent({ type: 'workflow_step', step: 'collecting', progress: 10 });
  emitAgentStep(config, { stepId: 'load_space_context', status: 'running', title: '读取学习空间上下文' });

  const loadedData = {
    goal: {
      ...state.goal,
      primaryGoal: state.goal.primaryGoal || '准备期末考试'
    },
    subjects: state.subjects.length > 0 ? state.subjects : [
      {
        id: 'math',
        name: '高等数学',
        currentLevel: 6,
        targetLevel: 8,
        priority: 'high'
      }
    ],
    availability: {
      ...state.availability,
      dailyHours: state.availability.dailyHours || 2,
      examDistance: state.availability.examDistance || 30
    }
  };

  const goalText = loadedData.goal.primaryGoal;
  const subjectCount = loadedData.subjects.length;
  const dailyHours = loadedData.availability.dailyHours;
  emitAgentStep(config, {
    stepId: 'load_space_context',
    status: 'completed',
    summary: `目标「${goalText}」，${subjectCount} 个科目，每日可用 ${dailyHours} 小时`
  });

  return {
    ...loadedData,
    workflow: {
      ...state.workflow,
      stage: 'collecting_info',
      currentNode: 'load_space_context',
      history: [{ node: 'load_space_context', timestamp: Date.now(), duration: 100 }]
    },
    metadata: {
      ...state.metadata,
      updatedAt: Date.now(),
      lastActivityAt: Date.now()
    }
  };
}

async function collectMissingInfo(state, config) {
  const onEvent = getOnEvent(config);
  logger.info({ step: 'collect_missing_info' }, 'Check missing info');

  emitAgentStep(config, { stepId: 'collect_missing_info', status: 'running', title: '检查计划所需信息' });

  const missingFields = [];

  if (!state.goal.examDate) {
    missingFields.push({
      name: 'goal.examDate',
      label: '考试日期',
      type: 'date',
      question: '请问你的期末考试是什么时候？',
      required: true,
      placeholder: '选择考试日期'
    });
  }

  if (!state.goal.targetScore) {
    missingFields.push({
      name: 'goal.targetScore',
      label: '目标分数',
      type: 'number',
      question: '你的目标分数是多少？',
      required: true,
      placeholder: '例如：85'
    });
  }

  if (!state.subjects || state.subjects.length === 0) {
    missingFields.push({
      name: 'subjects',
      label: '考试科目',
      type: 'select',
      question: '你需要复习哪些科目？',
      required: true,
      options: ['数学', '英语', '物理', '化学', '生物', '政治', '历史'],
      placeholder: '选择科目'
    });
  }

  if (!state.availability.dailyHours || state.availability.dailyHours < 1) {
    missingFields.push({
      name: 'availability.dailyHours',
      label: '每日学习时间（小时）',
      type: 'number',
      question: '你每天能投入多少小时学习？',
      required: true,
      placeholder: '例如：2'
    });
  }

  if (missingFields.length > 0) {
    logger.info({ step: 'collect_missing_info', missingCount: missingFields.length, action: 'interrupt' }, 'Missing fields found, triggering interrupt');

    const formattedFields = missingFields.map(field => ({
      name: field.name,
      label: field.label,
      type: field.type,
      placeholder: field.placeholder,
      required: field.required,
      options: field.options,
      question: undefined
    }));

    const collectionFormBlock = {
      id: `info_collection_${Date.now()}`,
      type: 'collection-form',
      title: '完善学习信息',
      order: 1,
      props: {
        stage: 'initial',
        fields: formattedFields,
        description: '为了制定更好的学习计划，请完善以下信息'
      }
    };

    onEvent({ type: 'ui_block_update', action: 'add', block: collectionFormBlock });
    onEvent({ type: 'info_needed', question: missingFields[0].question, field: missingFields[0].name, fieldType: missingFields[0].type, options: missingFields[0].options });
    emitAgentStep(config, {
      stepId: 'collect_missing_info',
      status: 'waiting_input',
      summary: `需补充：${missingFields.map(f => f.label).join('、')}`
    });

    return {
      workflow: {
        ...state.workflow,
        stage: 'paused',
        currentNode: 'collect_missing_info'
      },
      interruption: {
        isInterrupted: true,
        reason: '等待用户补充必需信息',
        waitingFor: {
          field: missingFields[0].name,
          question: missingFields[0].question,
          type: missingFields[0].type,
          options: missingFields[0].options
        }
      },
      uiBlocks: [collectionFormBlock],
      metadata: {
        ...state.metadata,
        updatedAt: Date.now()
      }
    };
  }

  logger.info({ step: 'collect_missing_info', action: 'continue' }, 'Info complete, continuing');
  emitAgentStep(config, { stepId: 'collect_missing_info', status: 'completed', summary: '所有必要信息已齐全，继续分析' });
  return {
    workflow: {
      ...state.workflow,
      stage: 'analyzing',
      currentNode: 'collect_missing_info',
      history: [{ node: 'collect_missing_info', timestamp: Date.now(), duration: 50 }]
    },
    metadata: {
      ...state.metadata,
      updatedAt: Date.now(),
      lastActivityAt: Date.now()
    }
  };
}

async function analyzeStudyRequirements(state, config) {
  const onEvent = getOnEvent(config);
  logger.info({ step: 'analyze_requirements' }, 'AI analyzing study requirements');

  const { goal, subjects, availability } = state;

  onEvent({ type: 'workflow_step', step: 'analyzing', progress: 40 });
  emitAgentStep(config, { stepId: 'analyze_requirements', status: 'running', title: '分析学习需求' });

  const analysisPrompt = `你是一位专业的学习规划分析师。请深入分析以下学生的学习情况：

学习目标：${goal.primaryGoal || '未知'}
考试日期：${goal.examDate || '未设置'}
目标分数：${goal.targetScore || '未设置'}
距离考试：${availability.examDistance} 天
每日可用时间：${availability.dailyHours} 小时

科目信息：
${subjects.length > 0
    ? subjects.map(s => `- ${s.name}：当前水平 ${s.currentLevel}/10，目标水平 ${s.targetLevel}/10，优先级 ${s.priority}`).join('\n')
    : '无科目信息'
  }

请分析：
1. 时间是否充足（计算所需总学习时间 vs 可用时间）
2. 各科目的优先级排序及理由
3. 学习策略建议（重点突破哪些科目，时间如何分配）
4. 潜在风险及应对措施`;

  let analysisSource = analysisPrompt;
  const startTime = Date.now();

  try {
    const { thinkingText, contentText } = await streamReasoner(analysisPrompt, {
      onThinking: (token) => {
        onEvent({ type: 'thinking', content: token });
      }
    });

    analysisSource = contentText || thinkingText || analysisPrompt;
    const thinkingDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info({ step: 'analyze_requirements', thinkingDuration, contentLength: contentText.length, model: 'deepseek-r1' }, 'R1 thinking completed');
  } catch (error) {
    logger.warn({
      step: 'analyze_requirements',
      err: error.message
    }, 'R1 analysis failed, continuing with raw study data');
  } finally {
    const thinkingDuration = (Date.now() - startTime) / 1000;
    onEvent({ type: 'thinking_end', duration: thinkingDuration });
  }

  onEvent({ type: 'workflow_step', step: 'analyzing', progress: 60 });

  const structuredPrompt = `基于以下分析，输出结构化 JSON：

分析内容：
${analysisSource}

请严格按照以下 JSON 格式输出：
{
  "level": "low" | "medium" | "high" | "critical",
  "factors": [{ "type": "time_pressure" | "low_accuracy" | "falling_behind" | "resource_overload", "description": "描述", "severity": 1-10 }],
  "prediction": "风险预测文本",
  "suggestedActions": ["建议1", "建议2"],
  "timeAssessment": "sufficient" | "tight" | "insufficient",
  "subjectPriorities": [{ "subjectName": "科目名", "priorityLevel": "high" | "medium" | "low", "reason": "理由" }],
  "strategy": "学习策略文本"
}`;

  let riskAssessment;
  try {
    riskAssessment = await structuredOutput(structuredPrompt, RiskAssessmentSchema, {
      systemPrompt: '你是一位学习规划分析师。必须调用 risk_assessment 工具返回结果。',
      toolName: 'risk_assessment'
    });

    logger.info({
      step: 'analyze_requirements',
      model: 'deepseek-v3',
      level: riskAssessment.level,
      risksCount: riskAssessment.factors.length,
      timeAssessment: riskAssessment.timeAssessment
    }, 'Structured analysis completed');
  } catch (error) {
    logger.warn({
      step: 'analyze_requirements',
      structuredErrorCode: error.code,
      toolName: error.toolName || 'risk_assessment',
      err: error.message
    }, 'Structured risk analysis failed, fallback to rules');
    riskAssessment = buildFallbackRiskAssessment(goal, subjects, availability);
  }

  onEvent({
    type: 'analysis_result',
    summary: riskAssessment.prediction,
    findings: riskAssessment.factors.map(f => f.description),
    recommendations: riskAssessment.suggestedActions
  });

  const highPrioritySubjects = (riskAssessment.subjectPriorities || [])
    .filter(s => s.priorityLevel === 'high')
    .map(s => s.subjectName);
  emitAgentStep(config, {
    stepId: 'analyze_requirements',
    status: 'completed',
    summary: `距离考试 ${availability.examDistance} 天，风险等级：${riskAssessment.level}${highPrioritySubjects.length > 0 ? `，重点：${highPrioritySubjects.join('、')}` : ''}`
  });

  return {
    riskAssessment,
    workflow: {
      ...state.workflow,
      stage: 'planning',
      currentNode: 'analyze_requirements',
      history: [{
        node: 'analyze_requirements',
        timestamp: Date.now(),
        duration: Date.now() - (state.metadata?.updatedAt || Date.now())
      }]
    },
    metadata: {
      ...state.metadata,
      updatedAt: Date.now()
    }
  };
}

async function generateStudyPlan(state, config) {
  const onEvent = getOnEvent(config);
  logger.info({ step: 'generate_plan' }, 'Generating study plan');

  const { goal, subjects, availability, riskAssessment } = state;

  onEvent({ type: 'workflow_step', step: 'generating', progress: 70 });
  emitAgentStep(config, { stepId: 'generate_plan', status: 'running', title: '生成学习计划' });

  let tasks;
  let planStrategy = '';

  const planPrompt = `你是一位学习规划专家。根据以下信息，制定学习任务框架：

学习目标：${goal.primaryGoal || '未知'}
考试日期：${goal.examDate || '未设置'}
目标分数：${goal.targetScore || '未设置'}
距离考试：${availability.examDistance} 天
每日可用时间：${availability.dailyHours} 小时

科目信息：
${subjects.map(s => `- ID: ${s.id}，名称：${s.name}，当前水平 ${s.currentLevel}/10，目标水平 ${s.targetLevel}/10，优先级 ${s.priority}`).join('\n')}

风险评估：${riskAssessment?.level || 'unknown'}，${riskAssessment?.prediction || ''}
建议策略：${riskAssessment?.suggestedActions?.join('；') || ''}

请规划学习任务框架，包含：
1. 每个科目需要哪些学习/练习/复习任务
2. 任务的优先级和预估时长
3. 分阶段安排建议

硬性约束：
1. 只输出任务框架，不输出具体日期或每日安排，具体日期和时间由系统自动分配
2. 不要重复列出同一学习目标；同一 subjectId、type、相似 title 的任务应合并为一个任务
3. 长任务用一个任务和 estimatedHours 表达总工作量，不要拆成多条相同标题任务
4. estimatedHours 表示该任务总耗时，不是单日耗时
5. 不要输出 study_timeline、startDate、endDate、events 或任何 UIBlock 数据，阶段时间线由系统根据最终排程自动生成

注意：任务 subjectId 必须使用上方科目列表里的 ID。`;

  let planSource = planPrompt;
  try {
    const { thinkingText, contentText } = await streamChatWithThinking(planPrompt, {
      onThinking: (token) => {
        onEvent({ type: 'thinking', content: token });
      }
    });

    planSource = contentText || thinkingText || planPrompt;
  } catch (error) {
    logger.warn({
      step: 'generate_plan',
      err: error.message
    }, 'V3 planning analysis failed, continuing with raw planning data');
  } finally {
    onEvent({ type: 'thinking_end', duration: 0 });
  }

  const structuredPlanPrompt = `基于以下规划思考，输出结构化 JSON：

${planSource}

请严格按照以下 JSON 格式输出：
{
  "tasks": [{ "subjectId": "必须是上方科目列表里的 ID", "subjectName": "科目名", "title": "任务标题", "type": "study" | "practice" | "review", "priority": 1-10, "estimatedHours": 数字, "description": "描述" }],
  "strategy": "整体策略文本",
  "totalEstimatedHours": 数字
}

不要输出 scheduledDate、study_timeline、startDate、endDate、events 或任何 UIBlock 数据。不要为了填充时间重复输出相同或相似任务。`;

  try {
    const taskFramework = await structuredOutput(structuredPlanPrompt, TaskFrameworkSchema, {
      systemPrompt: '你是一位学习规划专家。必须调用 task_framework 工具返回结果。',
      toolName: 'task_framework'
    });

    planStrategy = taskFramework.strategy;
    tasks = deterministicallyScheduleTasks(taskFramework.tasks, availability, subjects);
    logger.info({ step: 'generate_plan', taskCount: tasks.length, model: 'deepseek-v3' }, 'LLM framework + deterministic scheduling completed');

  } catch (error) {
    logger.warn({
      step: 'generate_plan',
      structuredErrorCode: error.code,
      toolName: error.toolName || 'task_framework',
      err: error.message
    }, 'Structured task framework failed, fallback to rules');
    tasks = generateFallbackTasks(subjects, availability);
  }

  const coveredSubjectIds = new Set(tasks
    .map(t => t.subjectId)
    .filter(subjectId => subjects.some(subject => subject.id === subjectId)));
  const hasComprehensiveReview = tasks.some(t => t.subjectId === 'all');
  emitAgentStep(config, {
    stepId: 'generate_plan',
    status: 'completed',
    summary: `已生成 ${tasks.length} 个排期任务，覆盖 ${coveredSubjectIds.size} 个科目${hasComprehensiveReview ? '，另含综合复习' : ''}`
  });

  onEvent({ type: 'workflow_step', step: 'generating', progress: 90 });

  const planTimestamp = Date.now();
  const planId = `plan_${state.studySpaceId}_${planTimestamp}`;

  return {
    tasksSnapshot: tasks,
    progress: {
      ...state.progress,
      totalTasks: tasks.length,
      overallCompletionRate: 0
    },
    currentPlan: {
      planId,
      versionId: planId,
      versionNumber: 1,
      status: 'draft',
      createdAt: new Date(planTimestamp).toISOString(),
      lastModifiedAt: new Date(planTimestamp).toISOString()
    },
    workflow: {
      ...state.workflow,
      currentNode: 'generate_plan',
      history: [{
        node: 'generate_plan',
        timestamp: Date.now(),
        duration: Date.now() - (state.metadata?.updatedAt || Date.now())
      }]
    },
    metadata: {
      ...state.metadata,
      updatedAt: Date.now()
    }
  };
}

async function buildUIBlocks(state, config) {
  const onEvent = getOnEvent(config);
  logger.info({ step: 'build_ui_blocks' }, 'Building UI blocks');
  emitAgentStep(config, { stepId: 'build_ui_blocks', status: 'running', title: '构建计划展示' });

  const uiBlocks = buildPlanBlocks({
    planId: state.currentPlan?.planId,
    planVersion: state.currentPlan?.versionNumber || 1,
    goal: state.goal,
    subjects: state.subjects,
    availability: state.availability,
    tasksSnapshot: state.tasksSnapshot,
    riskAssessment: state.riskAssessment,
    persisted: false
  });

  const persistence = await persistFinalizedWorkflowPlan(state, uiBlocks);
  const emittedBlocks = uiBlocks.map(block => ({
    ...block,
    meta: {
      ...block.meta,
      persisted: persistence.persisted,
    },
  }));

  for (const block of emittedBlocks) {
    onEvent({ type: 'ui_block_update', action: 'add', block });
  }

  emitAgentStep(config, {
    stepId: 'build_ui_blocks',
    status: 'completed',
    summary: `已生成 ${emittedBlocks.length} 个展示组件：${emittedBlocks.map(b => b.title).join('、')}`
  });

  onEvent({ type: 'workflow_step', step: 'finalized', progress: 100 });
  onEvent({ type: 'content', content: '学习计划已生成，右侧已整理为概览、任务和时间线。' });

  logger.info({
    step: 'build_ui_blocks',
    blockCount: emittedBlocks.length,
    persisted: persistence.persisted,
  }, 'UI blocks generated');

  return buildFinalizedCheckpointUpdate(state, emittedBlocks, persistence);
}

function toISODate(date) {
  return date.toISOString().split('T')[0];
}

function resolveExamDate(goal, availability) {
  if (goal.examDate) {
    return goal.examDate;
  }

  const fallbackDate = new Date();
  fallbackDate.setDate(fallbackDate.getDate() + (availability.examDistance || 0));
  return toISODate(fallbackDate);
}

function calculateDaysRemaining(examDate, availability) {
  const examTime = new Date(examDate).getTime();
  if (Number.isNaN(examTime)) {
    return availability.examDistance || 0;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.ceil((examTime - today.getTime()) / (24 * 60 * 60 * 1000)));
}

function getPriorityWeight(priority) {
  const weights = { high: 3, medium: 2, low: 1 };
  if (typeof priority === 'number') {
    return priority;
  }
  return weights[priority] || 1;
}

function calculateWeightedCurrentScore(subjects) {
  if (!subjects.length) {
    return 0;
  }

  const weighted = subjects.reduce((acc, subject) => {
    const weight = getPriorityWeight(subject.priority);
    return {
      total: acc.total + subject.currentLevel * weight,
      weight: acc.weight + weight
    };
  }, { total: 0, weight: 0 });

  if (!weighted.weight) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round((weighted.total / weighted.weight) * 10)));
}

function normalizeComparableText(value) {
  return String(value || '').trim().toLowerCase();
}

function includesText(source, target) {
  const normalizedSource = normalizeComparableText(source);
  const normalizedTarget = normalizeComparableText(target);
  return !!normalizedSource && !!normalizedTarget && normalizedSource.includes(normalizedTarget);
}

function isComprehensiveReviewTask(task) {
  const text = [
    task.subjectId,
    task.subjectName,
    task.title,
    task.description
  ].map(normalizeComparableText).join(' ');

  return task.type === 'review' && (
    text.includes('综合') ||
    text.includes('全科') ||
    text.includes('全部') ||
    text.includes('所有') ||
    text.includes('all subjects')
  );
}

function resolveTaskSubjectId(task, subjects) {
  const fallbackSubject = subjects[0];
  if (!fallbackSubject) {
    return 'general';
  }

  if (isComprehensiveReviewTask(task)) {
    return 'all';
  }

  const rawSubjectId = normalizeComparableText(task.subjectId);
  const directIdMatch = subjects.find(subject => normalizeComparableText(subject.id) === rawSubjectId);
  if (directIdMatch) {
    return directIdMatch.id;
  }

  const rawSubjectName = normalizeComparableText(task.subjectName);
  const directNameMatch = subjects.find(subject => normalizeComparableText(subject.name) === rawSubjectName);
  if (directNameMatch) {
    return directNameMatch.id;
  }

  const searchableText = [
    task.subjectId,
    task.subjectName,
    task.title,
    task.description
  ].join(' ');

  const containedSubject = subjects.find(subject =>
    includesText(searchableText, subject.id) || includesText(searchableText, subject.name)
  );

  return containedSubject?.id || fallbackSubject.id;
}

function getTaskSubjectName(task, subjects) {
  if (task.subjectId === 'all') {
    return '综合复习';
  }

  return subjects.find(subject => subject.id === task.subjectId)?.name || subjects[0]?.name || '未知科目';
}

function mapPriority(priority) {
  return priority >= 7 ? 'high' : priority >= 5 ? 'medium' : 'low';
}

function mapTaskStatus(status) {
  const validStatuses = new Set(['pending', 'in_progress', 'completed', 'skipped', 'failed']);
  return validStatuses.has(status) ? status : 'pending';
}

function mapTaskForDailyList(task, subjects) {
  return {
    id: task.id,
    subject: getTaskSubjectName(task, subjects),
    task: task.title,
    duration: task.estimatedMinutes,
    priority: mapPriority(task.priority),
    status: mapTaskStatus(task.status),
    estimatedTime: '',
    scheduledDate: task.scheduledDate,
    groupLabel: formatScheduleGroupLabel(task.scheduledDate)
  };
}

function formatScheduleGroupLabel(dateString) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return dateString;
  }

  return date.toLocaleDateString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short'
  });
}

function buildScheduleGroups(tasksByDate, subjects) {
  return Object.keys(tasksByDate)
    .sort()
    .map(date => ({
      date,
      label: formatScheduleGroupLabel(date),
      tasks: tasksByDate[date].map(task => mapTaskForDailyList(task, subjects))
    }));
}

function selectDisplayTasks(tasksSnapshot, today) {
  const sortedTasks = [...tasksSnapshot].sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
  const todayTasks = sortedTasks.filter(task => task.scheduledDate === today);
  if (todayTasks.length > 0) {
    return todayTasks.slice(0, 5);
  }

  const nextTask = sortedTasks.find(task => task.scheduledDate >= today);
  if (nextTask) {
    return sortedTasks.filter(task => task.scheduledDate === nextTask.scheduledDate).slice(0, 5);
  }

  const firstTask = sortedTasks[0];
  return firstTask ? sortedTasks.filter(task => task.scheduledDate === firstTask.scheduledDate).slice(0, 5) : [];
}

function mapRiskType(type) {
  const typeMap = {
    time_pressure: 'time_pressure',
    low_accuracy: 'low_performance',
    falling_behind: 'behind_schedule',
    resource_overload: 'conflict'
  };

  return typeMap[type] || type;
}

// ============================================================
// 确定性调度 + 降级逻辑
// ============================================================

function buildFallbackRiskAssessment(goal, subjects, availability) {
  const risks = [];
  const totalHours = availability.examDistance * availability.dailyHours;
  const neededHours = subjects.reduce((sum, s) => sum + (s.targetLevel - s.currentLevel) * 8, 0);

  if (totalHours < neededHours) {
    risks.push({ type: 'time_pressure', description: `可用学习时间(${totalHours}h)可能不足以完成所有科目提升(需约${neededHours}h)`, severity: 7 });
  }
  if (availability.examDistance < 14 && subjects.length > 2) {
    risks.push({ type: 'resource_overload', description: '时间紧迫，建议聚焦重点科目', severity: 6 });
  }

  return {
    level: risks.length > 1 ? 'high' : risks.length > 0 ? 'medium' : 'low',
    factors: risks,
    prediction: risks.map(r => r.description).join('; ') || '当前计划可行',
    suggestedActions: subjects.length > 0
      ? [`建议优先攻克${subjects[0]?.name || '主要科目'}，每日分配${Math.floor(availability.dailyHours * 0.6)}小时`]
      : ['请先添加科目信息'],
    timeAssessment: totalHours >= neededHours ? 'sufficient' : totalHours >= neededHours * 0.6 ? 'tight' : 'insufficient',
    subjectPriorities: subjects.map(s => ({
      subjectName: s.name,
      priorityLevel: s.targetLevel - s.currentLevel >= 3 ? 'high' : s.targetLevel - s.currentLevel >= 2 ? 'medium' : 'low',
      reason: `差距${s.targetLevel - s.currentLevel}个等级`,
    })),
    strategy: subjects.length > 0
      ? `建议优先攻克${subjects[0]?.name || '主要科目'}，每日分配${Math.floor(availability.dailyHours * 0.6)}小时`
      : '请先添加科目信息',
  };
}

function generateFallbackTasks(subjects, availability) {
  const frameworkTasks = subjects.flatMap(subject => {
    const gap = Math.max(1, (subject.targetLevel || 5) - (subject.currentLevel || 1));
    const basePriority = subject.priority === 'high' ? 8 : subject.priority === 'medium' ? 6 : 5;
    const estimatedHours = Math.max(1, gap * 1.5);

    return [
      {
        subjectId: subject.id,
        subjectName: subject.name,
        title: `${subject.name} - 核心概念梳理`,
        type: 'study',
        priority: basePriority,
        estimatedHours,
        description: '梳理核心概念、公式和基础知识框架'
      },
      {
        subjectId: subject.id,
        subjectName: subject.name,
        title: `${subject.name} - 重点题型训练`,
        type: 'practice',
        priority: Math.min(10, basePriority + 1),
        estimatedHours,
        description: '围绕重点题型进行练习和订正'
      }
    ];
  });

  return deterministicallyScheduleTasks(frameworkTasks, availability, subjects);
}

// ============================================================
// 工作流图构建
// ============================================================

export function createInitialPlanningWorkflow() {
  const workflow = new StateGraph(StateAnnotation);

  workflow.addNode('load_space_context', loadSpaceContext);
  workflow.addNode('collect_missing_info', collectMissingInfo);
  workflow.addNode('analyze_requirements', analyzeStudyRequirements);
  workflow.addNode('generate_plan', generateStudyPlan);
  workflow.addNode('build_ui_blocks', buildUIBlocks);

  workflow.setEntryPoint('load_space_context');
  workflow.addEdge('load_space_context', 'collect_missing_info');

  workflow.addConditionalEdges(
    'collect_missing_info',
    (state) => {
      if (state.interruption?.isInterrupted) {
        logger.info({ step: 'collect_missing_info', action: 'interrupt' }, 'Workflow interrupted, waiting for user input');
        return 'interrupt';
      }
      logger.info({ step: 'collect_missing_info', action: 'continue' }, 'Workflow continuing');
      return 'continue';
    },
    {
      interrupt: END,
      continue: 'analyze_requirements'
    }
  );

  workflow.addEdge('analyze_requirements', 'generate_plan');
  workflow.addEdge('generate_plan', 'build_ui_blocks');
  workflow.addEdge('build_ui_blocks', END);

  const compiledWorkflow = workflow.compile({ checkpointer });

  logger.info({ step: 'workflow_init' }, 'Initial planning workflow compiled (stream + onEvent)');
  return compiledWorkflow;
}

/**
 * 流式执行工作流 — 逐节点推送 SSE 事件
 * @param {string} studySpaceId
 * @param {string} userId
 * @param {object} initialState
 * @param {object} config - 可包含 configurable.onEvent 回调
 * @yields {{nodeName: string, state: object}} 每个节点执行后的状态快照
 */
export async function* runInitialPlanningStream(studySpaceId, userId, initialState = {}, config = {}) {
  logger.info({ spaceId: studySpaceId, mode: 'stream' }, 'Starting stream planning workflow');

  const state = {
    ...createInitialState(studySpaceId, userId),
    ...initialState
  };

  const workflow = createInitialPlanningWorkflow();
  const stream = await workflow.stream(state, {
    configurable: { thread_id: studySpaceId, ...config?.configurable },
  });

  for await (const event of stream) {
    const [nodeName, nodeState] = Object.entries(event)[0];
    logger.info({ node: nodeName, stage: nodeState.workflow?.stage }, 'Stream node completed');
    yield { nodeName, state: nodeState };
  }
}

/**
 * 同步执行工作流（用于 resume 等非 SSE 场景，保持向后兼容）
 */
export async function runInitialPlanning(studySpaceId, userId, initialState = {}, config = {}) {
  logger.info({ spaceId: studySpaceId, mode: 'invoke' }, 'Starting planning workflow');

  const state = {
    ...createInitialState(studySpaceId, userId),
    ...initialState
  };

  const workflow = createInitialPlanningWorkflow();
  const result = await workflow.invoke(state, {
    configurable: { thread_id: studySpaceId, ...config?.configurable },
  });

  logger.info({ stage: result.workflow.stage }, 'Workflow completed');
  return hydrateFinalizedWorkflowState(result);
}

export default {
  createInitialPlanningWorkflow,
  runInitialPlanning,
  runInitialPlanningStream,
};
