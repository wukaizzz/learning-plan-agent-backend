import { searchTasksTool, executeSearchTasks } from './searchTasks.js';
import { getScheduleOverviewTool, executeGetScheduleOverview } from './getScheduleOverview.js';
import { getTaskDetailsTool, executeGetTaskDetails } from './getTaskDetails.js';
import { previewRescheduleTasksTool, executePreviewRescheduleTasks } from './previewRescheduleTasks.js';
import { getProgressSummaryTool, executeGetProgressSummary } from './getProgressSummary.js';

export const agentTools = [
  searchTasksTool,
  getScheduleOverviewTool,
  getTaskDetailsTool,
  getProgressSummaryTool,
  previewRescheduleTasksTool
];

export const toolExecutors = {
  search_tasks: executeSearchTasks,
  get_schedule_overview: executeGetScheduleOverview,
  get_task_details: executeGetTaskDetails,
  get_progress_summary: executeGetProgressSummary,
  preview_reschedule_tasks: executePreviewRescheduleTasks
};

export {
  searchTasksTool,
  getScheduleOverviewTool,
  getTaskDetailsTool,
  getProgressSummaryTool,
  previewRescheduleTasksTool,
  executeSearchTasks,
  executeGetScheduleOverview,
  executeGetTaskDetails,
  executeGetProgressSummary,
  executePreviewRescheduleTasks
};
