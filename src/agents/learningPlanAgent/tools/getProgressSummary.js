import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

const GetProgressSummarySchema = z.object({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    .describe('Date used to calculate overdue and due-today tasks.')
});

function getLocalDateString() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function getTasks(planData = {}) {
  return Array.isArray(planData.tasksSnapshot) ? planData.tasksSnapshot : [];
}

function getTaskDate(task = {}) {
  return task.scheduledDate || task.date || task.startDate || '';
}

function getTaskMinutes(task = {}) {
  return Number(task.estimatedMinutes ?? task.duration ?? 0) || 0;
}

function getTaskPriority(task = {}) {
  return Number(task.priority) || 0;
}

function normalizeNextTask(task = {}) {
  return {
    id: task.id || task.taskId,
    title: task.title,
    subjectId: task.subjectId,
    subjectName: task.subjectName || task.subject,
    status: task.status || 'pending',
    scheduledDate: getTaskDate(task),
    estimatedMinutes: getTaskMinutes(task),
    priority: getTaskPriority(task)
  };
}

export const getProgressSummaryTool = new DynamicStructuredTool({
  name: 'get_progress_summary',
  description: 'Calculate current study-plan progress, overdue work, and next tasks from the latest task snapshot. Read-only.',
  schema: GetProgressSummarySchema,
  func: async () => JSON.stringify({})
});

export function executeGetProgressSummary(args = {}, planData = {}) {
  const asOfDate = args.asOfDate || getLocalDateString();
  const tasks = getTasks(planData);
  const statusCounts = {
    completed: 0,
    pending: 0,
    in_progress: 0,
    skipped: 0,
    failed: 0
  };
  const subjectMap = new Map();
  let overdueTasks = 0;
  let dueTodayTasks = 0;
  let totalPlannedMinutes = 0;
  let completedMinutes = 0;
  let remainingMinutes = 0;

  tasks.forEach(task => {
    const status = task.status || 'pending';
    const date = getTaskDate(task);
    const minutes = getTaskMinutes(task);
    const isExcludedFromRemaining = status === 'completed' || status === 'skipped';

    if (Object.hasOwn(statusCounts, status)) {
      statusCounts[status] += 1;
    }
    if (date === asOfDate) {
      dueTodayTasks += 1;
    }
    if (date && date < asOfDate && !isExcludedFromRemaining) {
      overdueTasks += 1;
    }

    totalPlannedMinutes += minutes;
    if (status === 'completed') {
      completedMinutes += minutes;
    }
    if (!isExcludedFromRemaining) {
      remainingMinutes += minutes;
    }

    const subjectId = task.subjectId || task.subjectName || task.subject || 'unknown';
    const subjectName = task.subjectName || task.subject || task.subjectId || '未分类';
    if (!subjectMap.has(subjectId)) {
      subjectMap.set(subjectId, {
        subjectId,
        subjectName,
        totalTasks: 0,
        completedTasks: 0,
        remainingMinutes: 0
      });
    }
    const subject = subjectMap.get(subjectId);
    subject.totalTasks += 1;
    if (status === 'completed') {
      subject.completedTasks += 1;
    }
    if (!isExcludedFromRemaining) {
      subject.remainingMinutes += minutes;
    }
  });

  const subjectProgress = Array.from(subjectMap.values()).map(subject => ({
    ...subject,
    completionRate: subject.totalTasks
      ? Math.round((subject.completedTasks / subject.totalTasks) * 100)
      : 0
  }));

  const nextTasks = tasks
    .map((task, index) => ({ task, index }))
    .filter(({ task }) => task.status !== 'completed' && task.status !== 'skipped')
    .sort((left, right) => {
      const leftDate = getTaskDate(left.task) || '9999-12-31';
      const rightDate = getTaskDate(right.task) || '9999-12-31';
      const dateOrder = leftDate.localeCompare(rightDate);
      if (dateOrder !== 0) return dateOrder;

      const priorityOrder = getTaskPriority(right.task) - getTaskPriority(left.task);
      if (priorityOrder !== 0) return priorityOrder;

      return left.index - right.index;
    })
    .slice(0, 5)
    .map(({ task }) => normalizeNextTask(task));

  const totalTasks = tasks.length;
  return JSON.stringify({
    asOfDate,
    totalTasks,
    completedTasks: statusCounts.completed,
    pendingTasks: statusCounts.pending,
    inProgressTasks: statusCounts.in_progress,
    skippedTasks: statusCounts.skipped,
    failedTasks: statusCounts.failed,
    overdueTasks,
    dueTodayTasks,
    completionRate: totalTasks
      ? Math.round((statusCounts.completed / totalTasks) * 100)
      : 0,
    totalPlannedMinutes,
    completedMinutes,
    remainingMinutes,
    subjectProgress,
    nextTasks
  });
}
