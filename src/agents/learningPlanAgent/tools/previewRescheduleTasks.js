import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

const PreviewRescheduleSchema = z.object({
  taskIds: z.array(z.string()).optional().describe('Task ids to preview moving.'),
  dateFrom: z.string().optional().describe('Inclusive source start date in YYYY-MM-DD format.'),
  dateTo: z.string().optional().describe('Inclusive source end date in YYYY-MM-DD format.'),
  targetDate: z.string().optional().describe('Preferred target date in YYYY-MM-DD format.'),
  reason: z.string().optional(),
  maxTasks: z.number().int().positive().max(50).optional()
});

function getTasks(planData = {}) {
  return Array.isArray(planData.tasksSnapshot) ? planData.tasksSnapshot : [];
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

function addDays(dateString, days) {
  const match = typeof dateString === 'string'
    ? dateString.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    : null;

  if (match) {
    const source = new Date(Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3])
    ));
    source.setUTCDate(source.getUTCDate() + days);
    return source.toISOString().slice(0, 10);
  }

  const fallback = new Date();
  fallback.setDate(fallback.getDate() + days);
  const local = new Date(fallback.getTime() - fallback.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function selectTasks(args = {}, planData = {}) {
  const taskIds = Array.isArray(args.taskIds) ? new Set(args.taskIds) : null;
  const maxTasks = Math.min(Number(args.maxTasks) || 20, 50);

  return getTasks(planData)
    .filter(task => {
      if (taskIds) return taskIds.has(getTaskId(task));
      const date = getTaskDate(task);
      if (args.dateFrom && date < args.dateFrom) return false;
      if (args.dateTo && date > args.dateTo) return false;
      return true;
    })
    .filter(task => (task.status || 'pending') !== 'completed')
    .sort((a, b) => getTaskDate(a).localeCompare(getTaskDate(b)))
    .slice(0, maxTasks);
}

export const previewRescheduleTasksTool = new DynamicStructuredTool({
  name: 'preview_reschedule_tasks',
  description: 'Create a dry-run rescheduling preview for selected tasks. Does not modify planData or checkpoints.',
  schema: PreviewRescheduleSchema,
  func: async () => JSON.stringify({})
});

export function executePreviewRescheduleTasks(args = {}, planData = {}) {
  const tasks = selectTasks(args, planData);
  const sourceEndDate = args.dateTo || args.dateFrom || tasks.map(getTaskDate).sort().at(-1);
  const baseTargetDate = args.targetDate || addDays(sourceEndDate, 1);

  const preview = tasks.map((task, index) => ({
    taskId: getTaskId(task),
    title: task.title,
    subjectId: task.subjectId,
    estimatedMinutes: getTaskMinutes(task),
    fromDate: getTaskDate(task),
    toDate: addDays(baseTargetDate, Math.floor(index / 3)),
    reason: args.reason || 'dry-run adjustment preview'
  }));

  return JSON.stringify({
    changesApplied: false,
    message: 'This is a dry-run preview only. No task was modified and no checkpoint was written.',
    selectedTaskCount: tasks.length,
    preview
  });
}
