import { searchTasksTool, executeSearchTasks } from './searchTasks.js';
import { getScheduleOverviewTool, executeGetScheduleOverview } from './getScheduleOverview.js';
import { getTaskDetailsTool, executeGetTaskDetails } from './getTaskDetails.js';
import { previewRescheduleTasksTool, executePreviewRescheduleTasks } from './previewRescheduleTasks.js';

export const agentTools = [
  searchTasksTool,
  getScheduleOverviewTool,
  getTaskDetailsTool,
  previewRescheduleTasksTool
];

export const toolExecutors = {
  search_tasks: executeSearchTasks,
  get_schedule_overview: executeGetScheduleOverview,
  get_task_details: executeGetTaskDetails,
  preview_reschedule_tasks: executePreviewRescheduleTasks
};

export {
  searchTasksTool,
  getScheduleOverviewTool,
  getTaskDetailsTool,
  previewRescheduleTasksTool,
  executeSearchTasks,
  executeGetScheduleOverview,
  executeGetTaskDetails,
  executePreviewRescheduleTasks
};

