import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAppliedSnapshot } from './planChangeSetService.js';
import { getAgentToolsForIntent } from '../agents/learningPlanAgent/tools/index.js';

test('limits adjust and replan intents to their intended rescheduling tools', () => {
  assert.deepEqual(
    getAgentToolsForIntent('adjust_plan').map(tool => tool.name),
    ['search_tasks', 'propose_reschedule_tasks']
  );
  assert.deepEqual(
    getAgentToolsForIntent('replan').map(tool => tool.name),
    ['search_tasks', 'preview_reschedule_tasks']
  );
});

test('clones a proposal into new plan/task ids and remaps dependencies and block references', () => {
  const snapshot = buildAppliedSnapshot({
    spaceId: 'space-1',
    proposedTasks: [
      {
        id: 'old-a',
        subject: 'Math',
        title: 'A',
        type: 'study',
        priority: 8,
        status: 'pending',
        estimatedMinutes: 60,
        scheduledDate: '2026-06-22',
        dependencies: []
      },
      {
        id: 'old-b',
        subject: 'Math',
        title: 'B',
        type: 'practice',
        priority: 7,
        status: 'pending',
        estimatedMinutes: 60,
        scheduledDate: '2026-06-23',
        dependencies: ['old-a']
      }
    ],
    contextSnapshot: {
      goal: { primaryGoal: 'Exam', examDate: '2026-07-01' },
      subjects: [{ id: 'math', name: 'Math', currentLevel: 5, targetLevel: 8, priority: 'high' }],
      availability: { dailyHours: 2, examDistance: 10 },
      riskAssessment: { level: 'low', factors: [] }
    }
  }, {
    id: 'old-plan',
    title: 'Plan',
    version: 1,
    source_session_id: null,
    source_message_id: null
  });

  assert.notEqual(snapshot.plan.id, 'old-plan');
  assert.equal(snapshot.plan.version, 2);
  assert.ok(snapshot.tasks.every(task => task.planId === snapshot.plan.id));
  assert.notEqual(snapshot.tasks[0].id, 'old-a');
  assert.deepEqual(snapshot.tasks[1].dependencies, [snapshot.tasks[0].id]);
  const dailyBlock = snapshot.blocks.find(block => block.type === 'daily-task-list');
  assert.deepEqual(dailyBlock.taskIds, snapshot.tasks.map(task => task.id));
});
