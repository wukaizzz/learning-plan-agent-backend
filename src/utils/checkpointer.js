import { MemorySaver } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { config } from '../config.js';
import { getDatabasePool } from '../db/pool.js';

const WORKFLOW_STATE_KEYS = [
  'studySpaceId',
  'userId',
  'goal',
  'subjects',
  'availability',
  'currentPlan',
  'tasksSnapshot',
  'progress',
  'riskAssessment',
  'workflow',
  'uiBlocks',
  'interruption',
  'metadata',
];

let initialized = false;
let status = {
  backend: 'memory',
  ready: false,
  fallback: false,
  schema: null,
  error: null,
};

export let checkpointer = new MemorySaver();

function pickWorkflowState(values) {
  if (!values || typeof values !== 'object') {
    return null;
  }

  const state = {};
  for (const key of WORKFLOW_STATE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      state[key] = values[key];
    }
  }

  return Object.keys(state).length > 0 ? state : null;
}

function resolveBackend(backend) {
  if (backend && backend !== 'auto') {
    return backend;
  }

  if (process.env.NODE_ENV === 'test') {
    return 'memory';
  }

  return config.database.enabled ? 'postgres' : 'memory';
}

async function assertPostgresCheckpointerReady(pool, schema) {
  const result = await pool.query(
    `SELECT
       to_regclass($1) AS checkpoints,
       to_regclass($2) AS checkpoint_blobs,
       to_regclass($3) AS checkpoint_writes`,
    [
      `${schema}.checkpoints`,
      `${schema}.checkpoint_blobs`,
      `${schema}.checkpoint_writes`,
    ]
  );

  const tables = result.rows[0];
  if (!tables.checkpoints || !tables.checkpoint_blobs || !tables.checkpoint_writes) {
    throw new Error(
      `LangGraph checkpoint tables are missing in schema "${schema}". Run "pnpm db:migrate".`
    );
  }
}

export async function initializeCheckpointer(options = {}) {
  if (initialized && !options.force) {
    return getCheckpointerStatus();
  }

  const backend = resolveBackend(options.backend || config.checkpointer.backend);
  const isProduction = process.env.NODE_ENV === 'production';
  const allowFallback = options.allowFallback ?? !isProduction;

  if (backend === 'memory') {
    if (isProduction) {
      throw new Error('Production requires the PostgreSQL checkpointer.');
    }

    checkpointer = new MemorySaver();
    initialized = true;
    status = {
      backend: 'memory',
      ready: true,
      fallback: !options.backend && !config.database.enabled,
      schema: null,
      error: null,
    };

    if (status.fallback) {
      console.warn(
        'PostgreSQL is not configured; using MemorySaver. Workflow state will be lost on restart.'
      );
    }
    return getCheckpointerStatus();
  }

  if (backend !== 'postgres') {
    throw new Error(`Unsupported checkpointer backend: ${backend}`);
  }

  try {
    const pool = options.pool || getDatabasePool();
    const schema = options.schema || config.checkpointer.schema;
    await assertPostgresCheckpointerReady(pool, schema);
    checkpointer = new PostgresSaver(pool, undefined, { schema });
    initialized = true;
    status = {
      backend: 'postgres',
      ready: true,
      fallback: false,
      schema,
      error: null,
    };
    return getCheckpointerStatus();
  } catch (error) {
    if (!allowFallback) {
      throw error;
    }

    checkpointer = new MemorySaver();
    initialized = true;
    status = {
      backend: 'memory',
      ready: true,
      fallback: true,
      schema: null,
      error: error.message,
    };
    console.warn(
      `PostgreSQL checkpointer unavailable; using MemorySaver for development: ${error.message}`
    );
    return getCheckpointerStatus();
  }
}

export function getCheckpointerStatus() {
  return { ...status };
}

export function extractCheckpointValues(checkpoint) {
  if (!checkpoint) {
    return null;
  }

  return pickWorkflowState(
    checkpoint.values ||
    checkpoint.channel_values ||
    checkpoint.checkpoint?.channel_values ||
    null
  );
}

export async function getState(threadId) {
  try {
    const checkpoint = await checkpointer.get({
      configurable: { thread_id: threadId },
    });
    const values = extractCheckpointValues(checkpoint);

    if (values) {
      console.log(`Loaded workflow state [threadId: ${threadId}]`, {
        stage: values.workflow?.stage,
        currentNode: values.workflow?.currentNode,
        taskCount: values.tasksSnapshot?.length || 0,
      });
      return values;
    }

    console.log(`Workflow state not found [threadId: ${threadId}]`);
    return null;
  } catch (error) {
    console.error(`Failed to load workflow state [threadId: ${threadId}]:`, error);
    return null;
  }
}

export async function clearState(threadId) {
  if (typeof checkpointer.deleteThread !== 'function') {
    throw new Error('The configured checkpointer does not support thread deletion.');
  }

  await checkpointer.deleteThread(threadId);
  console.log(`Workflow state cleared [threadId: ${threadId}]`);
}

export async function getHistory(threadId) {
  const items = [];
  for await (const tuple of checkpointer.list(
    { configurable: { thread_id: threadId } },
    { limit: 50 }
  )) {
    const values = extractCheckpointValues(tuple.checkpoint);
    if (values) {
      items.push({
        checkpointId: tuple.config?.configurable?.checkpoint_id,
        stage: values.workflow?.stage,
        currentNode: values.workflow?.currentNode,
      });
    }
  }
  return items;
}

export function replaceCheckpointerForTests(nextCheckpointer, nextStatus = {}) {
  checkpointer = nextCheckpointer;
  initialized = true;
  status = {
    backend: 'memory',
    ready: true,
    fallback: false,
    schema: null,
    error: null,
    ...nextStatus,
  };
}

export default {
  initializeCheckpointer,
  getCheckpointerStatus,
  extractCheckpointValues,
  getState,
  clearState,
  getHistory,
};
