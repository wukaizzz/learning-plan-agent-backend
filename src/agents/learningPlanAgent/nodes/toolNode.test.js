import assert from 'node:assert/strict';
import test from 'node:test';

import { toolNode } from './toolNode.js';

test('schedule tool emits one UI block while keeping ToolMessage content data-only', async () => {
  const events = [];
  const result = await toolNode({
    studySpaceId: 'space-1',
    userId: 'user-1',
    intent: 'query_plan',
    iterationCount: 1,
    planData: {
      currentPlan: {
        planId: 'plan-1',
        versionNumber: 1,
        lastModifiedAt: '2026-06-22T10:00:00.000Z'
      },
      subjects: [{ id: 'math', name: '数学' }],
      tasksSnapshot: [{
        id: 'task-1',
        subjectId: 'math',
        title: '复习函数',
        type: 'study',
        status: 'pending',
        scheduledDate: '2026-06-22',
        estimatedMinutes: 60,
        estimatedTime: '09:00-10:00',
        priority: 8,
        order: 0
      }]
    },
    messages: [{
      tool_calls: [{
        id: 'call-1',
        name: 'get_schedule_overview',
        args: {
          dateFrom: '2026-06-22',
          dateTo: '2026-06-22'
        }
      }]
    }]
  }, {
    configurable: {
      executionId: 'execution-1',
      onEvent: event => events.push(event)
    }
  });

  const blockEvents = events.filter(event => event.type === 'ui_block_update');
  assert.equal(blockEvents.length, 1);
  assert.equal(blockEvents[0].block.type, 'schedule-task-list');
  assert.equal(blockEvents[0].block.id, 'schedule-task-list_call-1');

  const toolContent = JSON.parse(result.messages[0].content);
  assert.equal(toolContent.summary.totalTasks, 1);
  assert.equal(toolContent.uiBlock, undefined);
});
