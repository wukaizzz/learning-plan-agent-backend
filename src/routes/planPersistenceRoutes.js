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

router.patch('/tasks/:taskId/status', updateTaskStatus);

export default router;
