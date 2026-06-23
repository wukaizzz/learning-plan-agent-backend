import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildScheduleTaskListBlock,
  executeGetScheduleOverview
} from './getScheduleOverview.js';
import { mapPersistedTasksToRuntime } from '../../../services/workflowPlanPersistence.js';

const planData = {
  currentPlan: {
    planId: 'plan-1',
    versionNumber: 3,
    lastModifiedAt: '2026-06-22T12:30:00.000Z'
  },
  subjects: [
    { id: 'math', name: '高等数学' },
    { id: 'english', name: '大学英语' }
  ],
  tasksSnapshot: [
    {
      id: 'task-later',
      subjectId: 'english',
      title: '阅读训练',
      type: 'practice',
      status: 'completed',
      scheduledDate: '2026-06-23',
      estimatedMinutes: 30,
      estimatedTime: '14:00-14:30',
      priority: 5,
      order: 2
    },
    {
      id: 'task-second',
      subjectId: 'math',
      title: '练习导数与微分',
      type: 'practice',
      status: 'in_progress',
      scheduledDate: '2026-06-22',
      estimatedMinutes: 60,
      estimatedTime: '10:30-11:30',
      priority: 6,
      order: 1
    },
    {
      id: 'task-first',
      subjectId: 'math',
      title: '复习极限与连续',
      type: 'study',
      status: 'pending',
      scheduledDate: '2026-06-22',
      estimatedMinutes: 60,
      estimatedTime: '09:00-10:00',
      priority: 8,
      order: 0
    },
    {
      id: 'task-failed',
      subjectId: 'english',
      title: '听力复盘',
      type: 'review',
      status: 'failed',
      scheduledDate: '2026-06-22',
      estimatedMinutes: 20,
      priority: 3,
      order: 3
    }
  ]
};

function execute(args, data = planData) {
  return JSON.parse(executeGetScheduleOverview(args, data));
}

test('returns schedule summaries and concrete tasks for a single day', () => {
  const result = execute({
    dateFrom: '2026-06-22',
    dateTo: '2026-06-22'
  });

  assert.deepEqual(result.range, {
    dateFrom: '2026-06-22',
    dateTo: '2026-06-22',
    dayCount: 1
  });
  assert.deepEqual(result.plan, {
    planId: 'plan-1',
    planVersion: 3,
    updatedAt: '2026-06-22T12:30:00.000Z'
  });
  assert.deepEqual(result.summary, {
    totalTasks: 3,
    totalMinutes: 140,
    pendingTasks: 1,
    inProgressTasks: 1,
    completedTasks: 0,
    skippedTasks: 0,
    failedTasks: 1
  });
  assert.deepEqual(
    result.days[0].tasks.map(task => task.id),
    ['task-first', 'task-second', 'task-failed']
  );
  assert.equal(result.days[0].tasks[0].subjectName, '高等数学');
  assert.equal(result.days[0].tasks[0].priority, 'high');
  assert.equal(result.days[0].tasks[1].priority, 'medium');
  assert.equal(result.days[0].tasks[2].priority, 'low');
  assert.equal(result.days[0].tasks[2].estimatedTime, undefined);
});

test('returns multi-day data and a stable zero result for empty ranges', () => {
  const multiDay = execute({
    dateFrom: '2026-06-22',
    dateTo: '2026-06-23'
  });
  assert.equal(multiDay.range.dayCount, 2);
  assert.equal(multiDay.days.length, 2);
  assert.equal(multiDay.summary.totalTasks, 4);
  assert.equal(multiDay.summary.completedTasks, 1);

  const empty = execute({
    dateFrom: '2026-06-24',
    dateTo: '2026-06-24'
  });
  assert.deepEqual(empty.summary, {
    totalTasks: 0,
    totalMinutes: 0,
    pendingTasks: 0,
    inProgressTasks: 0,
    completedTasks: 0,
    skippedTasks: 0,
    failedTasks: 0
  });
  assert.deepEqual(empty.days, []);
});

test('defaults to the server local date and rejects inverted ranges', () => {
  const local = new Date();
  local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
  const today = local.toISOString().slice(0, 10);
  const result = execute({}, { tasksSnapshot: [] });

  assert.equal(result.range.dateFrom, today);
  assert.equal(result.range.dateTo, today);
  assert.throws(
    () => executeGetScheduleOverview({
      dateFrom: '2026-06-23',
      dateTo: '2026-06-22'
    }, planData),
    /dateFrom must be before or equal to dateTo/
  );
});

test('builds a deterministic read-only UI block without changing tool data', () => {
  const result = execute({
    dateFrom: '2026-06-22',
    dateTo: '2026-06-22'
  });
  const block = buildScheduleTaskListBlock(result, {
    toolCallId: 'call-1',
    queriedAt: 123
  });

  assert.equal(block.id, 'schedule-task-list_call-1');
  assert.equal(block.type, 'schedule-task-list');
  assert.equal(block.props.readonly, true);
  assert.equal(block.props.queriedAt, 123);
  assert.equal(block.props.planVersion, 3);
  assert.equal(block.props.days[0].tasks[0].id, 'task-first');
  assert.equal(result.uiBlock, undefined);
});

test('persisted tasks retain schedule display fields in agent runtime data', () => {
  const [task] = mapPersistedTasksToRuntime({
    tasks: [{
      id: 'task-1',
      subject: 'Math',
      title: 'Practice',
      type: 'practice',
      estimatedMinutes: 45,
      priority: 'high',
      status: 'pending',
      scheduledDate: '2026-06-22',
      estimatedTime: '09:00-09:45',
      dependencies: [],
      order: 4
    }]
  }, [{ id: 'math', name: 'Math' }]);

  assert.equal(task.estimatedTime, '09:00-09:45');
  assert.equal(task.order, 4);
});
