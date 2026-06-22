import { buildStudyTimeline } from './studyTimelineBuilder.js';

function toISODate(date) {
  return date.toISOString().split('T')[0];
}

function resolveExamDate(goal = {}, availability = {}) {
  if (goal.examDate) return goal.examDate;
  const fallbackDate = new Date();
  fallbackDate.setDate(fallbackDate.getDate() + (availability.examDistance || 0));
  return toISODate(fallbackDate);
}

function calculateDaysRemaining(examDate, availability = {}) {
  const examTime = new Date(examDate).getTime();
  if (Number.isNaN(examTime)) return availability.examDistance || 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.ceil((examTime - today.getTime()) / 86_400_000));
}

function getPriorityWeight(priority) {
  if (typeof priority === 'number') return priority;
  return { high: 3, medium: 2, low: 1 }[priority] || 1;
}

function calculateWeightedCurrentScore(subjects = []) {
  if (!subjects.length) return 0;
  const weighted = subjects.reduce((acc, subject) => {
    const weight = getPriorityWeight(subject.priority);
    return {
      total: acc.total + (subject.currentLevel || 0) * weight,
      weight: acc.weight + weight
    };
  }, { total: 0, weight: 0 });
  return weighted.weight
    ? Math.max(0, Math.min(100, Math.round((weighted.total / weighted.weight) * 10)))
    : 0;
}

function formatScheduleGroupLabel(dateString) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short'
  });
}

function mapTaskStatus(status) {
  return new Set(['pending', 'in_progress', 'completed', 'skipped', 'failed']).has(status)
    ? status
    : 'pending';
}

function mapPriority(priority) {
  if (typeof priority === 'string') return priority;
  return priority >= 7 ? 'high' : priority >= 5 ? 'medium' : 'low';
}

function getTaskSubjectName(task, subjects) {
  if (task.subjectId === 'all') return '综合复习';
  return task.subjectName ||
    subjects.find(subject => subject.id === task.subjectId)?.name ||
    task.subjectId ||
    '未分类';
}

function mapTaskForDailyList(task, subjects) {
  return {
    id: task.id,
    subject: getTaskSubjectName(task, subjects),
    task: task.title,
    duration: task.estimatedMinutes,
    priority: mapPriority(task.priority),
    status: mapTaskStatus(task.status),
    estimatedTime: task.estimatedTime || '',
    scheduledDate: task.scheduledDate,
    groupLabel: task.groupLabel || formatScheduleGroupLabel(task.scheduledDate)
  };
}

function selectDisplayTasks(tasks, today) {
  const sorted = [...tasks].sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
  const overdue = sorted.filter(task =>
    task.status === 'failed' && task.scheduledDate && task.scheduledDate < today
  );
  const todayTasks = sorted.filter(task => task.scheduledDate === today);
  if (overdue.length || todayTasks.length) return [...overdue, ...todayTasks].slice(0, 5);
  const next = sorted.find(task => task.scheduledDate >= today) || sorted[0];
  return next ? sorted.filter(task => task.scheduledDate === next.scheduledDate).slice(0, 5) : [];
}

function buildScheduleGroups(tasks, subjects) {
  const groups = new Map();
  for (const task of [...tasks].sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))) {
    const group = groups.get(task.scheduledDate) || {
      date: task.scheduledDate,
      label: task.groupLabel || formatScheduleGroupLabel(task.scheduledDate),
      tasks: []
    };
    group.tasks.push(mapTaskForDailyList(task, subjects));
    groups.set(task.scheduledDate, group);
  }
  return Array.from(groups.values());
}

function mapRiskType(type) {
  return {
    time_pressure: 'time_pressure',
    low_accuracy: 'low_performance',
    falling_behind: 'behind_schedule',
    resource_overload: 'conflict'
  }[type] || type;
}

export function buildPlanBlocks({
  planId,
  planVersion = 1,
  goal = {},
  subjects = [],
  availability = {},
  tasksSnapshot = [],
  riskAssessment = {},
  persisted = false
}) {
  const today = toISODate(new Date());
  const examDate = resolveExamDate(goal, availability);
  const displayedTasks = selectDisplayTasks(tasksSnapshot, today);
  const displayDate = displayedTasks[0]?.scheduledDate || today;
  const completedCount = tasksSnapshot.filter(task => task.status === 'completed').length;
  const overallProgress = tasksSnapshot.length
    ? Math.round((completedCount / tasksSnapshot.length) * 100)
    : 0;
  const blockMeta = {
    timestamp: Date.now(),
    version: String(planVersion),
    planId,
    planVersion,
    persisted
  };

  const blocks = [
    {
      id: `${planId}:summary_card`,
      type: 'summary-card',
      title: '学习计划概览',
      order: 1,
      meta: blockMeta,
      props: {
        spaceName: '学习计划',
        spaceDescription: goal.primaryGoal || '个性化学习计划',
        primaryGoal: goal.primaryGoal || '完成学习目标',
        targetScore: goal.targetScore || 85,
        currentScore: calculateWeightedCurrentScore(subjects),
        examDate,
        daysRemaining: calculateDaysRemaining(examDate, availability),
        overallProgress,
        subjects: subjects.map(subject => ({
          name: subject.name,
          progress: 0,
          targetLevel: subject.targetLevel
        }))
      }
    },
    {
      id: `${planId}:daily_task_list`,
      type: 'daily-task-list',
      title: '今日任务',
      order: 2,
      meta: blockMeta,
      props: {
        date: displayDate,
        tasks: displayedTasks.map(task => mapTaskForDailyList(task, subjects)),
        totalTaskCount: tasksSnapshot.length,
        displayedTaskCount: displayedTasks.length,
        scheduleGroups: buildScheduleGroups(tasksSnapshot, subjects),
        totalDuration: displayedTasks.reduce((sum, task) => sum + task.estimatedMinutes, 0),
        completionRate: displayedTasks.length
          ? Math.round((displayedTasks.filter(task => task.status === 'completed').length / displayedTasks.length) * 100)
          : 0
      }
    },
    {
      id: `${planId}:study_timeline`,
      type: 'study-timeline',
      title: '学习时间线',
      order: 3,
      meta: blockMeta,
      props: buildStudyTimeline(tasksSnapshot, today, examDate)
    }
  ];

  if (riskAssessment.level !== 'low' && riskAssessment.factors?.length) {
    blocks.push({
      id: `${planId}:risk_alert`,
      type: 'risk-alert',
      title: '风险提示',
      order: 4,
      meta: blockMeta,
      props: {
        risks: riskAssessment.factors.map(factor => ({
          type: mapRiskType(factor.type),
          severity: factor.severity >= 7 ? 'high' : factor.severity >= 4 ? 'medium' : 'low',
          message: factor.description,
          suggestion: riskAssessment.suggestedActions?.[0] || ''
        }))
      }
    });
  }

  return blocks;
}

export default { buildPlanBlocks };
