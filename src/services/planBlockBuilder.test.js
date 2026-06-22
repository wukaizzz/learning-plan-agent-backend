import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPlanBlocks } from './planBlockBuilder.js';

test('builds plan-scoped blocks with task references and persisted metadata', () => {
  const blocks = buildPlanBlocks({
    planId: 'plan-2',
    planVersion: 2,
    goal: { primaryGoal: 'Exam', examDate: '2026-07-01', targetScore: 90 },
    subjects: [{ id: 'math', name: 'Math', currentLevel: 5, targetLevel: 8, priority: 'high' }],
    availability: { dailyHours: 2, examDistance: 10 },
    tasksSnapshot: [{
      id: 'task-2',
      subjectId: 'math',
      title: 'Practice',
      estimatedMinutes: 60,
      scheduledDate: '2026-06-23',
      priority: 8,
      status: 'pending'
    }],
    riskAssessment: { level: 'low', factors: [] },
    persisted: true
  });

  assert.deepEqual(blocks.map(block => block.type), [
    'summary-card',
    'daily-task-list',
    'study-timeline'
  ]);
  assert.ok(blocks.every(block => block.id.startsWith('plan-2:')));
  assert.ok(blocks.every(block => block.meta.planVersion === 2 && block.meta.persisted));
  assert.equal(blocks.find(block => block.type === 'daily-task-list').props.scheduleGroups[0].tasks[0].id, 'task-2');
});
