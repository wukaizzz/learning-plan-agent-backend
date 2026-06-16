import assert from 'node:assert/strict';
import test from 'node:test';

import { buildStudyTimeline } from './studyTimelineBuilder.js';

function getEvent(timeline, title) {
  return timeline.events.find(event => event.title === title);
}

function assertTimelineEventShape(event) {
  for (const key of ['date', 'title', 'type', 'importance']) {
    assert.ok(Object.hasOwn(event, key), `Expected timeline event to include ${key}`);
  }
}

test('uses actual task type dates for practice and review milestones', () => {
  const timeline = buildStudyTimeline([
    { scheduledDate: '2026-06-11', type: 'study', subjectId: 'math' },
    { scheduledDate: '2026-06-15', type: 'study', subjectId: 'english' },
    { scheduledDate: '2026-06-20', type: 'practice', subjectId: 'math' },
    { scheduledDate: '2026-06-30', type: 'review', subjectId: 'math' },
    { scheduledDate: '2026-07-02', type: 'review', subjectId: 'all' },
  ], '2026-06-10', '2026-07-10');

  assert.equal(timeline.startDate, '2026-06-11');
  assert.equal(timeline.endDate, '2026-07-10');
  assert.equal(getEvent(timeline, '基础巩固阶段')?.date, '2026-06-11');
  assert.equal(getEvent(timeline, '强化训练阶段')?.date, '2026-06-20');
  assert.equal(getEvent(timeline, '冲刺复盘阶段')?.date, '2026-06-30');
  assert.equal(getEvent(timeline, '考试日')?.date, '2026-07-10');

  for (const event of timeline.events) {
    assertTimelineEventShape(event);
  }
});

test('falls back to one-third and two-third dates when task types are missing', () => {
  const timeline = buildStudyTimeline([
    { scheduledDate: '2026-06-10', type: 'study', subjectId: 'math' },
    { scheduledDate: '2026-06-12', type: 'study', subjectId: 'english' },
  ], '2026-06-10', '2026-07-10');

  assert.equal(timeline.startDate, '2026-06-10');
  assert.equal(getEvent(timeline, '强化训练阶段')?.date, '2026-06-20');
  assert.equal(getEvent(timeline, '冲刺复盘阶段')?.date, '2026-06-30');
});

test('uses fallback start date when there are no scheduled tasks', () => {
  const timeline = buildStudyTimeline([], '2026-06-10', '2026-07-10');

  assert.equal(timeline.startDate, '2026-06-10');
  assert.equal(timeline.endDate, '2026-07-10');
  assert.deepEqual(
    timeline.events.map(event => event.date),
    ['2026-06-10', '2026-06-20', '2026-06-30', '2026-07-10']
  );
});

test('uses comprehensive review date as review milestone when subjectId is all', () => {
  const timeline = buildStudyTimeline([
    { scheduledDate: '2026-06-10', type: 'study', subjectId: 'math' },
    { scheduledDate: '2026-07-01', type: 'study', subjectId: 'all' },
  ], '2026-06-10', '2026-07-10');

  assert.equal(getEvent(timeline, '冲刺复盘阶段')?.date, '2026-07-01');
});
