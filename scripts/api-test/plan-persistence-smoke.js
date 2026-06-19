import { spawn } from 'node:child_process';

const port = 3101;
const baseUrl = `http://127.0.0.1:${port}`;
const userId = process.env.DEFAULT_DEV_USER_ID || 'default-user';
const suffix = Date.now();
const spaceId = `space_codex_plan_smoke_${suffix}`;
const planAId = `plan_codex_smoke_a_${suffix}`;
const planBId = `plan_codex_smoke_b_${suffix}`;
const taskId = `task_codex_smoke_${suffix}`;
const blockId = `block_codex_smoke_${suffix}`;
const executionId = `execution_codex_smoke_${suffix}`;

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
  if (!condition) {
    throw new Error(message);
  }
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

function buildSnapshot(planId, status, version) {
  const now = Date.now();
  return {
    plan: {
      id: planId,
      spaceId,
      title: `Persistence smoke plan ${version}`,
      status,
      version,
      createdAt: now,
      updatedAt: now,
    },
    tasks: planId === planBId
      ? [{
          id: taskId,
          planId,
          spaceId,
          subject: 'Mathematics',
          title: 'Verify JSONB dependencies',
          type: 'study',
          priority: 'high',
          status: 'pending',
          estimatedMinutes: 30,
          scheduledDate: '2026-06-18',
          dependencies: ['task_dependency_1'],
          order: 0,
          createdAt: now,
          updatedAt: now,
        }]
      : [],
    blocks: planId === planBId
      ? [{
          id: blockId,
          planId,
          spaceId,
          type: 'daily-task-list',
          title: 'Today',
          taskIds: [taskId],
          props: {},
          order: 0,
          createdAt: now,
          updatedAt: now,
        }]
      : [],
  };
}

async function run() {
  await waitForServer();

  const now = Date.now();
  const space = {
    id: spaceId,
    name: 'Plan persistence smoke space',
    description: '',
    color: '#3b82f6',
    goal: {},
    subjects: [],
    schedule: {},
    status: 'planning',
    currentPhase: 'Preparation',
    stats: {},
    createdAt: now,
    updatedAt: now,
    lastActiveAt: now,
    isDeleted: false,
  };
  await request(`/api/study-spaces/${encodeURIComponent(spaceId)}`, {
    method: 'PUT',
    body: JSON.stringify(space),
  });

  const first = await request('/api/plans', {
    method: 'POST',
    body: JSON.stringify(buildSnapshot(planAId, 'active', 1)),
  });
  assert(first.response.status === 201 && first.body.success, 'Initial active plan save failed');

  const replan = await request('/api/plans', {
    method: 'POST',
    body: JSON.stringify(buildSnapshot(planBId, 'draft', 2)),
  });
  assert(replan.response.status === 201 && replan.body.success, 'Replan draft save failed');

  const archived = await request(`/api/plans/${encodeURIComponent(planAId)}`);
  assert(archived.body.data.plan.status === 'archived', 'Previous active plan was not archived');

  const latest = await request(`/api/spaces/${encodeURIComponent(spaceId)}/plans/latest`);
  assert(latest.body.data.plan.id === planBId, 'Latest plan is not the replan draft');
  assert(
    Array.isArray(latest.body.data.tasks[0].dependencies) &&
      latest.body.data.tasks[0].dependencies[0] === 'task_dependency_1',
    'Task dependencies did not round-trip as string[]'
  );
  assert(
    Array.isArray(latest.body.data.blocks[0].taskIds) &&
      latest.body.data.blocks[0].taskIds[0] === taskId,
    'Block taskIds did not round-trip as string[]'
  );

  const taskUpdate = await request(`/api/tasks/${encodeURIComponent(taskId)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'completed' }),
  });
  assert(taskUpdate.body.data.status === 'completed', 'Task status update failed');

  const execution = {
    executionId,
    spaceId,
    title: 'Persistence smoke execution',
    status: 'completed',
    steps: [],
    summary: 'Smoke test',
    updatedAt: Date.now(),
  };
  const executionSave = await request(
    `/api/spaces/${encodeURIComponent(spaceId)}/executions`,
    {
      method: 'POST',
      body: JSON.stringify(execution),
    }
  );
  assert(executionSave.response.status === 201 && executionSave.body.success, 'Execution save failed');

  const latestExecution = await request(
    `/api/spaces/${encodeURIComponent(spaceId)}/executions/latest`
  );
  assert(
    latestExecution.body.data.executionId === executionId,
    'Latest execution query returned the wrong record'
  );

  const invalid = buildSnapshot(`plan_codex_invalid_${suffix}`, 'draft', 3);
  invalid.tasks = [{
    ...buildSnapshot(planBId, 'draft', 2).tasks[0],
    id: `task_codex_invalid_${suffix}`,
    planId: invalid.plan.id,
    dependencies: ['valid', 1],
  }];
  const invalidResponse = await request('/api/plans', {
    method: 'POST',
    body: JSON.stringify(invalid),
  });
  assert(
    invalidResponse.response.status === 400 &&
      invalidResponse.body.error.code === 'VALIDATION_ERROR',
    'Invalid string array was not rejected'
  );

  const deleted = await request(`/api/spaces/${encodeURIComponent(spaceId)}/plans`, {
    method: 'DELETE',
  });
  assert(deleted.body.data.plans === 2, 'Delete did not report both test plans');
  assert(deleted.body.data.tasks === 1, 'Delete did not report the test task');
  assert(deleted.body.data.blocks === 1, 'Delete did not report the test block');
  assert(deleted.body.data.executions === 1, 'Delete did not report the test execution');

  const afterDelete = await request(`/api/spaces/${encodeURIComponent(spaceId)}/plans/latest`);
  assert(afterDelete.body.data === null, 'Plan data still exists after delete');

  console.log('Plan persistence smoke test passed');
}

try {
  await run();
} finally {
  try {
    await request(`/api/study-spaces/${encodeURIComponent(spaceId)}/permanent`, {
      method: 'DELETE',
    });
  } catch {
    // Best-effort cleanup if the server or database failed.
  }
  server.kill();
}
