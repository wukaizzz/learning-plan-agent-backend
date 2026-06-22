import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRescheduleProposal } from './rescheduleProposalService.js';

function task(id, status, date, subjectId = 'math', dependencies = []) {
  return {
    id,
    title: id,
    status,
    scheduledDate: date,
    subjectId,
    estimatedMinutes: 60,
    priority: 8,
    dependencies
  };
}

test('moves only pending and failed tasks and resets failed to pending', () => {
  const result = buildRescheduleProposal({
    goal: { examDate: '2026-06-30' },
    availability: { dailyHours: 2, unavailableDates: [] },
    tasksSnapshot: [
      task('pending', 'pending', '2026-06-20'),
      task('failed', 'failed', '2026-06-20', 'english'),
      task('active', 'in_progress', '2026-06-20', 'physics'),
      task('done', 'completed', '2026-06-20', 'chemistry')
    ]
  }, {
    dateFrom: '2026-06-20',
    dateTo: '2026-06-20',
    targetDate: '2026-06-22'
  });

  assert.equal(result.canApply, true);
  assert.deepEqual(result.changes.map(change => change.taskId), ['pending', 'failed']);
  assert.equal(result.proposedTasks.find(item => item.id === 'failed').status, 'pending');
  assert.equal(result.proposedTasks.find(item => item.id === 'active').scheduledDate, '2026-06-20');
});

test('honors unavailable dates, capacity, deadline, and dependency order', () => {
  const result = buildRescheduleProposal({
    goal: { examDate: '2026-06-26' },
    availability: { dailyHours: 1, unavailableDates: ['2026-06-22'] },
    tasksSnapshot: [
      task('dependency', 'pending', '2026-06-20'),
      task('dependent', 'pending', '2026-06-20', 'english', ['dependency'])
    ]
  }, {
    taskIds: ['dependency', 'dependent'],
    targetDate: '2026-06-22'
  });

  const dependency = result.proposedTasks.find(item => item.id === 'dependency');
  const dependent = result.proposedTasks.find(item => item.id === 'dependent');
  assert.equal(dependency.scheduledDate, '2026-06-23');
  assert.equal(dependent.scheduledDate, '2026-06-24');
  assert.ok(dependent.scheduledDate <= '2026-06-26');
});

test('returns a partial non-applicable proposal when tasks cannot fit before exam', () => {
  const result = buildRescheduleProposal({
    goal: { examDate: '2026-06-22' },
    availability: { dailyHours: 1, unavailableDates: ['2026-06-22'] },
    tasksSnapshot: [task('blocked', 'pending', '2026-06-20')]
  }, {
    taskIds: ['blocked'],
    targetDate: '2026-06-22'
  });

  assert.equal(result.canApply, false);
  assert.equal(result.changes.length, 0);
  assert.equal(result.validation.unscheduled.length, 1);
});
