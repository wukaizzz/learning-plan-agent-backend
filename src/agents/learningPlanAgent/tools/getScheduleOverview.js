import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

const ScheduleOverviewSchema = z.object({
  dateFrom: z.string().optional().describe('Inclusive start date in YYYY-MM-DD format.'),
  dateTo: z.string().optional().describe('Inclusive end date in YYYY-MM-DD format.')
});

function getTasks(planData = {}) {
  return Array.isArray(planData.tasksSnapshot) ? planData.tasksSnapshot : [];
}

function getTaskDate(task = {}) {
  return task.scheduledDate || task.date || task.startDate || 'unscheduled';
}

function getTaskMinutes(task = {}) {
  return Number(task.estimatedMinutes ?? task.duration ?? 0) || 0;
}

function inRange(task, { dateFrom, dateTo }) {
  const date = getTaskDate(task);
  if (date === 'unscheduled') return !dateFrom && !dateTo;
  if (dateFrom && date < dateFrom) return false;
  if (dateTo && date > dateTo) return false;
  return true;
}

export const getScheduleOverviewTool = new DynamicStructuredTool({
  name: 'get_schedule_overview',
  description: 'Aggregate study tasks by date, including task count, total minutes, and pending count. Read-only.',
  schema: ScheduleOverviewSchema,
  func: async () => JSON.stringify({})
});

export function executeGetScheduleOverview(args = {}, planData = {}) {
  const tasks = getTasks(planData).filter(task => inRange(task, args));
  const byDate = new Map();

  for (const task of tasks) {
    const date = getTaskDate(task);
    const current = byDate.get(date) || {
      date,
      totalTasks: 0,
      totalMinutes: 0,
      pendingTasks: 0,
      completedTasks: 0,
      subjects: {}
    };

    current.totalTasks += 1;
    current.totalMinutes += getTaskMinutes(task);
    if ((task.status || 'pending') === 'completed') {
      current.completedTasks += 1;
    } else {
      current.pendingTasks += 1;
    }
    const subjectId = task.subjectId || 'unknown';
    current.subjects[subjectId] = (current.subjects[subjectId] || 0) + 1;
    byDate.set(date, current);
  }

  const days = [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(day => ({
      ...day,
      subjects: Object.entries(day.subjects).map(([subjectId, taskCount]) => ({ subjectId, taskCount }))
    }));

  return JSON.stringify({
    range: {
      dateFrom: args.dateFrom,
      dateTo: args.dateTo
    },
    totalTasks: tasks.length,
    totalMinutes: tasks.reduce((sum, task) => sum + getTaskMinutes(task), 0),
    pendingTasks: tasks.filter(task => (task.status || 'pending') !== 'completed').length,
    days
  });
}

