import assert from 'node:assert/strict';
import test from 'node:test';

import { executeGetProgressSummary } from './getProgressSummary.js';

function parseResult(planData, asOfDate = '2026-06-21') {
  return JSON.parse(executeGetProgressSummary({ asOfDate }, planData));
}

test('calculates status buckets, minutes, overdue tasks, and subject progress from tasksSnapshot', () => {
  const result = parseResult({
    tasksSnapshot: [
      {
        id: 'math-completed',
        subjectId: 'math',
        subjectName: '数学',
        title: '完成的数学任务',
        status: 'completed',
        scheduledDate: '2026-06-20',
        estimatedMinutes: 60,
        priority: 8
      },
      {
        id: 'english-skipped',
        subjectId: 'english',
        subjectName: '英语',
        title: '跳过的英语任务',
        status: 'skipped',
        scheduledDate: '2026-06-20',
        estimatedMinutes: 30,
        priority: 5
      },
      {
        id: 'math-progress',
        subjectId: 'math',
        subjectName: '数学',
        title: '进行中的数学任务',
        status: 'in_progress',
        scheduledDate: '2026-06-19',
        estimatedMinutes: 45,
        priority: 9
      },
      {
        id: 'english-failed',
        subjectId: 'english',
        subjectName: '英语',
        title: '失败的英语任务',
        status: 'failed',
        scheduledDate: '2026-06-18',
        estimatedMinutes: 40,
        priority: 7
      },
      {
        id: 'math-today',
        subjectId: 'math',
        subjectName: '数学',
        title: '今天的数学任务',
        status: 'pending',
        scheduledDate: '2026-06-21',
        estimatedMinutes: 50,
        priority: 6
      }
    ]
  });

  assert.equal(result.totalTasks, 5);
  assert.equal(result.completedTasks, 1);
  assert.equal(result.pendingTasks, 1);
  assert.equal(result.inProgressTasks, 1);
  assert.equal(result.skippedTasks, 1);
  assert.equal(result.failedTasks, 1);
  assert.equal(result.overdueTasks, 2);
  assert.equal(result.dueTodayTasks, 1);
  assert.equal(result.completionRate, 20);
  assert.equal(result.totalPlannedMinutes, 225);
  assert.equal(result.completedMinutes, 60);
  assert.equal(result.remainingMinutes, 135);

  assert.deepEqual(result.subjectProgress, [
    {
      subjectId: 'math',
      subjectName: '数学',
      totalTasks: 3,
      completedTasks: 1,
      completionRate: 33,
      remainingMinutes: 95
    },
    {
      subjectId: 'english',
      subjectName: '英语',
      totalTasks: 2,
      completedTasks: 0,
      completionRate: 0,
      remainingMinutes: 40
    }
  ]);
});

test('sorts next tasks by date, numeric priority descending, then original order', () => {
  const result = parseResult({
    tasksSnapshot: [
      {
        id: 'later',
        title: 'Later',
        status: 'pending',
        scheduledDate: '2026-06-23',
        estimatedMinutes: 30,
        priority: 10
      },
      {
        id: 'same-date-low',
        title: 'Same date low',
        status: 'pending',
        scheduledDate: '2026-06-22',
        estimatedMinutes: 30,
        priority: 5
      },
      {
        id: 'same-date-high-first',
        title: 'Same date high first',
        status: 'failed',
        scheduledDate: '2026-06-22',
        estimatedMinutes: 30,
        priority: 9
      },
      {
        id: 'same-date-high-second',
        title: 'Same date high second',
        status: 'in_progress',
        scheduledDate: '2026-06-22',
        estimatedMinutes: 30,
        priority: 9
      },
      {
        id: 'completed',
        title: 'Completed',
        status: 'completed',
        scheduledDate: '2026-06-21',
        estimatedMinutes: 30,
        priority: 10
      },
      {
        id: 'skipped',
        title: 'Skipped',
        status: 'skipped',
        scheduledDate: '2026-06-21',
        estimatedMinutes: 30,
        priority: 10
      }
    ]
  });

  assert.deepEqual(
    result.nextTasks.map(task => task.id),
    ['same-date-high-first', 'same-date-high-second', 'same-date-low', 'later']
  );
});

test('returns a stable zero summary for an empty plan', () => {
  assert.deepEqual(parseResult({ tasksSnapshot: [] }), {
    asOfDate: '2026-06-21',
    totalTasks: 0,
    completedTasks: 0,
    pendingTasks: 0,
    inProgressTasks: 0,
    skippedTasks: 0,
    failedTasks: 0,
    overdueTasks: 0,
    dueTodayTasks: 0,
    completionRate: 0,
    totalPlannedMinutes: 0,
    completedMinutes: 0,
    remainingMinutes: 0,
    subjectProgress: [],
    nextTasks: []
  });
});
