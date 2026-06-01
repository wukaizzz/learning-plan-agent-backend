import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

const SearchTasksSchema = z.object({
  dateFrom: z.string().optional().describe('Inclusive start date in YYYY-MM-DD format.'),
  dateTo: z.string().optional().describe('Inclusive end date in YYYY-MM-DD format.'),
  subjectId: z.string().optional().describe('Subject id or subject name.'),
  status: z.enum(['pending', 'completed', 'in_progress', 'skipped', 'all']).optional(),
  limit: z.number().int().positive().max(100).optional()
});

function getTasks(planData = {}) {
  return Array.isArray(planData.tasksSnapshot) ? planData.tasksSnapshot : [];
}

function getSubjects(planData = {}) {
  return Array.isArray(planData.subjects) ? planData.subjects : [];
}

function getTaskDate(task = {}) {
  return task.scheduledDate || task.date || task.startDate || '';
}

function getTaskId(task = {}) {
  return task.id || task.taskId;
}

function getTaskMinutes(task = {}) {
  return Number(task.estimatedMinutes ?? task.duration ?? 0) || 0;
}

function normalizeTask(task = {}, subjects = []) {
  const subject = subjects.find(item => item.id === task.subjectId);
  return {
    id: getTaskId(task),
    title: task.title,
    subjectId: task.subjectId,
    subjectName: task.subjectName || subject?.name,
    type: task.type,
    priority: task.priority,
    status: task.status || 'unknown',
    scheduledDate: getTaskDate(task),
    estimatedMinutes: getTaskMinutes(task),
    description: task.description
  };
}

function matchesDateRange(task, { dateFrom, dateTo }) {
  const date = getTaskDate(task);
  if (!date) return !dateFrom && !dateTo;
  if (dateFrom && date < dateFrom) return false;
  if (dateTo && date > dateTo) return false;
  return true;
}

function matchesSubject(task, subjectId, subjects) {
  if (!subjectId) return true;
  const subject = subjects.find(item => item.id === task.subjectId);
  const target = subjectId.toLowerCase();
  return [
    task.subjectId,
    task.subjectName,
    subject?.name
  ].filter(Boolean).some(value => String(value).toLowerCase().includes(target));
}

export const searchTasksTool = new DynamicStructuredTool({
  name: 'search_tasks',
  description: 'Search existing study tasks by date range, subject, and status. Read-only.',
  schema: SearchTasksSchema,
  func: async () => JSON.stringify({})
});

export function executeSearchTasks(args = {}, planData = {}) {
  const subjects = getSubjects(planData);
  const limit = Math.min(Number(args.limit) || 30, 100);
  const status = args.status && args.status !== 'all' ? args.status : null;
  const tasks = getTasks(planData)
    .filter(task => matchesDateRange(task, args))
    .filter(task => matchesSubject(task, args.subjectId, subjects))
    .filter(task => !status || (task.status || 'unknown') === status)
    .sort((a, b) => getTaskDate(a).localeCompare(getTaskDate(b)));

  return JSON.stringify({
    filters: {
      dateFrom: args.dateFrom,
      dateTo: args.dateTo,
      subjectId: args.subjectId,
      status: args.status || 'all'
    },
    total: tasks.length,
    returned: Math.min(tasks.length, limit),
    tasks: tasks.slice(0, limit).map(task => normalizeTask(task, subjects))
  });
}

