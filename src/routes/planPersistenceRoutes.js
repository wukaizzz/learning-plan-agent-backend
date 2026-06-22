import express from 'express';
import { resolveUser } from '../middleware/resolveUser.js';
import {
  activatePlan,
  createPlan,
  deletePlansBySpace,
  getLatestExecutionBySpace,
  getLatestPlanBySpace,
  getPlanById,
  updateTaskStatus,
  upsertExecution,
  getPendingPlanChangeSet,
  applyPlanChangeSet,
  rejectPlanChangeSet,
} from '../controllers/planPersistenceController.js';

const router = express.Router();

router.use(resolveUser);

router.post('/plans', createPlan);
router.patch('/plans/:planId/activate', activatePlan);
router.get('/plans/:planId', getPlanById);

router.get('/spaces/:spaceId/plans/latest', getLatestPlanBySpace);
router.delete('/spaces/:spaceId/plans', deletePlansBySpace);
router.post('/spaces/:spaceId/executions', upsertExecution);
router.get('/spaces/:spaceId/executions/latest', getLatestExecutionBySpace);
router.get('/spaces/:spaceId/plan-change-sets/pending', getPendingPlanChangeSet);
router.post('/plan-change-sets/:changeSetId/apply', applyPlanChangeSet);
router.post('/plan-change-sets/:changeSetId/reject', rejectPlanChangeSet);

router.patch('/tasks/:taskId/status', updateTaskStatus);

export default router;
