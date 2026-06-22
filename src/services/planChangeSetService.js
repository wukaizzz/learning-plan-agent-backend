import { randomUUID } from 'crypto';
import { config } from '../config.js';
import * as planChangeSetRepository from '../repositories/planChangeSetRepository.js';
import * as planRepository from '../repositories/planRepository.js';
import { buildPlanBlocks } from './planBlockBuilder.js';
import { buildRescheduleProposal } from './rescheduleProposalService.js';
import { PersistenceError } from './planPersistenceService.js';
import { loadWorkflowPlan } from './workflowPlanPersistence.js';

const CHANGE_SET_TTL_MS = 2 * 60 * 60 * 1000;

function requireDatabase() {
  if (!config.database.enabled) {
    throw new PersistenceError(
      'Plan change sets require PostgreSQL.',
      'DATABASE_REQUIRED',
      503
    );
  }
}

function toRuntimeTasks(snapshot, subjects = []) {
  const subjectIds = new Map(subjects.map(subject => [subject.name, subject.id]));
  return snapshot.tasks.map(task => ({
    ...task,
    subjectId: subjectIds.get(task.subject) || task.subject,
    subjectName: task.subject,
    priority: task.priority === 'high' ? 8 : task.priority === 'medium' ? 6 : 3
  }));
}

function toPersistenceBlocks(blocks, planId, spaceId, taskIds, now) {
  return blocks.map((block, order) => {
    const { tasks, scheduleGroups, ...scalarProps } = block.props || {};
    return {
      id: block.id,
      planId,
      spaceId,
      type: block.type,
      title: block.title,
      taskIds: block.type === 'daily-task-list' ? taskIds : [],
      props: scalarProps,
      order,
      createdAt: now,
      updatedAt: now
    };
  });
}

export function buildAppliedSnapshot(changeSet, currentPlanRow) {
  const now = Date.now();
  const planId = `plan_${changeSet.spaceId}_${now}_${randomUUID().slice(0, 8)}`;
  const idMap = new Map(
    changeSet.proposedTasks.map((task, index) => [
      task.id || task.taskId,
      `${planId}:task:${index + 1}`
    ])
  );
  const tasks = changeSet.proposedTasks.map((task, order) => ({
    ...task,
    id: idMap.get(task.id || task.taskId),
    planId,
    spaceId: changeSet.spaceId,
    subject: task.subject || task.subjectName || task.subjectId || '未分类',
    priority: typeof task.priority === 'string'
      ? task.priority
      : task.priority >= 7 ? 'high' : task.priority >= 5 ? 'medium' : 'low',
    dependencies: (task.dependencies || []).map(id => idMap.get(id) || id),
    order,
    createdAt: now,
    updatedAt: now
  }));
  const context = changeSet.contextSnapshot || {};
  const runtimeTasks = tasks.map(task => ({
    ...task,
    subjectId: context.subjects?.find(subject => subject.name === task.subject)?.id || task.subject,
    subjectName: task.subject,
    priority: task.priority === 'high' ? 8 : task.priority === 'medium' ? 6 : 3
  }));
  const version = Number(currentPlanRow.version) + 1;
  const uiBlocks = buildPlanBlocks({
    planId,
    planVersion: version,
    goal: context.goal,
    subjects: context.subjects,
    availability: context.availability,
    tasksSnapshot: runtimeTasks,
    riskAssessment: context.riskAssessment,
    persisted: true
  });

  return {
    plan: {
      id: planId,
      spaceId: changeSet.spaceId,
      title: currentPlanRow.title,
      status: 'active',
      version,
      sourceSessionId: currentPlanRow.source_session_id ?? undefined,
      sourceMessageId: currentPlanRow.source_message_id ?? undefined,
      createdAt: now,
      updatedAt: now
    },
    tasks,
    blocks: toPersistenceBlocks(uiBlocks, planId, changeSet.spaceId, tasks.map(task => task.id), now)
  };
}

export async function proposeReschedule(userId, spaceId, request, planData) {
  requireDatabase();
  const persistedPlan = await loadWorkflowPlan(userId, spaceId);
  if (!persistedPlan) {
    throw new PersistenceError('Current plan not found', 'PLAN_NOT_FOUND', 404);
  }
  const contextSnapshot = {
    goal: planData?.goal || {},
    subjects: planData?.subjects || [],
    availability: planData?.availability || {},
    riskAssessment: planData?.riskAssessment || {}
  };
  const proposal = buildRescheduleProposal({
    ...contextSnapshot,
    tasksSnapshot: toRuntimeTasks(persistedPlan, contextSnapshot.subjects)
  }, request);
  const now = Date.now();
  return planChangeSetRepository.createChangeSet(userId, {
    id: `change_${spaceId}_${now}_${randomUUID().slice(0, 8)}`,
    spaceId,
    sourcePlanId: persistedPlan.plan.id,
    sourcePlanVersion: persistedPlan.plan.version,
    type: 'reschedule',
    status: 'pending',
    request,
    changes: proposal.changes,
    impact: proposal.impact,
    validation: proposal.validation,
    proposedTasks: proposal.proposedTasks,
    contextSnapshot,
    expiresAt: now + CHANGE_SET_TTL_MS,
    createdAt: now,
    updatedAt: now
  });
}

export async function getPendingChangeSet(userId, spaceId) {
  requireDatabase();
  const changeSet = await planChangeSetRepository.getLatestPendingBySpace(userId, spaceId);
  if (!changeSet) return null;
  return {
    changeSetId: changeSet.id,
    sourcePlanId: changeSet.sourcePlanId,
    sourcePlanVersion: changeSet.sourcePlanVersion,
    expiresAt: changeSet.expiresAt,
    canApply: changeSet.validation?.valid === true,
    uiBlock: toPreviewBlock(changeSet)
  };
}

export async function rejectChangeSet(userId, changeSetId) {
  requireDatabase();
  const result = await planChangeSetRepository.rejectChangeSet(userId, changeSetId);
  if (!result) throw new PersistenceError('Change set not found', 'CHANGE_SET_NOT_FOUND', 404);
  return result;
}

export async function applyChangeSet(userId, changeSetId, {
  expectedPlanId,
  expectedPlanVersion,
  idempotencyKey
}) {
  requireDatabase();
  if (!idempotencyKey) {
    throw new PersistenceError('idempotencyKey is required', 'VALIDATION_ERROR', 400);
  }

  const transactionResult = await planChangeSetRepository.withLockedChangeSet(
    userId,
    changeSetId,
    async ({ client, changeSet }) => {
      const prior = await planChangeSetRepository.findAppliedByIdempotency(
        client,
        userId,
        idempotencyKey
      );
      if (prior) return { resultPlanId: prior.resultPlanId, idempotent: true };
      if (!changeSet) return { error: ['CHANGE_SET_NOT_FOUND', 404] };
      if (changeSet.status === 'applied') {
        if (changeSet.applyIdempotencyKey === idempotencyKey) {
          return { resultPlanId: changeSet.resultPlanId, idempotent: true };
        }
        return { error: ['CHANGE_SET_ALREADY_APPLIED', 409] };
      }
      if (changeSet.status !== 'pending') return { error: ['CHANGE_SET_NOT_PENDING', 409] };
      if (changeSet.expiresAt <= Date.now()) {
        await client.query(
          `UPDATE public.plan_change_sets SET status = 'expired', updated_at_ms = $3
           WHERE user_id = $1 AND id = $2`,
          [userId, changeSetId, Date.now()]
        );
        return { error: ['CHANGE_SET_EXPIRED', 409] };
      }
      if (!changeSet.validation?.valid) return { error: ['CHANGE_SET_NOT_APPLICABLE', 409] };

      const currentPlan = await planChangeSetRepository.getCurrentPlanForUpdate(
        client,
        userId,
        changeSet.spaceId
      );
      const matches =
        currentPlan &&
        currentPlan.id === expectedPlanId &&
        Number(currentPlan.version) === Number(expectedPlanVersion) &&
        currentPlan.id === changeSet.sourcePlanId &&
        Number(currentPlan.version) === Number(changeSet.sourcePlanVersion);
      if (!matches) {
        await planChangeSetRepository.markInvalidated(client, userId, changeSetId, Date.now());
        return { error: ['PLAN_VERSION_CONFLICT', 409] };
      }

      const snapshot = buildAppliedSnapshot(changeSet, currentPlan);
      const saved = await planRepository.savePlanSnapshotWithClient(client, userId, snapshot);
      await planChangeSetRepository.markApplied(client, userId, changeSetId, {
        resultPlanId: saved.plan.id,
        idempotencyKey,
        now: Date.now()
      });
      return { snapshot: saved, resultPlanId: saved.plan.id };
    }
  );

  if (transactionResult.error) {
    const [code, status] = transactionResult.error;
    throw new PersistenceError(code, code, status);
  }
  if (transactionResult.snapshot) return transactionResult.snapshot;
  return planRepository.getPlanById(userId, transactionResult.resultPlanId);
}

export function toPreviewBlock(changeSet) {
  return {
    id: `plan_change_preview_${changeSet.id}`,
    type: 'plan-change-preview',
    title: '计划调整预览',
    props: {
      changeSetId: changeSet.id,
      sourcePlanId: changeSet.sourcePlanId,
      sourcePlanVersion: changeSet.sourcePlanVersion,
      expiresAt: changeSet.expiresAt,
      reason: changeSet.request?.reason || '调整学习计划',
      canApply: changeSet.validation?.valid === true,
      changes: changeSet.changes,
      impact: changeSet.impact,
      unscheduled: changeSet.validation?.unscheduled || [],
      command: 'apply_plan_change_set'
    },
    meta: {
      timestamp: changeSet.createdAt,
      version: String(changeSet.sourcePlanVersion)
    }
  };
}
