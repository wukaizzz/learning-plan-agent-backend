import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TASK_STATUSES = ['pending', 'in_progress', 'completed', 'skipped', 'failed'];

const ScheduleOverviewSchema = z.object({
  dateFrom: z.string().regex(DATE_PATTERN).optional()
    .describe('Inclusive start date in YYYY-MM-DD format. Defaults to today.'),
  dateTo: z.string().regex(DATE_PATTERN).optional()
    .describe('Inclusive end date in YYYY-MM-DD format. Defaults to dateFrom.')
}).refine(
  value => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo,
  { message: 'dateFrom must be before or equal to dateTo.' }
);

function getTasks(planData = {}) {
  return Array.isArray(planData.tasksSnapshot) ? planData.tasksSnapshot : [];
}

function getSubjects(planData = {}) {
  return Array.isArray(planData.subjects) ? planData.subjects : [];
}

function getTaskDate(task = {}) {
  return task.scheduledDate || task.date || task.startDate || '';
}

function getTaskMinutes(task = {}) {
  return Number(task.estimatedMinutes ?? task.duration ?? 0) || 0;
}

function getLocalDateString() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function requireValidDate(value, field) {
  if (!DATE_PATTERN.test(value)) {
    throw new Error(`${field} must use YYYY-MM-DD format.`);
  }
}

function normalizeRange(args = {}) {
  const today = getLocalDateString();
  const dateFrom = args.dateFrom || args.dateTo || today;
  const dateTo = args.dateTo || dateFrom;
  requireValidDate(dateFrom, 'dateFrom');
  requireValidDate(dateTo, 'dateTo');
  if (dateFrom > dateTo) {
    throw new Error('dateFrom must be before or equal to dateTo.');
  }
  return { dateFrom, dateTo };
}

function getDayCount(dateFrom, dateTo) {
  const start = Date.parse(`${dateFrom}T00:00:00Z`);
  const end = Date.parse(`${dateTo}T00:00:00Z`);
  return Math.floor((end - start) / 86_400_000) + 1;
}

function formatWeekday(date) {
  return new Intl.DateTimeFormat('zh-CN', {
    weekday: 'short',
    timeZone: 'UTC'
  }).format(new Date(`${date}T00:00:00Z`));
}

function normalizePriority(priority) {
  if (priority === 'high' || priority === 'medium' || priority === 'low') {
    return priority;
  }
  const numericPriority = Number(priority) || 0;
  if (numericPriority >= 7) return 'high';
  if (numericPriority >= 5) return 'medium';
  return 'low';
}

function normalizeStatus(status) {
  return TASK_STATUSES.includes(status) ? status : 'pending';
}

function normalizeTask(task, subjects, originalIndex) {
  const subject = subjects.find(item => item.id === task.subjectId);
  return {
    id: task.id || task.taskId,
    order: Number.isInteger(task.order) ? task.order : originalIndex,
    title: task.title || '未命名任务',
    subjectId: task.subjectId,
    subjectName: task.subjectName || task.subject || subject?.name || '未分类',
    type: task.type || 'study',
    status: normalizeStatus(task.status),
    priority: normalizePriority(task.priority),
    scheduledDate: getTaskDate(task),
    estimatedMinutes: getTaskMinutes(task),
    ...(task.estimatedTime ? { estimatedTime: task.estimatedTime } : {})
  };
}

function createSummary() {
  return {
    totalTasks: 0,
    totalMinutes: 0,
    pendingTasks: 0,
    inProgressTasks: 0,
    completedTasks: 0,
    skippedTasks: 0,
    failedTasks: 0
  };
}

function addTaskToSummary(summary, task) {
  summary.totalTasks += 1;
  summary.totalMinutes += task.estimatedMinutes;
  if (task.status === 'pending') summary.pendingTasks += 1;
  if (task.status === 'in_progress') summary.inProgressTasks += 1;
  if (task.status === 'completed') summary.completedTasks += 1;
  if (task.status === 'skipped') summary.skippedTasks += 1;
  if (task.status === 'failed') summary.failedTasks += 1;
}

function inRange(task, { dateFrom, dateTo }) {
  const date = getTaskDate(task);
  if (!date) return false;
  return date >= dateFrom && date <= dateTo;
}

export const getScheduleOverviewTool = new DynamicStructuredTool({
  name: 'get_schedule_overview',
  description: 'Return read-only schedule statistics and concrete task details for a date or date range. Do not call search_tasks again unless the user also requests subject or status filtering.',
  schema: ScheduleOverviewSchema,
  func: async () => JSON.stringify({})
});

export function executeGetScheduleOverview(args = {}, planData = {}) {
  const range = normalizeRange(args);
  const subjects = getSubjects(planData);
  const tasks = getTasks(planData)
    .map((task, index) => normalizeTask(task, subjects, index))
    .filter(task => inRange(task, range))
    .sort((left, right) => {
      const dateOrder = left.scheduledDate.localeCompare(right.scheduledDate);
      if (dateOrder !== 0) return dateOrder;
      const timeOrder = (left.estimatedTime || '99:99').localeCompare(right.estimatedTime || '99:99');
      if (timeOrder !== 0) return timeOrder;
      return left.order - right.order;
    });

  const summary = createSummary();
  const byDate = new Map();

  for (const task of tasks) {
    addTaskToSummary(summary, task);
    if (!byDate.has(task.scheduledDate)) {
      byDate.set(task.scheduledDate, {
        date: task.scheduledDate,
        weekday: formatWeekday(task.scheduledDate),
        summary: createSummary(),
        tasks: []
      });
    }
    const day = byDate.get(task.scheduledDate);
    addTaskToSummary(day.summary, task);
    day.tasks.push(task);
  }

  return JSON.stringify({
    range: {
      ...range,
      dayCount: getDayCount(range.dateFrom, range.dateTo)
    },
    plan: {
      planId: planData.currentPlan?.planId,
      planVersion: planData.currentPlan?.versionNumber,
      updatedAt: planData.currentPlan?.lastModifiedAt
    },
    summary,
    days: [...byDate.values()]
  });
}

function getBlockTitle(result) {
  if (result.range.dayCount > 1) return '学习日程';
  return result.range.dateFrom === getLocalDateString()
    ? '今日学习任务'
    : `${Number(result.range.dateFrom.slice(5, 7))}月${Number(result.range.dateFrom.slice(8, 10))}日学习任务`;
}

export function buildScheduleTaskListBlock(result, {
  toolCallId,
  queriedAt = Date.now()
} = {}) {
  return {
    id: `schedule-task-list_${toolCallId || queriedAt}`,
    type: 'schedule-task-list',
    title: getBlockTitle(result),
    props: {
      dateFrom: result.range.dateFrom,
      dateTo: result.range.dateTo,
      dayCount: result.range.dayCount,
      queriedAt,
      planId: result.plan?.planId,
      planVersion: result.plan?.planVersion,
      planUpdatedAt: result.plan?.updatedAt,
      summary: result.summary,
      days: result.days,
      readonly: true
    },
    meta: {
      timestamp: queriedAt,
      agent: 'learning-plan-agent',
      ...(result.plan?.planId ? { planId: result.plan.planId } : {}),
      ...(result.plan?.planVersion ? { planVersion: result.plan.planVersion } : {})
    }
  };
}
