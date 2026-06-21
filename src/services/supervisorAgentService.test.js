import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inferFallbackDecision,
  loadLearningPlanData
} from './supervisorAgentService.js';

function buildPersistedPlan(status = 'completed') {
  return {
    plan: {
      id: 'plan-db',
      version: 2,
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now()
    },
    tasks: [{
      id: 'task-db',
      subject: 'Math',
      title: 'Database task',
      type: 'practice',
      priority: 'high',
      status,
      estimatedMinutes: 45,
      scheduledDate: '2026-06-21',
      dependencies: []
    }],
    blocks: []
  };
}

function buildCheckpoint(status = 'pending') {
  return {
    goal: { primaryGoal: 'Pass exam' },
    subjects: [{ id: 'math', name: 'Math', priority: 8 }],
    availability: { weekdays: 2 },
    currentPlan: { planId: 'plan-checkpoint' },
    tasksSnapshot: [{
      id: 'task-checkpoint',
      subjectId: 'math',
      title: 'Checkpoint task',
      status
    }],
    progress: {},
    riskAssessment: { level: 'medium' }
  };
}

test('uses database tasks as the primary status source', async () => {
  const result = await loadLearningPlanData({
    userId: 'user-1',
    spaceId: 'space-1',
    loadPersistedPlan: async (userId, spaceId) => {
      assert.equal(userId, 'user-1');
      assert.equal(spaceId, 'space-1');
      return buildPersistedPlan('completed');
    },
    loadCheckpoint: async () => buildCheckpoint('pending')
  });

  assert.equal(result.currentPlan.planId, 'plan-db');
  assert.equal(result.tasksSnapshot[0].id, 'task-db');
  assert.equal(result.tasksSnapshot[0].status, 'completed');
  assert.equal(result.goal.primaryGoal, 'Pass exam');
});

test('keeps using database data when checkpoint enrichment fails', async () => {
  const result = await loadLearningPlanData({
    userId: 'user-1',
    spaceId: 'space-1',
    studySpaceContext: {
      goal: { primaryGoal: 'Fallback context goal' },
      subjects: []
    },
    loadPersistedPlan: async () => buildPersistedPlan('completed'),
    loadCheckpoint: async () => {
      throw new Error('checkpoint unavailable');
    }
  });

  assert.equal(result.currentPlan.planId, 'plan-db');
  assert.equal(result.tasksSnapshot[0].status, 'completed');
  assert.equal(result.goal.primaryGoal, 'Fallback context goal');
});

test('uses checkpoint when the database has no plan', async () => {
  const checkpoint = buildCheckpoint('in_progress');
  const result = await loadLearningPlanData({
    userId: 'user-1',
    spaceId: 'space-1',
    loadPersistedPlan: async () => null,
    loadCheckpoint: async () => checkpoint
  });

  assert.equal(result.tasksSnapshot[0].id, 'task-checkpoint');
  assert.equal(result.tasksSnapshot[0].status, 'in_progress');
});

test('falls back to checkpoint when the database read fails', async () => {
  const checkpoint = buildCheckpoint('failed');
  const result = await loadLearningPlanData({
    userId: 'user-1',
    spaceId: 'space-1',
    loadPersistedPlan: async () => {
      throw new Error('database unavailable');
    },
    loadCheckpoint: async () => checkpoint
  });

  assert.equal(result.tasksSnapshot[0].status, 'failed');
});

test('returns no task data when neither source has a plan', async () => {
  const result = await loadLearningPlanData({
    userId: 'user-1',
    spaceId: 'space-1',
    loadPersistedPlan: async () => null,
    loadCheckpoint: async () => null
  });

  assert.equal(result, null);
});

test('fallback routes read-only learning-plan requests to their domain intents', () => {
  const cases = [
    ['查看今天的计划', 'query_plan'],
    ['为什么今天安排数学', 'explain_plan'],
    ['进度怎么样，下一步做什么', 'progress_next_step']
  ];

  for (const [content, expectedIntent] of cases) {
    const decision = inferFallbackDecision([{ role: 'user', content }]);
    assert.equal(decision.intent, expectedIntent);
  }
});
