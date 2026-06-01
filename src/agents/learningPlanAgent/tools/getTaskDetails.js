import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

const TaskDetailsSchema = z.object({
  taskId: z.string().describe('Task id to inspect.')
});

function getTasks(planData = {}) {
  return Array.isArray(planData.tasksSnapshot) ? planData.tasksSnapshot : [];
}

function getSubjects(planData = {}) {
  return Array.isArray(planData.subjects) ? planData.subjects : [];
}

function getTaskId(task = {}) {
  return task.id || task.taskId;
}

export const getTaskDetailsTool = new DynamicStructuredTool({
  name: 'get_task_details',
  description: 'Return full details for one existing study task by taskId. Read-only.',
  schema: TaskDetailsSchema,
  func: async () => JSON.stringify({})
});

export function executeGetTaskDetails(args = {}, planData = {}) {
  const task = getTasks(planData).find(item => getTaskId(item) === args.taskId);

  if (!task) {
    return JSON.stringify({
      found: false,
      taskId: args.taskId,
      message: 'Task not found in current planData.tasksSnapshot.'
    });
  }

  const subject = getSubjects(planData).find(item => item.id === task.subjectId);
  return JSON.stringify({
    found: true,
    task: {
      ...task,
      id: getTaskId(task),
      subjectName: task.subjectName || subject?.name,
      scheduledDate: task.scheduledDate || task.date || task.startDate,
      estimatedMinutes: Number(task.estimatedMinutes ?? task.duration ?? 0) || 0
    }
  });
}

