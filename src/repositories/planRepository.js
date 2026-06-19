import { getDatabasePool, query } from '../db/pool.js';

function mapPlan(row) {
  if (!row) return null;

  return {
    id: row.id,
    userId: row.user_id,
    spaceId: row.space_id,
    title: row.title,
    status: row.status,
    version: row.version,
    sourceSessionId: row.source_session_id ?? undefined,
    sourceMessageId: row.source_message_id ?? undefined,
    createdAt: Number(row.created_at_ms),
    updatedAt: Number(row.updated_at_ms),
  };
}

function mapTask(row) {
  if (!row) return null;

  const dependencies = Array.isArray(row.dependencies) &&
    row.dependencies.every(item => typeof item === 'string')
    ? row.dependencies
    : [];

  return {
    id: row.id,
    userId: row.user_id,
    planId: row.plan_id,
    spaceId: row.space_id,
    subject: row.subject,
    title: row.title,
    type: row.type,
    priority: row.priority,
    status: row.status,
    estimatedMinutes: row.estimated_minutes,
    scheduledDate: row.scheduled_date,
    groupLabel: row.group_label ?? undefined,
    estimatedTime: row.estimated_time ?? undefined,
    dependencies,
    order: row.sort_order,
    createdAt: row.created_at_ms === null ? undefined : Number(row.created_at_ms),
    updatedAt: row.updated_at_ms === null ? undefined : Number(row.updated_at_ms),
  };
}

function mapPlanBlock(row) {
  if (!row) return null;

  const taskIds = Array.isArray(row.task_ids) &&
    row.task_ids.every(item => typeof item === 'string')
    ? row.task_ids
    : [];

  return {
    id: row.id,
    userId: row.user_id,
    planId: row.plan_id,
    spaceId: row.space_id,
    type: row.type,
    title: row.title,
    taskIds,
    props: row.props || {},
    order: row.sort_order,
    createdAt: row.created_at_ms === null ? undefined : Number(row.created_at_ms),
    updatedAt: row.updated_at_ms === null ? undefined : Number(row.updated_at_ms),
  };
}

async function loadPlanDetails(executor, userId, planId) {
  const planResult = await executor.query(
    'SELECT * FROM public.plans WHERE user_id = $1 AND id = $2',
    [userId, planId]
  );

  if (planResult.rowCount === 0) {
    return null;
  }

  const tasksResult = await executor.query(
    `SELECT *
     FROM public.tasks
     WHERE user_id = $1 AND plan_id = $2
     ORDER BY scheduled_date ASC, sort_order ASC, id ASC`,
    [userId, planId]
  );

  const blocksResult = await executor.query(
    `SELECT *
     FROM public.plan_blocks
     WHERE user_id = $1 AND plan_id = $2
     ORDER BY sort_order ASC, id ASC`,
    [userId, planId]
  );

  return {
    plan: mapPlan(planResult.rows[0]),
    tasks: tasksResult.rows.map(mapTask),
    blocks: blocksResult.rows.map(mapPlanBlock),
  };
}

async function archiveCurrentPlans(client, userId, spaceId, exceptPlanId, updatedAt) {
  await client.query(
    `UPDATE public.plans
     SET status = 'archived', updated_at_ms = $4
     WHERE user_id = $1
       AND space_id = $2
       AND id <> $3
       AND status <> 'archived'`,
    [userId, spaceId, exceptPlanId, updatedAt]
  );
}

async function upsertPlan(client, userId, plan) {
  await client.query(
    `INSERT INTO public.plans (
       id, user_id, space_id, title, status, version,
       source_session_id, source_message_id, created_at_ms, updated_at_ms
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO UPDATE
     SET user_id = EXCLUDED.user_id,
         space_id = EXCLUDED.space_id,
         title = EXCLUDED.title,
         status = EXCLUDED.status,
         version = EXCLUDED.version,
         source_session_id = EXCLUDED.source_session_id,
         source_message_id = EXCLUDED.source_message_id,
         created_at_ms = EXCLUDED.created_at_ms,
         updated_at_ms = EXCLUDED.updated_at_ms`,
    [
      plan.id,
      userId,
      plan.spaceId,
      plan.title,
      plan.status,
      plan.version,
      plan.sourceSessionId ?? null,
      plan.sourceMessageId ?? null,
      plan.createdAt,
      plan.updatedAt,
    ]
  );
}

async function replaceTasks(client, userId, planId, tasks) {
  await client.query(
    'DELETE FROM public.tasks WHERE user_id = $1 AND plan_id = $2',
    [userId, planId]
  );

  for (const task of tasks) {
    await client.query(
      `INSERT INTO public.tasks (
         id, user_id, plan_id, space_id, subject, title, type, priority, status,
         estimated_minutes, scheduled_date, group_label, estimated_time,
         dependencies, sort_order, created_at_ms, updated_at_ms
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16, $17)`,
      [
        task.id,
        userId,
        planId,
        task.spaceId,
        task.subject,
        task.title,
        task.type,
        task.priority,
        task.status,
        task.estimatedMinutes,
        task.scheduledDate,
        task.groupLabel ?? null,
        task.estimatedTime ?? null,
        JSON.stringify(task.dependencies || []),
        task.order,
        task.createdAt ?? null,
        task.updatedAt ?? null,
      ]
    );
  }
}

async function replaceBlocks(client, userId, planId, blocks) {
  await client.query(
    'DELETE FROM public.plan_blocks WHERE user_id = $1 AND plan_id = $2',
    [userId, planId]
  );

  for (const block of blocks) {
    await client.query(
      `INSERT INTO public.plan_blocks (
         id, user_id, plan_id, space_id, type, title, task_ids, props,
         sort_order, created_at_ms, updated_at_ms
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11)`,
      [
        block.id,
        userId,
        planId,
        block.spaceId,
        block.type,
        block.title,
        JSON.stringify(block.taskIds || []),
        JSON.stringify(block.props || {}),
        block.order,
        block.createdAt ?? null,
        block.updatedAt ?? null,
      ]
    );
  }
}

export async function savePlanSnapshot(userId, snapshot) {
  const pool = getDatabasePool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (snapshot.plan.status !== 'archived') {
      await archiveCurrentPlans(
        client,
        userId,
        snapshot.plan.spaceId,
        snapshot.plan.id,
        snapshot.plan.updatedAt
      );
    }

    await upsertPlan(client, userId, snapshot.plan);
    await replaceTasks(client, userId, snapshot.plan.id, snapshot.tasks);
    await replaceBlocks(client, userId, snapshot.plan.id, snapshot.blocks);

    const result = await loadPlanDetails(client, userId, snapshot.plan.id);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function activatePlan(userId, planId, updatedAt) {
  const pool = getDatabasePool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const planResult = await client.query(
      'SELECT * FROM public.plans WHERE user_id = $1 AND id = $2',
      [userId, planId]
    );

    if (planResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    const plan = planResult.rows[0];
    await archiveCurrentPlans(client, userId, plan.space_id, planId, updatedAt);
    await client.query(
      `UPDATE public.plans
       SET status = 'active', updated_at_ms = $3
       WHERE user_id = $1 AND id = $2`,
      [userId, planId, updatedAt]
    );

    const result = await loadPlanDetails(client, userId, planId);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function getLatestPlanBySpace(userId, spaceId) {
  const result = await query(
    `SELECT id
     FROM public.plans
     WHERE user_id = $1
       AND space_id = $2
       AND status <> 'archived'
     ORDER BY
       CASE status
         WHEN 'active' THEN 4
         WHEN 'draft' THEN 3
         WHEN 'paused' THEN 2
         WHEN 'completed' THEN 1
         ELSE 0
       END DESC,
       updated_at_ms DESC
     LIMIT 1`,
    [userId, spaceId]
  );

  if (result.rowCount === 0) {
    return null;
  }

  return loadPlanDetails({ query }, userId, result.rows[0].id);
}

export async function getPlanById(userId, planId) {
  return loadPlanDetails({ query }, userId, planId);
}

export async function updateTaskStatus(userId, taskId, status, updatedAt) {
  const pool = getDatabasePool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const taskResult = await client.query(
      `UPDATE public.tasks
       SET status = $3, updated_at_ms = $4
       WHERE user_id = $1 AND id = $2
       RETURNING *`,
      [userId, taskId, status, updatedAt]
    );

    if (taskResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    const task = taskResult.rows[0];
    await client.query(
      `UPDATE public.plans
       SET updated_at_ms = $3
       WHERE user_id = $1 AND id = $2`,
      [userId, task.plan_id, updatedAt]
    );

    await client.query('COMMIT');
    return mapTask(task);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function deletePlansBySpace(userId, spaceId) {
  const pool = getDatabasePool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const countsResult = await client.query(
      `SELECT
         (SELECT count(*)::INTEGER FROM public.plans WHERE user_id = $1 AND space_id = $2) AS plans,
         (SELECT count(*)::INTEGER FROM public.tasks WHERE user_id = $1 AND space_id = $2) AS tasks,
         (SELECT count(*)::INTEGER FROM public.plan_blocks WHERE user_id = $1 AND space_id = $2) AS blocks,
         (SELECT count(*)::INTEGER FROM public.agent_executions WHERE user_id = $1 AND space_id = $2) AS executions`,
      [userId, spaceId]
    );

    await client.query(
      'DELETE FROM public.agent_executions WHERE user_id = $1 AND space_id = $2',
      [userId, spaceId]
    );
    await client.query(
      'DELETE FROM public.plans WHERE user_id = $1 AND space_id = $2',
      [userId, spaceId]
    );

    await client.query('COMMIT');
    return countsResult.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export default {
  savePlanSnapshot,
  activatePlan,
  getLatestPlanBySpace,
  getPlanById,
  updateTaskStatus,
  deletePlansBySpace,
};
