// 校验数据格式，将'plan-storage'中的数据转换为标准格式，方便数据库写入

import * as planRepository from '../repositories/planRepository.js';
import * as agentExecutionRepository from '../repositories/agentExecutionRepository.js';
import { retryTransientDatabaseOperation } from '../db/reliability.js';
import { logger } from '../logger/index.js';

const PLAN_STATUSES = new Set(['draft', 'active', 'paused', 'completed', 'archived']);
const TASK_TYPES = new Set(['study', 'practice', 'review']);
const TASK_PRIORITIES = new Set(['high', 'medium', 'low']);
const TASK_STATUSES = new Set(['pending', 'in_progress', 'completed', 'skipped', 'failed']);
const EXECUTION_STATUSES = new Set(['running', 'completed', 'failed', 'cancelled']);

export class PersistenceError extends Error {
  constructor(message, code = 'BAD_REQUEST', status = 400, details = undefined) {
    super(message);
    this.name = 'PersistenceError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function getValue(source, camelKey, snakeKey) {
  return source[camelKey] ?? source[snakeKey];
}

function requireString(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PersistenceError(`${fieldName} is required`, 'VALIDATION_ERROR');
  }

  return value.trim();
}

function optionalString(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value !== 'string') {
    return String(value);
  }

  return value;
}

function requirePositiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new PersistenceError(`${fieldName} must be a positive integer`, 'VALIDATION_ERROR');
  }

  return number;
}

function optionalInteger(value, defaultValue) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  const number = Number(value);
  if (!Number.isInteger(number)) {
    return defaultValue;
  }

  return number;
}

function requireEnum(value, allowed, fieldName) {
  if (typeof value !== 'string' || !allowed.has(value)) {
    throw new PersistenceError(`${fieldName} is invalid`, 'VALIDATION_ERROR');
  }

  return value;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeStringArray(value, fieldName) {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new PersistenceError(`${fieldName} must be an array of strings`, 'VALIDATION_ERROR');
  }

  return value;
}

function normalizeObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value;
}

function normalizeTimestamp(value, fallback = Date.now()) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }

  return Math.trunc(number);
}

function normalizePlan(source, now) {
  const planSource = source.plan && typeof source.plan === 'object'
    ? source.plan
    : source;

  return {
    id: requireString(planSource.id, 'plan.id'),
    spaceId: requireString(getValue(planSource, 'spaceId', 'space_id'), 'plan.spaceId'),
    title: requireString(planSource.title || '学习计划', 'plan.title'),
    status: requireEnum(planSource.status || 'draft', PLAN_STATUSES, 'plan.status'),
    version: requirePositiveInteger(planSource.version || 1, 'plan.version'),
    sourceSessionId: optionalString(getValue(planSource, 'sourceSessionId', 'source_session_id')),
    sourceMessageId: optionalString(getValue(planSource, 'sourceMessageId', 'source_message_id')),
    createdAt: normalizeTimestamp(getValue(planSource, 'createdAt', 'created_at_ms'), now),
    updatedAt: normalizeTimestamp(getValue(planSource, 'updatedAt', 'updated_at_ms'), now),
  };
}

function normalizeTask(task, plan, now) {
  return {
    id: requireString(task.id, 'task.id'),
    planId: requireString(getValue(task, 'planId', 'plan_id') || plan.id, 'task.planId'),
    spaceId: requireString(getValue(task, 'spaceId', 'space_id') || plan.spaceId, 'task.spaceId'),
    subject: requireString(task.subject, 'task.subject'),
    title: requireString(task.title, 'task.title'),
    type: requireEnum(task.type, TASK_TYPES, 'task.type'),
    priority: requireEnum(task.priority, TASK_PRIORITIES, 'task.priority'),
    status: requireEnum(task.status || 'pending', TASK_STATUSES, 'task.status'),
    estimatedMinutes: requirePositiveInteger(
      getValue(task, 'estimatedMinutes', 'estimated_minutes'),
      'task.estimatedMinutes'
    ),
    scheduledDate: requireString(getValue(task, 'scheduledDate', 'scheduled_date'), 'task.scheduledDate'),
    groupLabel: optionalString(getValue(task, 'groupLabel', 'group_label')),
    estimatedTime: optionalString(getValue(task, 'estimatedTime', 'estimated_time')),
    dependencies: normalizeStringArray(task.dependencies, 'task.dependencies'),
    order: optionalInteger(task.order ?? task.sortOrder ?? task.sort_order, 0),
    createdAt: normalizeTimestamp(getValue(task, 'createdAt', 'created_at_ms'), now),
    updatedAt: normalizeTimestamp(getValue(task, 'updatedAt', 'updated_at_ms'), now),
  };
}

function normalizeBlock(block, plan, now) {
  return {
    id: requireString(block.id, 'block.id'),
    planId: requireString(getValue(block, 'planId', 'plan_id') || plan.id, 'block.planId'),
    spaceId: requireString(getValue(block, 'spaceId', 'space_id') || plan.spaceId, 'block.spaceId'),
    type: requireString(block.type, 'block.type'),
    title: requireString(block.title || block.type, 'block.title'),
    taskIds: normalizeStringArray(getValue(block, 'taskIds', 'task_ids'), 'block.taskIds'),
    props: normalizeObject(block.props),
    order: optionalInteger(block.order ?? block.sortOrder ?? block.sort_order, 0),
    createdAt: normalizeTimestamp(getValue(block, 'createdAt', 'created_at_ms'), now),
    updatedAt: normalizeTimestamp(getValue(block, 'updatedAt', 'updated_at_ms'), now),
  };
}

function normalizePlanSnapshot(payload) {
  const now = Date.now();
  const plan = normalizePlan(payload, now);
  const tasks = normalizeArray(payload.tasks).map(task => normalizeTask(task, plan, now));
  const blocks = normalizeArray(payload.blocks).map(block => normalizeBlock(block, plan, now));

  return { plan, tasks, blocks };
}

function normalizeExecution(payload, spaceId) {
  const source = payload.execution && typeof payload.execution === 'object'
    ? payload.execution
    : payload;
  const status = source.status === undefined || source.status === null
    ? undefined
    : requireEnum(source.status, EXECUTION_STATUSES, 'execution.status');

  return {
    executionId: requireString(getValue(source, 'executionId', 'execution_id'), 'execution.executionId'),
    spaceId: requireString(getValue(source, 'spaceId', 'space_id') || spaceId, 'execution.spaceId'),
    sessionId: optionalString(getValue(source, 'sessionId', 'session_id')),
    messageId: optionalString(getValue(source, 'messageId', 'message_id')),
    title: optionalString(source.title),
    status,
    steps: normalizeArray(source.steps),
    summary: optionalString(source.summary),
    rawExecution: normalizeObject(getValue(source, 'rawExecution', 'raw_execution') || source),
    updatedAt: normalizeTimestamp(getValue(source, 'updatedAt', 'updated_at_ms'), Date.now()),
  };
}

export async function savePlanSnapshot(userId, payload) {
  return planRepository.savePlanSnapshot(userId, normalizePlanSnapshot(payload));
}

export async function activatePlan(userId, planId) {
  const result = await planRepository.activatePlan(userId, planId, Date.now());
  if (!result) {
    throw new PersistenceError('Plan not found', 'PLAN_NOT_FOUND', 404);
  }

  return result;
}

export async function getLatestPlanBySpace(userId, spaceId) {
  return planRepository.getLatestPlanBySpace(
    userId,
    requireString(spaceId, 'spaceId')
  );
}

export async function getPlanById(userId, planId) {
  const result = await planRepository.getPlanById(
    userId,
    requireString(planId, 'planId')
  );
  if (!result) {
    throw new PersistenceError('Plan not found', 'PLAN_NOT_FOUND', 404);
  }

  return result;
}

export async function updateTaskStatus(userId, taskId, status) {
  const normalizedTaskId = requireString(taskId, 'taskId');
  const normalizedStatus = requireEnum(status, TASK_STATUSES, 'status');
  const updatedAt = Date.now();
  const result = await retryTransientDatabaseOperation(
    () => planRepository.updateTaskStatus(
      userId,
      normalizedTaskId,
      normalizedStatus,
      updatedAt
    ),
    {
      onRetry: error => logger.warn({
        code: error.code,
        err: error.message,
        taskId: normalizedTaskId,
      }, 'Retrying task status update after transient database error'),
    }
  );

  if (!result) {
    throw new PersistenceError('Task not found', 'TASK_NOT_FOUND', 404);
  }

  return result;
}

export async function upsertExecution(userId, spaceId, payload) {
  return agentExecutionRepository.upsertExecution(
    userId,
    normalizeExecution(payload, spaceId)
  );
}

export async function getLatestExecutionBySpace(userId, spaceId) {
  return agentExecutionRepository.getLatestExecutionBySpace(
    userId,
    requireString(spaceId, 'spaceId')
  );
}

export async function deletePlansBySpace(userId, spaceId) {
  return planRepository.deletePlansBySpace(
    userId,
    requireString(spaceId, 'spaceId')
  );
}

export default {
  savePlanSnapshot,
  activatePlan,
  getLatestPlanBySpace,
  getPlanById,
  updateTaskStatus,
  upsertExecution,
  getLatestExecutionBySpace,
  deletePlansBySpace,
};
