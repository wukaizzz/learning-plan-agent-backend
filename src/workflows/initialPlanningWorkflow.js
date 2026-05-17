/**
 * 首次计划生成工作流
 * LangGraph 工作流实现 - 用于首次创建学习计划
 */

import { StateGraph, END, Annotation } from '@langchain/langgraph';
import { checkpointer } from '../utils/checkpointer.js';
import { createInitialState } from '../types/workflowState.js';

// ============================================================
// 定义状态结构
// ============================================================
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

// ============================================================
// 节点函数实现
// ============================================================

/**
 * 节点 1: 加载学习空间上下文
 * 从数据库加载学习空间的完整信息
 */
async function loadSpaceContext(state) {
  console.log(`📂 [loadSpaceContext] 加载学习空间 [spaceId: ${state.studySpaceId}]`);

  // TODO: 从数据库加载实际的学习空间数据
  // const spaceData = await db.studySpaces.findById(state.studySpaceId);

  // 模拟从数据库加载的数据
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
        {
          node: 'load_space_context',
          timestamp: Date.now(),
          duration: 100
        }
      ]
    },
    metadata: {
      ...state.metadata,
      updatedAt: Date.now(),
      lastActivityAt: Date.now()
    }
  };
}

/**
 * 节点 2: 收集缺失信息
 * 检查必需字段，如有缺失则触发中断
 */
async function collectMissingInfo(state) {
  console.log(`🔍 [collectMissingInfo] 检查缺失信息`);

  const missingFields = [];
  // 检查考试日期
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

  // 检查目标分数
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

  // 检查科目信息
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

  // 检查每日可用时间
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

  // 如果有缺失信息，生成 UI Block 并中断
  if (missingFields.length > 0) {
    console.log(`⏸️ [collectMissingInfo] 发现 ${missingFields.length} 个缺失字段，触发中断`);

    // 转换字段格式以匹配前端 CollectionForm 组件
    const formattedFields = missingFields.map(field => ({
      name: field.name,
      label: field.label,
      type: field.type,
      placeholder: field.placeholder,
      required: field.required,
      options: field.options,
      // 移除前端不需要的字段
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

  // 信息完整，继续
  console.log(`✅ [collectMissingInfo] 信息完整，继续执行`);
  return {
    workflow: {
      ...state.workflow,
      stage: 'analyzing',
      currentNode: 'collect_missing_info',
      history: [
        ...state.workflow.history,
        {
          node: 'collect_missing_info',
          timestamp: Date.now(),
          duration: 50
        }
      ]
    },
    metadata: {
      ...state.metadata,
      updatedAt: Date.now(),
      lastActivityAt: Date.now()
    }
  };
}

/**
 * 节点 3: 分析学习需求
 * 调用 AI 模型分析学习需求并确定优先级
 */
async function analyzeStudyRequirements(state) {
  console.log(`🧠 [analyzeStudyRequirements] AI 分析学习需求`);

  const { goal, subjects, availability } = state;

  // ✅ 验证必要数据是否存在
  if (!goal.examDate || !goal.targetScore || !subjects || subjects.length === 0) {
    console.warn('⚠️ [analyzeStudyRequirements] 缺少必要数据，使用默认值');
  }

  // 构建分析提示词
  const analysisPrompt = `
请分析以下学习情况并给出建议：

学习目标：${goal.primaryGoal || '未知'}
考试日期：${goal.examDate || '未设置'}
目标分数：${goal.targetScore || '未设置'}
距离考试：${availability.examDistance} 天
每日可用时间：${availability.dailyHours} 小时

科目信息：
${subjects.length > 0
  ? subjects.map(s => `- ${s.name}：当前水平 ${s.currentLevel}/10，目标水平 ${s.targetLevel}/10`).join('\n')
  : '无科目信息'
}

请分析：
1. 时间是否充足（计算所需总学习时间）
2. 各科目的优先级排序
3. 学习策略建议（重点突破哪些科目）
4. 风险提示
`;

  console.log('📝 [analyzeStudyRequirements] 分析提示词:', analysisPrompt);

  // TODO: 调用 AI 模型
  // const analysisResult = await callDeepSeek(analysisPrompt);

  // ✅ 改进的模拟 AI 分析结果（基于真实数据）
  const analysisResult = {
    timeAssessment: availability.examDistance * availability.dailyHours >= 60 ? '充足' : '紧张',
    subjectPriorities: subjects.length > 0 ? subjects.map(s => ({
      ...s,
      priorityLevel: s.targetLevel - s.currentLevel >= 2 ? 'high' : 'medium'
    })) : [],
    strategy: subjects.length > 0
      ? `建议优先攻克${subjects[0]?.name || '主要科目'}，每日分配${Math.floor(availability.dailyHours * 0.6)}小时`
      : '请先添加科目信息',
    risks: []
  };

  // ✅ 基于真实数据的风险评估
  if (availability.examDistance < 7 && subjects.length > 2) {
    analysisResult.risks.push('时间紧迫，建议聚焦重点科目');
  }

  if (!goal.examDate) {
    analysisResult.risks.push('未设置考试日期，无法准确规划');
  }

  console.log(`📊 [analyzeStudyRequirements] 分析完成`, {
    timeAssessment: analysisResult.timeAssessment,
    risksCount: analysisResult.risks.length,
    subjectCount: subjects.length
  });

  return {
    riskAssessment: {
      level: analysisResult.risks.length > 0 ? 'medium' : 'low',
      factors: analysisResult.risks.map(r => ({
        type: 'time_pressure',
        description: r,
        severity: 6
      })),
      prediction: analysisResult.risks.join('; ') || '当前计划可行',
      suggestedActions: analysisResult.strategy.split(', ')
    },
    workflow: {
      ...state.workflow,
      stage: 'planning',
      currentNode: 'analyze_requirements',
      history: [
        ...state.workflow.history,
        {
          node: 'analyze_requirements',
          timestamp: Date.now(),
          duration: 1500
        }
      ]
    },
    metadata: {
      ...state.metadata,
      updatedAt: Date.now()
    }
  };
}

/**
 * 节点 4: 生成学习计划
 * 生成详细的学习任务列表
 */
async function generateStudyPlan(state) {
  console.log(`📋 [generateStudyPlan] 生成学习计划`);

  const { goal, subjects, availability } = state;

  // 计算总天数和每日任务
  const totalDays = availability.examDistance;
  const dailyHours = availability.dailyHours;

  // 生成任务
  const tasks = [];
  let taskId = 1;

  // 为每个科目生成任务
  for (const subject of subjects) {
    const subjectTasks = Math.ceil((subject.targetLevel - subject.currentLevel) * 3);
    const taskPerDay = Math.ceil(subjectTasks / totalDays);

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

  // 添加复习任务
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

  console.log(`✅ [generateStudyPlan] 生成 ${tasks.length} 个任务`);

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
        {
          node: 'generate_plan',
          timestamp: Date.now(),
          duration: 800
        }
      ]
    },
    metadata: {
      ...state.metadata,
      updatedAt: Date.now()
    }
  };
}

/**
 * 节点 5: 构建 UI Blocks
 * 将计划转换为前端可渲染的 UI Blocks
 */
async function buildUIBlocks(state) {
  console.log(`🎨 [buildUIBlocks] 构建 UI Blocks`);

  const { goal, subjects, tasksSnapshot, availability, riskAssessment, currentPlan } = state;

  // 按日期分组任务
  const tasksByDate = {};
  for (const task of tasksSnapshot) {
    if (!tasksByDate[task.scheduledDate]) {
      tasksByDate[task.scheduledDate] = [];
    }
    tasksByDate[task.scheduledDate].push(task);
  }

  // 获取今日日期的任务
  const today = new Date().toISOString().split('T')[0];
  const todayTasks = tasksSnapshot.filter(t => t.scheduledDate === today);

  const uiBlocks = [
    // 1. 概览卡片 - 使用前端 SummaryCard 期望的格式
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

    // 2. 每日任务列表 - 使用前端 DailyTaskList 期望的格式
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

    // 3. 学习时间线 - 使用前端 StudyTimeline 期望的格式
    {
      id: 'study_timeline',
      type: 'study-timeline',
      title: '学习时间线',
      order: 3,
      props: {
        startDate: new Date().toISOString().split('T')[0],
        endDate: goal.examDate || new Date(Date.now() + availability.examDistance * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        events: Object.entries(tasksByDate).slice(0, 10).map(([date, tasks]) => ({
          date,
          title: `${tasks.length} 个任务`,
          type: 'study_session',
          importance: 'medium'
        }))
      }
    }
  ];

  // 添加风险警告（如果有）
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
          suggestion: riskAssessment.suggestedActions[0] || ''
        }))
      }
    });
  }

  // 添加操作栏
  uiBlocks.push({
    id: 'action_bar',
    type: 'action-bar',
    title: '操作选项',
    order: 99,
    props: {
      actions: [
        {
          id: 'start_today',
          label: '从今天开始',
          type: 'primary',
          onClick: () => console.log('开始学习')
        },
        {
          id: 'adjust_plan',
          label: '调整计划',
          type: 'secondary',
          onClick: () => console.log('调整计划')
        }
      ]
    }
  });

  console.log(`✅ [buildUIBlocks] 生成 ${uiBlocks.length} 个 UI Blocks`);

  return {
    uiBlocks,
    workflow: {
      ...state.workflow,
      stage: 'finalized',
      currentNode: 'build_ui_blocks',
      history: [
        ...state.workflow.history,
        {
          node: 'build_ui_blocks',
          timestamp: Date.now(),
          duration: 200
        }
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
// 工作流图构建
// ============================================================

/**
 * 创建首次计划生成工作流
 * @returns {CompiledStateGraph} 编译后的工作流图
 */
export function createInitialPlanningWorkflow() {
  // 创建状态图，使用定义的状态结构
  const workflow = new StateGraph(StateAnnotation);

  // 添加节点
  workflow.addNode('load_space_context', loadSpaceContext);
  workflow.addNode('collect_missing_info', collectMissingInfo);
  workflow.addNode('analyze_requirements', analyzeStudyRequirements);
  workflow.addNode('generate_plan', generateStudyPlan);
  workflow.addNode('build_ui_blocks', buildUIBlocks);

  // 设置入口点
  workflow.setEntryPoint('load_space_context');

  // 添加边（定义节点之间的连接）
  workflow.addEdge('load_space_context', 'collect_missing_info');

  // 条件边：根据是否中断决定下一步
  workflow.addConditionalEdges(
    'collect_missing_info',
    (state) => {
      // 如果有中断，结束工作流（等待用户输入）
      if (state.interruption?.isInterrupted) {
        console.log('🔴 工作流中断，等待用户输入');
        return 'interrupt';
      }
      // 否则继续
      console.log('🟢 工作流继续执行');
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

  // ✅ 编译工作流，带 checkpointer
  const compiledWorkflow = workflow.compile({ checkpointer });

  console.log('✅ 首次计划生成工作流已构建（支持 checkpointer）');
  return compiledWorkflow;
}

/**
 * 执行工作流（用于直接调用）
 * @param {string} studySpaceId - 学习空间 ID
 * @param {string} userId - 用户 ID
 * @param {Partial<StudySpaceWorkflowState>} initialState - 可选的初始状态
 * @returns {Promise<StudySpaceWorkflowState>}
 */
export async function runInitialPlanning(studySpaceId, userId, initialState = {}, config = {}) {
  console.log(`🚀 启动首次计划生成工作流 [spaceId: ${studySpaceId}]`);

  // 创建初始状态
  const state = {
    ...createInitialState(studySpaceId, userId),
    ...initialState
  };

  // 构建工作流并编译
  const workflow = createInitialPlanningWorkflow();

  // ✅ 执行工作流（使用 checkpointer 配置）
  const result = await workflow.invoke(state, {
    configurable: { thread_id: studySpaceId },
    ...config
  });

  console.log(`✅ 工作流执行完成，最终阶段: ${result.workflow.stage}`);

  return result;
}

export default {
  createInitialPlanningWorkflow,
  runInitialPlanning
};
