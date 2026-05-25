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

// ============================================================
// 节点函数实现
// ============================================================

async function loadSpaceContext(state, config) {
  const onEvent = getOnEvent(config);
  logger.info({ spaceId: state.studySpaceId, step: 'load_space_context' }, 'Load space context');

  onEvent({ type: 'workflow_step', step: 'collecting', progress: 10 });

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

  return {
    ...loadedData,
    workflow: {
      ...state.workflow,
      stage: 'collecting_info',
      currentNode: 'load_space_context',
      history: [
        ...state.workflow.history,
        { node: 'load_space_context', timestamp: Date.now(), duration: 100 }
      ]
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
  return {
    workflow: {
      ...state.workflow,
      stage: 'analyzing',
      currentNode: 'collect_missing_info',
      history: [
        ...state.workflow.history,
        { node: 'collect_missing_info', timestamp: Date.now(), duration: 50 }
      ]
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
  onEvent({ type: 'thinking', content: '正在分析你的学习情况...\n\n' });

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

  let riskAssessment;
  try {
    const startTime = Date.now();

    const { thinkingText, contentText } = await streamReasoner(analysisPrompt, {
      onThinking: (token) => {
        onEvent({ type: 'thinking', content: token });
      },
      onContent: (token) => {
        onEvent({ type: 'content', content: token });
      }
    });

    const thinkingDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    onEvent({ type: 'thinking_end', duration: parseFloat(thinkingDuration) });
    logger.info({ step: 'analyze_requirements', thinkingDuration, contentLength: contentText.length, model: 'deepseek-r1' }, 'R1 thinking completed');

    onEvent({ type: 'workflow_step', step: 'analyzing', progress: 60 });
    onEvent({ type: 'content', content: '\n\n正在整理分析结论...\n' });

    const structuredPrompt = `基于以下分析，输出结构化 JSON：

分析内容：
${contentText}

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

    riskAssessment = await structuredOutput(structuredPrompt, RiskAssessmentSchema, {
      systemPrompt: '你是一位学习规划分析师。请输出严格的 JSON 格式，不要添加任何额外文字。'
    });

    onEvent({ type: 'analysis_result', summary: riskAssessment.prediction, findings: riskAssessment.factors.map(f => f.description), recommendations: riskAssessment.suggestedActions });

    logger.info({
      step: 'analyze_requirements',
      model: 'deepseek-v3',
      level: riskAssessment.level,
      risksCount: riskAssessment.factors.length,
      timeAssessment: riskAssessment.timeAssessment
    }, 'Structured analysis completed');

  } catch (error) {
    logger.error({ step: 'analyze_requirements', err: error.message }, 'R1/structured call failed, fallback to rules');
    onEvent({ type: 'content', content: '\n\n（使用规则分析引擎）\n' });

    riskAssessment = buildFallbackRiskAssessment(goal, subjects, availability);
  }

  return {
    riskAssessment,
    workflow: {
      ...state.workflow,
      stage: 'planning',
      currentNode: 'analyze_requirements',
      history: [
        ...state.workflow.history,
        { node: 'analyze_requirements', timestamp: Date.now(), duration: Date.now() - (state.metadata?.updatedAt || Date.now()) }
      ]
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
  onEvent({ type: 'thinking', content: '正在规划学习任务和进度安排...\n\n' });

  let tasks;
  let planStrategy = '';

  try {
    const planPrompt = `你是一位学习规划专家。根据以下信息，制定学习任务框架：

学习目标：${goal.primaryGoal || '未知'}
考试日期：${goal.examDate || '未设置'}
目标分数：${goal.targetScore || '未设置'}
距离考试：${availability.examDistance} 天
每日可用时间：${availability.dailyHours} 小时

科目信息：
${subjects.map(s => `- ${s.name}：当前水平 ${s.currentLevel}/10，目标水平 ${s.targetLevel}/10，优先级 ${s.priority}`).join('\n')}

风险评估：${riskAssessment?.level || 'unknown'}，${riskAssessment?.prediction || ''}
建议策略：${riskAssessment?.suggestedActions?.join('；') || ''}

请规划学习任务框架，包含：
1. 每个科目需要哪些学习/练习/复习任务
2. 任务的优先级和预估时长
3. 分阶段安排建议

注意：只需输出任务框架（任务名称、类型、优先级、预估小时数），具体日期和时间由系统自动分配。`;

    const { thinkingText } = await streamChatWithThinking(planPrompt, {
      onThinking: (token) => {
        onEvent({ type: 'thinking', content: token });
      },
      onContent: (token) => {
        onEvent({ type: 'content', content: token });
      }
    });

    onEvent({ type: 'thinking_end', duration: 0 });

    const structuredPlanPrompt = `基于以下规划思考，输出结构化 JSON：

${thinkingText || planPrompt}

请严格按照以下 JSON 格式输出：
{
  "tasks": [{ "subjectId": "科目ID", "subjectName": "科目名", "title": "任务标题", "type": "study" | "practice" | "review", "priority": 1-10, "estimatedHours": 数字, "description": "描述" }],
  "strategy": "整体策略文本",
  "totalEstimatedHours": 数字
}`;

    const taskFramework = await structuredOutput(structuredPlanPrompt, TaskFrameworkSchema, {
      systemPrompt: '你是一位学习规划专家。请输出严格的 JSON 格式，不要添加任何额外文字。'
    });

    planStrategy = taskFramework.strategy;
    tasks = deterministicallyScheduleTasks(taskFramework.tasks, availability, subjects);
    logger.info({ step: 'generate_plan', taskCount: tasks.length, model: 'deepseek-v3' }, 'LLM framework + deterministic scheduling completed');

  } catch (error) {
    logger.error({ step: 'generate_plan', err: error.message }, 'V3 call failed, fallback to rules');
    onEvent({ type: 'content', content: '\n\n（使用规则引擎生成计划）\n' });

    tasks = generateFallbackTasks(subjects, availability);
  }

  onEvent({ type: 'workflow_step', step: 'generating', progress: 90 });

  return {
    tasksSnapshot: tasks,
    progress: {
      ...state.progress,
      totalTasks: tasks.length,
      overallCompletionRate: 0
    },
    currentPlan: {
      versionId: `v1_${Date.now()}`,
      versionNumber: 1,
      createdAt: new Date().toISOString(),
      lastModifiedAt: new Date().toISOString()
    },
    workflow: {
      ...state.workflow,
      currentNode: 'generate_plan',
      history: [
        ...state.workflow.history,
        { node: 'generate_plan', timestamp: Date.now(), duration: Date.now() - (state.metadata?.updatedAt || Date.now()) }
      ]
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

  const { goal, subjects, tasksSnapshot, availability, riskAssessment, currentPlan } = state;

  const tasksByDate = {};
  for (const task of tasksSnapshot) {
    if (!tasksByDate[task.scheduledDate]) {
      tasksByDate[task.scheduledDate] = [];
    }
    tasksByDate[task.scheduledDate].push(task);
  }

  const today = new Date().toISOString().split('T')[0];
  const todayTasks = tasksSnapshot.filter(t => t.scheduledDate === today);

  const uiBlocks = [
    {
      id: 'summary_card',
      type: 'summary-card',
      title: '学习计划概览',
      order: 1,
      props: {
        spaceName: '学习计划',
        spaceDescription: goal.primaryGoal || '个性化学习计划',
        primaryGoal: goal.primaryGoal || '完成学习目标',
        targetScore: goal.targetScore || 85,
        currentScore: 0,
        examDate: goal.examDate || new Date(Date.now() + availability.examDistance * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        daysRemaining: availability.examDistance,
        overallProgress: 0,
        subjects: subjects.map(s => ({
          name: s.name,
          progress: 0,
          targetLevel: s.targetLevel
        }))
      }
    },
    {
      id: 'daily_task_list',
      type: 'daily-task-list',
      title: '今日任务',
      order: 2,
      props: {
        date: today,
        tasks: (todayTasks.length > 0 ? todayTasks : tasksSnapshot.slice(0, 5)).map(t => ({
          id: t.id,
          subject: subjects.find(s => s.id === t.subjectId)?.name || '未知科目',
          task: t.title,
          duration: t.estimatedMinutes,
          priority: t.priority >= 7 ? 'high' : t.priority >= 5 ? 'medium' : 'low',
          status: 'pending',
          estimatedTime: ''
        })),
        totalDuration: todayTasks.reduce((sum, t) => sum + t.estimatedMinutes, 0) || 120,
        completionRate: 0
      }
    },
    {
      id: 'study_timeline',
      type: 'study-timeline',
      title: '学习时间线',
      order: 3,
      props: {
        startDate: new Date().toISOString().split('T')[0],
        endDate: goal.examDate || new Date(Date.now() + availability.examDistance * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        events: Object.entries(tasksByDate).slice(0, 10).map(([date, dateTasks]) => ({
          date,
          title: `${dateTasks.length} 个任务`,
          type: 'study_session',
          importance: 'medium'
        }))
      }
    }
  ];

  if (riskAssessment && riskAssessment.level !== 'low') {
    uiBlocks.push({
      id: 'risk_alert',
      type: 'risk-alert',
      title: '风险提示',
      order: 4,
      props: {
        risks: riskAssessment.factors.map(f => ({
          type: f.type,
          severity: f.severity >= 7 ? 'high' : f.severity >= 4 ? 'medium' : 'low',
          message: f.description,
          suggestion: riskAssessment.suggestedActions?.[0] || ''
        }))
      }
    });
  }

  uiBlocks.push({
    id: 'action_bar',
    type: 'action-bar',
    title: '操作选项',
    order: 99,
    props: {
      actions: [
        { id: 'start_today', label: '从今天开始', type: 'primary' },
        { id: 'adjust_plan', label: '调整计划', type: 'secondary' }
      ]
    }
  });

  for (const block of uiBlocks) {
    onEvent({ type: 'ui_block_update', action: 'add', block });
  }

  onEvent({ type: 'workflow_step', step: 'finalized', progress: 100 });

  logger.info({ step: 'build_ui_blocks', blockCount: uiBlocks.length }, 'UI blocks generated');

  return {
    uiBlocks,
    workflow: {
      ...state.workflow,
      stage: 'finalized',
      currentNode: 'build_ui_blocks',
      history: [
        ...state.workflow.history,
        { node: 'build_ui_blocks', timestamp: Date.now(), duration: 200 }
      ]
    },
    metadata: {
      ...state.metadata,
      updatedAt: Date.now(),
      lastActivityAt: Date.now()
    }
  };
}

// ============================================================
// 确定性调度 + 降级逻辑
// ============================================================

function deterministicallyScheduleTasks(frameworkTasks, availability, subjects) {
  const totalDays = availability.examDistance;
  const dailyMinutes = availability.dailyHours * 60;
  const tasks = [];
  const sorted = [...frameworkTasks].sort((a, b) => b.priority - a.priority);

  const subjectHours = {};
  for (const ft of sorted) {
    const sid = ft.subjectId || 'general';
    if (!subjectHours[sid]) subjectHours[sid] = 0;
    const remainingHours = ft.estimatedHours || 2;
    const sessionsNeeded = Math.ceil(remainingHours / (dailyMinutes / 60 / subjects.length));

    for (let s = 0; s < sessionsNeeded; s++) {
      const dayOffset = Math.floor((Object.keys(subjectHours).reduce((a, b) => a + subjectHours[b], 0) + s * (dailyMinutes / 60 / subjects.length)) / availability.dailyHours);
      const date = new Date();
      date.setDate(date.getDate() + Math.min(dayOffset, totalDays - 1));

      tasks.push({
        id: `task_${tasks.length + 1}_${sid}`,
        subjectId: sid,
        title: ft.title,
        type: ft.type || 'study',
        estimatedMinutes: Math.min(Math.round((remainingHours / sessionsNeeded) * 60), dailyMinutes),
        scheduledDate: date.toISOString().split('T')[0],
        priority: ft.priority,
        status: 'pending',
      });

      subjectHours[sid] += remainingHours / sessionsNeeded;
    }
  }

  const reviewDays = Math.max(3, Math.floor(totalDays * 0.1));
  for (let i = 0; i < reviewDays; i++) {
    const reviewDate = new Date();
    reviewDate.setDate(reviewDate.getDate() + totalDays - reviewDays + i);
    tasks.push({
      id: `review_${i + 1}`,
      subjectId: 'all',
      title: `综合复习 - 第${i + 1}轮`,
      type: 'review',
      estimatedMinutes: Math.min(Math.floor(dailyMinutes * 0.5), 90),
      scheduledDate: reviewDate.toISOString().split('T')[0],
      priority: 7,
      status: 'pending',
    });
  }

  return tasks;
}

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
  const tasks = [];
  let taskId = 1;
  const totalDays = availability.examDistance;
  const dailyHours = availability.dailyHours;

  for (const subject of subjects) {
    const subjectTasks = Math.ceil((subject.targetLevel - subject.currentLevel) * 3);
    for (let day = 0; day < totalDays; day++) {
      const date = new Date();
      date.setDate(date.getDate() + day);
      if (day % Math.ceil(totalDays / subjectTasks) === 0 && taskId <= subjectTasks) {
        tasks.push({
          id: `task_${taskId++}_${subject.id}`,
          subjectId: subject.id,
          title: `${subject.name} - 第${Math.floor(taskId / Math.ceil(totalDays / subjectTasks)) + 1}阶段学习`,
          type: 'study',
          estimatedMinutes: Math.floor(dailyHours * 60 / subjects.length),
          scheduledDate: date.toISOString().split('T')[0],
          priority: subject.priority === 'high' ? 8 : 5,
          status: 'pending'
        });
      }
    }
  }

  const reviewDays = Math.max(3, Math.floor(totalDays * 0.1));
  for (let i = 0; i < reviewDays; i++) {
    const reviewDate = new Date();
    reviewDate.setDate(reviewDate.getDate() + totalDays - reviewDays + i);
    tasks.push({
      id: `review_${i + 1}`,
      subjectId: 'all',
      title: `综合复习 - 第${i + 1}轮`,
      type: 'review',
      estimatedMinutes: Math.floor(dailyHours * 30),
      scheduledDate: reviewDate.toISOString().split('T')[0],
      priority: 7,
      status: 'pending'
    });
  }

  return tasks;
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
  return result;
}

export default {
  createInitialPlanningWorkflow,
  runInitialPlanning,
  runInitialPlanningStream,
};
