import * as planPersistenceService from '../services/planPersistenceService.js';
import { PersistenceError } from '../services/planPersistenceService.js';

function sendSuccess(res, data, status = 200) {
  return res.status(status).json({
    success: true,
    data,
    error: null,
  });
}

function sendError(res, error) {
  const status = error instanceof PersistenceError ? error.status : 500;
  const code = error instanceof PersistenceError ? error.code : 'INTERNAL_SERVER_ERROR';

  if (!(error instanceof PersistenceError)) {
    console.error(error);
  }

  return res.status(status).json({
    success: false,
    data: null,
    error: {
      message: error.message || 'Internal server error',
      code,
    },
  });
}

export async function createPlan(req, res) {
  try {
    const data = await planPersistenceService.savePlanSnapshot(req.userId, req.body);
    return sendSuccess(res, data, 201);
  } catch (error) {
    return sendError(res, error);
  }
}

export async function activatePlan(req, res) {
  try {
    const data = await planPersistenceService.activatePlan(req.userId, req.params.planId);
    return sendSuccess(res, data);
  } catch (error) {
    return sendError(res, error);
  }
}

export async function getLatestPlanBySpace(req, res) {
  try {
    const data = await planPersistenceService.getLatestPlanBySpace(req.userId, req.params.spaceId);
    return sendSuccess(res, data);
  } catch (error) {
    return sendError(res, error);
  }
}

export async function getPlanById(req, res) {
  try {
    const data = await planPersistenceService.getPlanById(req.userId, req.params.planId);
    return sendSuccess(res, data);
  } catch (error) {
    return sendError(res, error);
  }
}

export async function updateTaskStatus(req, res) {
  try {
    const data = await planPersistenceService.updateTaskStatus(
      req.userId,
      req.params.taskId,
      req.body.status
    );
    return sendSuccess(res, data);
  } catch (error) {
    return sendError(res, error);
  }
}

export async function upsertExecution(req, res) {
  try {
    const data = await planPersistenceService.upsertExecution(
      req.userId,
      req.params.spaceId,
      req.body
    );
    return sendSuccess(res, data, 201);
  } catch (error) {
    return sendError(res, error);
  }
}

export async function getLatestExecutionBySpace(req, res) {
  try {
    const data = await planPersistenceService.getLatestExecutionBySpace(
      req.userId,
      req.params.spaceId
    );
    return sendSuccess(res, data);
  } catch (error) {
    return sendError(res, error);
  }
}

export async function deletePlansBySpace(req, res) {
  try {
    const data = await planPersistenceService.deletePlansBySpace(
      req.userId,
      req.params.spaceId
    );
    return sendSuccess(res, data);
  } catch (error) {
    return sendError(res, error);
  }
}

export default {
  createPlan,
  activatePlan,
  getLatestPlanBySpace,
  getPlanById,
  updateTaskStatus,
  upsertExecution,
  getLatestExecutionBySpace,
  deletePlansBySpace,
};
