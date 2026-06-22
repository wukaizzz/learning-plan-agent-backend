import { searchTasksTool, executeSearchTasks } from './searchTasks.js';
import { getScheduleOverviewTool, executeGetScheduleOverview } from './getScheduleOverview.js';
import { getTaskDetailsTool, executeGetTaskDetails } from './getTaskDetails.js';
import { previewRescheduleTasksTool, executePreviewRescheduleTasks } from './previewRescheduleTasks.js';
import { getProgressSummaryTool, executeGetProgressSummary } from './getProgressSummary.js';
import { proposeRescheduleTasksTool, executeProposeRescheduleTasks } from './proposeRescheduleTasks.js';

export const agentTools = [
  searchTasksTool,
  getScheduleOverviewTool,
  getTaskDetailsTool,
  getProgressSummaryTool,
  proposeRescheduleTasksTool,
  previewRescheduleTasksTool
];

export function getAgentToolsForIntent(intent) {
  if (intent === 'adjust_plan') {
    return [searchTasksTool, proposeRescheduleTasksTool];
  }
  if (intent === 'replan') {
    return [searchTasksTool, previewRescheduleTasksTool];
  }
  if (intent === 'progress_next_step') {
    return [getProgressSummaryTool, searchTasksTool, getScheduleOverviewTool];
  }
  if (intent === 'explain_plan') {
    return [getTaskDetailsTool, getScheduleOverviewTool, searchTasksTool];
  }
  if (intent === 'query_plan') {
    return [searchTasksTool, getScheduleOverviewTool, getTaskDetailsTool];
  }
  return agentTools;
}

export const toolExecutors = {
  search_tasks: executeSearchTasks,
  get_schedule_overview: executeGetScheduleOverview,
  get_task_details: executeGetTaskDetails,
  get_progress_summary: executeGetProgressSummary,
  propose_reschedule_tasks: executeProposeRescheduleTasks,
  preview_reschedule_tasks: executePreviewRescheduleTasks
};

export {
  searchTasksTool,
  getScheduleOverviewTool,
  getTaskDetailsTool,
  getProgressSummaryTool,
  proposeRescheduleTasksTool,
  previewRescheduleTasksTool,
  executeSearchTasks,
  executeGetScheduleOverview,
  executeGetTaskDetails,
  executeGetProgressSummary,
  executeProposeRescheduleTasks,
  executePreviewRescheduleTasks
};
