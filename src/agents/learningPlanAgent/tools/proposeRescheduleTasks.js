import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import {
  proposeReschedule,
  toPreviewBlock
} from '../../../services/planChangeSetService.js';

const ProposeRescheduleSchema = z.object({
  taskIds: z.array(z.string()).optional(),
  dateFrom: z.string().optional().describe('Inclusive source start date in YYYY-MM-DD format.'),
  dateTo: z.string().optional().describe('Inclusive source end date in YYYY-MM-DD format.'),
  targetDate: z.string().optional().describe('Preferred target date in YYYY-MM-DD format.'),
  reason: z.string().optional()
});

export const proposeRescheduleTasksTool = new DynamicStructuredTool({
  name: 'propose_reschedule_tasks',
  description: 'Create and persist a deterministic rescheduling proposal for confirmation. Does not apply the plan change.',
  schema: ProposeRescheduleSchema,
  func: async () => JSON.stringify({})
});

export async function executeProposeRescheduleTasks(args = {}, planData = {}, context = {}) {
  const changeSet = await proposeReschedule(
    context.userId,
    context.studySpaceId,
    args,
    planData
  );
  return JSON.stringify({
    changesApplied: false,
    changeSetId: changeSet.id,
    sourcePlanId: changeSet.sourcePlanId,
    sourcePlanVersion: changeSet.sourcePlanVersion,
    expiresAt: changeSet.expiresAt,
    canApply: changeSet.validation?.valid === true,
    changes: changeSet.changes,
    impact: changeSet.impact,
    validation: changeSet.validation,
    uiBlock: toPreviewBlock(changeSet)
  });
}
