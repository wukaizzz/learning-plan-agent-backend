import assert from 'node:assert/strict';
import test from 'node:test';

import { deterministicallyScheduleTasks } from './studyScheduler.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function toLocalDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalDateString(dateString) {
  const match = String(dateString).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  assert.ok(match, `Invalid scheduled date: ${dateString}`);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function dayOffset(dateString, startDateString) {
  return Math.round((parseLocalDateString(dateString).getTime() - parseLocalDateString(startDateString).getTime()) / DAY_MS);
}

function groupByDate(tasks) {
  return tasks.reduce((groups, task) => {
    groups.set(task.scheduledDate, [...(groups.get(task.scheduledDate) || []), task]);
    return groups;
  }, new Map());
}

function maxConsecutiveEmptyDays(tasks, startDateString, minDay, maxDay) {
  const occupiedDays = new Set(tasks.map(task => dayOffset(task.scheduledDate, startDateString)));
  let current = 0;
  let max = 0;

  for (let day = minDay; day <= maxDay; day++) {
    if (occupiedDays.has(day)) {
      current = 0;
    } else {
      current += 1;
      max = Math.max(max, current);
    }
  }

  return max;
}

function assertTaskShape(task) {
  for (const key of ['id', 'subjectId', 'title', 'type', 'estimatedMinutes', 'scheduledDate', 'priority', 'status']) {
    assert.ok(Object.hasOwn(task, key), `Expected task to include ${key}`);
  }
}

const subjects = [
  { id: 'math', name: 'Mathematics', currentLevel: 5, targetLevel: 8, priority: 'high' },
  { id: 'english', name: 'English', currentLevel: 5, targetLevel: 8, priority: 'high' },
];

test('spreads normal sessions across the learning window while keeping reviews at the end', () => {
  const startDate = toLocalDateString(new Date());
  const result = deterministicallyScheduleTasks([
    { subjectId: 'math', subjectName: 'Mathematics', title: 'Math concepts', type: 'study', priority: 8, estimatedHours: 6 },
    { subjectId: 'math', subjectName: 'Mathematics', title: 'Math practice', type: 'practice', priority: 9, estimatedHours: 6 },
    { subjectId: 'english', subjectName: 'English', title: 'English concepts', type: 'study', priority: 8, estimatedHours: 6 },
    { subjectId: 'english', subjectName: 'English', title: 'English practice', type: 'practice', priority: 9, estimatedHours: 6 },
  ], { examDistance: 30, dailyHours: 3 }, subjects);

  const normalTasks = result.filter(task => task.subjectId !== 'all');
  const reviewTasks = result.filter(task => task.subjectId === 'all');
  const grouped = groupByDate(result);

  assert.equal(normalTasks.length, 12);
  assert.equal(reviewTasks.length, 3);
  assert.ok(maxConsecutiveEmptyDays(normalTasks, startDate, 0, 26) <= 4);

  for (const task of result) {
    assertTaskShape(task);
  }

  for (const tasks of grouped.values()) {
    const totalMinutes = tasks.reduce((sum, task) => sum + task.estimatedMinutes, 0);
    assert.ok(totalMinutes <= 180, `Expected daily minutes <= 180, received ${totalMinutes}`);

    const subjectIds = new Set();
    for (const task of tasks.filter(item => item.subjectId !== 'all')) {
      assert.equal(subjectIds.has(task.subjectId), false, `Duplicate subject on ${task.scheduledDate}: ${task.subjectId}`);
      subjectIds.add(task.subjectId);
    }
  }

  for (const task of reviewTasks) {
    const offset = dayOffset(task.scheduledDate, startDate);
    assert.ok(offset >= 27 && offset <= 29, `Expected review task in final 3 days, received offset ${offset}`);
    assert.match(task.title, /^综合复习 - 第\d+轮$/);
  }
});

test('keeps split sessions from the same source task in date order', () => {
  const startDate = toLocalDateString(new Date());
  const result = deterministicallyScheduleTasks([
    { subjectId: 'math', subjectName: 'Mathematics', title: 'Linear algebra mastery', type: 'study', priority: 8, estimatedHours: 7 },
  ], { examDistance: 12, dailyHours: 2 }, [subjects[0]]);

  const orderedSessions = result
    .filter(task => task.subjectId !== 'all')
    .map(task => ({
      sessionIndex: Number(task.title.match(/(\d+)\/(\d+)/)?.[1] || 0),
      offset: dayOffset(task.scheduledDate, startDate),
    }))
    .sort((a, b) => a.sessionIndex - b.sessionIndex);

  assert.equal(orderedSessions.length, 4);
  assert.deepEqual(orderedSessions.map(item => item.sessionIndex), [1, 2, 3, 4]);

  for (let index = 1; index < orderedSessions.length; index++) {
    assert.ok(
      orderedSessions[index].offset > orderedSessions[index - 1].offset,
      `Expected session ${index + 1} to be after previous session`
    );
  }
});

test('renumbers scheduled split sessions after overflow drops tail sessions', () => {
  const result = deterministicallyScheduleTasks([
    { subjectId: 'math', subjectName: 'Mathematics', title: 'Overflowing proof practice', type: 'study', priority: 8, estimatedHours: 12 },
  ], { examDistance: 5, dailyHours: 2 }, [subjects[0]]);

  const normalTasks = result.filter(task => task.subjectId !== 'all');
  const titles = normalTasks.map(task => task.title);

  assert.equal(normalTasks.length, 5);
  assert.deepEqual(titles.map(title => title.match(/(\d+)\/(\d+)/)?.[0]), ['1/5', '2/5', '3/5', '4/5', '5/5']);
  assert.equal(titles.some(title => /\/6/.test(title)), false);
  assert.deepEqual(normalTasks.map(task => task.estimatedMinutes), [120, 120, 120, 120, 120]);
});

test('keeps complete split session numbering when nothing is dropped', () => {
  const result = deterministicallyScheduleTasks([
    { subjectId: 'math', subjectName: 'Mathematics', title: 'Complete calculus review', type: 'study', priority: 8, estimatedHours: 6 },
  ], { examDistance: 6, dailyHours: 2 }, [subjects[0]]);

  const normalTasks = result.filter(task => task.subjectId !== 'all');

  assert.equal(normalTasks.length, 3);
  assert.deepEqual(normalTasks.map(task => task.title.match(/(\d+)\/(\d+)/)?.[0]), ['1/3', '2/3', '3/3']);
  assert.deepEqual(normalTasks.map(task => task.estimatedMinutes), [120, 120, 120]);
});

test('merges duplicate framework tasks before splitting them into sessions', () => {
  const result = deterministicallyScheduleTasks([
    { subjectId: 'math', subjectName: 'Mathematics', title: 'Core formula review', type: 'study', priority: 7, estimatedHours: 1 },
    { subjectId: 'math', subjectName: 'Mathematics', title: 'Core formula review', type: 'study', priority: 7, estimatedHours: 1 },
    { subjectId: 'math', subjectName: 'Mathematics', title: 'Core formula review', type: 'study', priority: 7, estimatedHours: 1 },
  ], { examDistance: 5, dailyHours: 3 }, [subjects[0]]);

  const normalTasks = result.filter(task => task.subjectId !== 'all');

  assert.equal(normalTasks.length, 2);
  assert.ok(normalTasks.some(task => /1\/2/.test(task.title)));
  assert.ok(normalTasks.some(task => /2\/2/.test(task.title)));
});

test('does not create extra normal tasks when workload is sparse', () => {
  const startDate = toLocalDateString(new Date());
  const result = deterministicallyScheduleTasks([
    { subjectId: 'math', subjectName: 'Mathematics', title: 'Math diagnostic practice', type: 'practice', priority: 8, estimatedHours: 1 },
    { subjectId: 'english', subjectName: 'English', title: 'English diagnostic practice', type: 'practice', priority: 8, estimatedHours: 1 },
  ], { examDistance: 30, dailyHours: 3 }, subjects);

  const normalTasks = result.filter(task => task.subjectId !== 'all');
  const offsets = normalTasks
    .map(task => dayOffset(task.scheduledDate, startDate))
    .sort((a, b) => a - b);

  assert.equal(normalTasks.length, 2);
  assert.ok(offsets[1] - offsets[0] >= 20);
  assert.equal(result.filter(task => task.subjectId === 'all').length, 3);
});
