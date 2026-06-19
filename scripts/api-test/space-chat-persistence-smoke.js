import { spawn } from 'node:child_process';

const port = 3102;
const baseUrl = `http://127.0.0.1:${port}`;
const userId = process.env.DEFAULT_DEV_USER_ID || 'default-user';
const suffix = Date.now();
const spaceId = `space_codex_space_chat_${suffix}`;
const sessionId = `session_codex_space_chat_${suffix}`;
const globalSessionId = `session_codex_global_${suffix}`;
const messageId = `msg-codex-space-chat-${suffix}`;
const planId = `plan_codex_space_chat_${suffix}`;
const executionId = `execution_codex_space_chat_${suffix}`;

const server = spawn(
  process.execPath,
  ['--import', 'dotenv/config', 'src/index.js'],
  {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  }
);

server.stdout.on('data', chunk => process.stdout.write(`[server] ${chunk}`));
server.stderr.on('data', chunk => process.stderr.write(`[server] ${chunk}`));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-user-id': userId,
      ...options.headers,
    },
  });
  const body = await response.json();
  return { response, body };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health/db`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Backend did not become ready');
}

function spacePayload(updatedAt = Date.now()) {
  return {
    id: spaceId,
    name: 'Space chat persistence smoke',
    description: 'Temporary smoke-test study space',
    color: '#3b82f6',
    goal: {
      primaryGoal: 'Verify persistence',
      secondaryGoals: [],
      examDate: '2026-07-01T00:00:00.000Z',
      targetScore: 85,
    },
    subjects: [{
      name: 'Mathematics',
      currentLevel: 60,
      targetLevel: 85,
      weight: 0.8,
      weakPoints: [],
      strongPoints: [],
    }],
    schedule: {
      availableHoursPerDay: 3,
      availableDays: ['Monday'],
      preferredTimeSlots: ['Evening'],
      restDays: [],
      startDate: '2026-06-19T00:00:00.000Z',
    },
    status: 'planning',
    currentPhase: 'Preparation',
    stats: {
      totalStudyHours: 0,
      consecutiveDays: 0,
      overallProgress: 0,
      tasksCompleted: 0,
      tasksTotal: 0,
    },
    createdAt: updatedAt,
    updatedAt,
    lastActiveAt: updatedAt,
    isDeleted: false,
  };
}

function sessionPayload(id, targetSpaceId, updatedAt = Date.now()) {
  return {
    session: {
      id,
      spaceId: targetSpaceId,
      title: 'Persistence smoke session',
      createdAt: updatedAt,
      updatedAt,
    },
    messages: id === sessionId
      ? [{
          id: messageId,
          role: 'user',
          content: 'Generate my first plan',
          timestamp: updatedAt,
          ui_blocks: [{
            id: `form-${suffix}`,
            type: 'collection-form',
            title: 'Missing information',
            props: { fields: [] },
          }],
          form_submission_state: 'idle',
          thinkingActive: false,
          thinkingContent: 'must not persist',
        }]
      : [],
  };
}

async function run() {
  await waitForServer();

  const savedSpace = await request(`/api/study-spaces/${spaceId}`, {
    method: 'PUT',
    body: JSON.stringify(spacePayload()),
  });
  assert(savedSpace.body.success, 'Study space save failed');
  assert(savedSpace.body.data.userId === userId, 'Study space user ownership is wrong');

  const savedSession = await request(`/api/chat-sessions/${sessionId}`, {
    method: 'PUT',
    body: JSON.stringify(sessionPayload(sessionId, spaceId)),
  });
  assert(savedSession.body.success, 'Chat session save failed');
  assert(savedSession.body.data.messages.length === 1, 'Chat message was not saved');
  assert(
    savedSession.body.data.messages[0].thinkingContent === undefined,
    'Runtime thinking content leaked into persistence'
  );

  const globalSession = await request(`/api/chat-sessions/${globalSessionId}`, {
    method: 'PUT',
    body: JSON.stringify(sessionPayload(globalSessionId, null)),
  });
  assert(globalSession.body.success, 'Global chat session save failed');
  assert(globalSession.body.data.spaceId === null, 'Global session spaceId is not null');

  const olderSpace = spacePayload(savedSpace.body.data.updatedAt - 1000);
  olderSpace.name = 'Older local value';
  const importResult = await request('/api/persistence/import-local-v1', {
    method: 'POST',
    body: JSON.stringify({
      studySpaces: [olderSpace],
      chatSessions: [sessionPayload(
        sessionId,
        spaceId,
        savedSession.body.data.updatedAt - 1000
      )],
    }),
  });
  assert(importResult.body.data.spaces.skipped === 1, 'Older space import was not skipped');
  assert(importResult.body.data.sessions.skipped === 1, 'Older session import was not skipped');

  const softDeleted = await request(`/api/study-spaces/${spaceId}`, {
    method: 'DELETE',
  });
  assert(softDeleted.body.data.isDeleted === true, 'Soft delete failed');

  const restored = await request(`/api/study-spaces/${spaceId}/restore`, {
    method: 'POST',
  });
  assert(restored.body.data.isDeleted === false, 'Restore failed');

  const now = Date.now();
  await request('/api/plans', {
    method: 'POST',
    body: JSON.stringify({
      plan: {
        id: planId,
        spaceId,
        title: 'Cascade smoke plan',
        status: 'draft',
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
      tasks: [],
      blocks: [],
    }),
  });
  await request(`/api/spaces/${spaceId}/executions`, {
    method: 'POST',
    body: JSON.stringify({
      executionId,
      spaceId,
      title: 'Cascade smoke execution',
      status: 'completed',
      steps: [],
      updatedAt: now,
    }),
  });

  const deleted = await request(`/api/study-spaces/${spaceId}/permanent`, {
    method: 'DELETE',
  });
  assert(deleted.body.data.spaces === 1, 'Permanent delete did not remove the space');
  assert(deleted.body.data.sessions === 1, 'Permanent delete did not include the session');
  assert(deleted.body.data.messages === 1, 'Permanent delete did not include the message');
  assert(deleted.body.data.plans === 1, 'Permanent delete did not include the plan');
  assert(deleted.body.data.executions === 1, 'Permanent delete did not include the execution');

  const missingSpace = await request(`/api/study-spaces/${spaceId}`);
  assert(missingSpace.response.status === 404, 'Deleted space can still be queried');

  const deletedGlobal = await request(`/api/chat-sessions/${globalSessionId}`, {
    method: 'DELETE',
  });
  assert(deletedGlobal.body.success, 'Global session cleanup failed');

  console.log('Space/chat persistence smoke test passed');
}

try {
  await run();
} finally {
  try {
    await request(`/api/study-spaces/${spaceId}/permanent`, { method: 'DELETE' });
    await request(`/api/chat-sessions/${globalSessionId}`, { method: 'DELETE' });
  } catch {
    // Best-effort cleanup.
  }
  server.kill();
}
