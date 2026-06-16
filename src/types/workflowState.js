/**
 * LangGraph 工作流 State 定义
 * 用于学习空间 Agent 系统的状态管理
 */

/**
 * @typedef {Object} UIBlock
 * @property {string} id - Block 唯一标识
 * @property {'summary-card' | 'study-timeline' | 'daily-task-list' | 'progress-panel' | 'risk-alert' | 'action-bar' | 'collection-form' | 'explanation-card' | 'version-comparison'} type - Block 类型
 * @property {string} [title] - Block 标题
 * @property {Record<string, any>} props - Block 属性
 * @property {number} [order] - 渲染顺序
 */

/**
 * @typedef {Object} WorkflowState
 * @property {'initializing' | 'collecting_info' | 'analyzing' | 'planning' | 'reviewing' | 'replanning' | 'finalized' | 'paused'} stage - 当前阶段
 * @property {string} currentNode - 当前所在节点
 * @property {WorkflowHistoryItem[]} history - 工作流历史记录
 */

/**
 * @typedef {Object} WorkflowHistoryItem
 * @property {string} node - 节点名称
 * @property {number} timestamp - 时间戳
 * @property {number} duration - 持续时间（毫秒）
 */

/**
 * @typedef {Object} GoalInfo
 * @property {string} primaryGoal - 主要目标
 * @property {string} [examDate] - 考试/截止日期
 * @property {number} [targetScore] - 目标分数
 * @property {number} priority - 优先级 1-10
 */

/**
 * @typedef {Object} SubjectInfo
 * @property {string} id - 科目 ID
 * @property {string} name - 科目名称
 * @property {number} currentLevel - 当前水平 1-10
 * @property {number} targetLevel - 目标水平
 * @property {'high' | 'medium' | 'low'} priority - 优先级
 * @property {string[]} [weakPoints] - 薄弱知识点
 */

/**
 * @typedef {Object} AvailabilityInfo
 * @property {number} dailyHours - 每日可用小时数
 * @property {string[]} [preferredSlots] - 偏好时间段
 * @property {string[]} [unavailableDates] - 不可用日期
 * @property {number} examDistance - 距离考试天数
 */

/**
 * @typedef {Object} CurrentPlan
 * @property {string} versionId - 版本 ID
 * @property {number} versionNumber - 版本号
 * @property {string} createdAt - 创建时间
 * @property {string} lastModifiedAt - 最后修改时间
 */

/**
 * @typedef {Object} TaskSnapshot
 * @property {string} id - 任务 ID
 * @property {string} subjectId - 科目 ID
 * @property {string} title - 任务标题
 * @property {'study' | 'practice' | 'review'} type - 任务类型
 * @property {number} estimatedMinutes - 预估分钟数
 * @property {string} scheduledDate - 计划日期
 * @property {number} priority - 优先级
 * @property {'pending' | 'in_progress' | 'completed' | 'skipped' | 'failed'} status - 状态
 * @property {string[]} [dependencies] - 依赖的任务 ID
 */

/**
 * @typedef {Object} ProgressInfo
 * @property {number} completedTasks - 已完成任务数
 * @property {number} totalTasks - 总任务数
 * @property {number} overallCompletionRate - 整体完成率 0-1
 * @property {Record<string, SubjectProgress>} subjectProgress - 各科进度
 * @property {string[]} recentWeakPoints - 最近暴露的薄弱点
 */

/**
 * @typedef {Object} SubjectProgress
 * @property {number} completed - 已完成数
 * @property {number} total - 总数
 * @property {number} accuracy - 正确率
 */

/**
 * @typedef {Object} RiskFactor
 * @property {'time_pressure' | 'low_accuracy' | 'falling_behind' | 'resource_overload'} type - 因素类型
 * @property {string} description - 描述
 * @property {number} severity - 严重程度 1-10
 */

/**
 * @typedef {Object} RiskAssessment
 * @property {'low' | 'medium' | 'high' | 'critical'} level - 风险等级
 * @property {RiskFactor[]} factors - 风险因素
 * @property {string} prediction - 风险预测文本
 * @property {string[]} suggestedActions - 建议措施
 */

/**
 * @typedef {Object} InterruptionInfo
 * @property {boolean} isInterrupted - 是否中断
 * @property {string} [reason] - 中断原因
 * @property {WaitingForInfo} [waitingFor] - 等待用户输入的信息
 */

/**
 * @typedef {Object} WaitingForInfo
 * @property {string} field - 字段名称
 * @property {string} question - 问题
 * @property {'text' | 'date' | 'select' | 'number'} type - 输入类型
 * @property {string[]} [options] - 选项
 */

/**
 * @typedef {Object} Metadata
 * @property {number} createdAt - 创建时间
 * @property {number} updatedAt - 更新时间
 * @property {number} lastActivityAt - 最后活动时间
 * @property {number} totalReplans - 总重规划次数
 */

/**
 * @typedef {Object} StudySpaceWorkflowState
 * @property {string} studySpaceId - 学习空间 ID（用作 thread_id）
 * @property {string} userId - 用户 ID
 * @property {GoalInfo} goal - 学习目标
 * @property {SubjectInfo[]} subjects - 学科信息
 * @property {AvailabilityInfo} availability - 时间约束
 * @property {CurrentPlan|null} currentPlan - 当前计划
 * @property {TaskSnapshot[]} tasksSnapshot - 任务快照
 * @property {ProgressInfo} progress - 执行进度
 * @property {RiskAssessment} riskAssessment - 风险评估
 * @property {WorkflowState} workflow - 工作流状态
 * @property {UIBlock[]} uiBlocks - UI 输出
 * @property {InterruptionInfo|null} interruption - 中断状态
 * @property {Metadata} metadata - 元数据
 */

// 导出初始状态创建函数
/**
 * 创建初始工作流状态
 * @param {string} studySpaceId - 学习空间 ID
 * @param {string} userId - 用户 ID
 * @returns {StudySpaceWorkflowState}
 */
export function createInitialState(studySpaceId, userId) {
  return {
    studySpaceId,
    userId,
    goal: {
      primaryGoal: '',
      priority: 5
    },
    subjects: [],
    availability: {
      dailyHours: 2,
      examDistance: 30
    },
    currentPlan: null,
    tasksSnapshot: [],
    progress: {
      completedTasks: 0,
      totalTasks: 0,
      overallCompletionRate: 0,
      subjectProgress: {},
      recentWeakPoints: []
    },
    riskAssessment: {
      level: 'low',
      factors: [],
      prediction: '',
      suggestedActions: []
    },
    workflow: {
      stage: 'initializing',
      currentNode: '',
      history: []
    },
    uiBlocks: [],
    interruption: null,
    metadata: {
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastActivityAt: Date.now(),
      totalReplans: 0
    }
  };
}

export default {
  createInitialState
};
