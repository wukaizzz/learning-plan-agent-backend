import { getDatabasePool, query } from '../db/pool.js';
import { safeRollback } from '../db/reliability.js';

function mapChangeSet(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    spaceId: row.space_id,
    sourcePlanId: row.source_plan_id,
    sourcePlanVersion: row.source_plan_version,
    type: row.type,
    status: row.status,
    request: row.request || {},
    changes: row.changes || [],
    impact: row.impact || {},
    validation: row.validation || {},
    proposedTasks: row.proposed_tasks || [],
    contextSnapshot: row.context_snapshot || {},
    expiresAt: Number(row.expires_at_ms),
    resultPlanId: row.result_plan_id ?? undefined,
    applyIdempotencyKey: row.apply_idempotency_key ?? undefined,
    createdAt: Number(row.created_at_ms),
    updatedAt: Number(row.updated_at_ms),
    appliedAt: row.applied_at_ms == null ? undefined : Number(row.applied_at_ms)
  };
}

export async function createChangeSet(userId, changeSet) {
  const result = await query(
    `INSERT INTO public.plan_change_sets (
       id, user_id, space_id, source_plan_id, source_plan_version, type, status,
       request, changes, impact, validation, proposed_tasks, context_snapshot,
       expires_at_ms, created_at_ms, updated_at_ms
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb,
       $14, $15, $16
     )
     RETURNING *`,
    [
      changeSet.id,
      userId,
      changeSet.spaceId,
      changeSet.sourcePlanId,
      changeSet.sourcePlanVersion,
      changeSet.type,
      changeSet.status,
      JSON.stringify(changeSet.request || {}),
      JSON.stringify(changeSet.changes || []),
      JSON.stringify(changeSet.impact || {}),
      JSON.stringify(changeSet.validation || {}),
      JSON.stringify(changeSet.proposedTasks || []),
      JSON.stringify(changeSet.contextSnapshot || {}),
      changeSet.expiresAt,
      changeSet.createdAt,
      changeSet.updatedAt
    ]
  );
  return mapChangeSet(result.rows[0]);
}

export async function getLatestPendingBySpace(userId, spaceId, now = Date.now()) {
  await query(
    `UPDATE public.plan_change_sets
     SET status = 'expired', updated_at_ms = $3
     WHERE user_id = $1 AND space_id = $2
       AND status = 'pending' AND expires_at_ms <= $3`,
    [userId, spaceId, now]
  );
  const result = await query(
    `SELECT * FROM public.plan_change_sets
     WHERE user_id = $1 AND space_id = $2 AND status = 'pending'
     ORDER BY created_at_ms DESC
     LIMIT 1`,
    [userId, spaceId]
  );
  return mapChangeSet(result.rows[0]);
}

export async function rejectChangeSet(userId, changeSetId, now = Date.now()) {
  const result = await query(
    `UPDATE public.plan_change_sets
     SET status = 'rejected', updated_at_ms = $3
     WHERE user_id = $1 AND id = $2 AND status = 'pending'
     RETURNING *`,
    [userId, changeSetId, now]
  );
  return mapChangeSet(result.rows[0]);
}

export async function withLockedChangeSet(userId, changeSetId, callback) {
  const pool = getDatabasePool();
  const client = await pool.connect();
  let destroyClient = false;
  try {
    await client.query('BEGIN');
    const changeResult = await client.query(
      `SELECT * FROM public.plan_change_sets
       WHERE user_id = $1 AND id = $2
       FOR UPDATE`,
      [userId, changeSetId]
    );
    const changeSet = mapChangeSet(changeResult.rows[0]);
    const result = await callback({ client, changeSet });
    await client.query('COMMIT');
    return result;
  } catch (error) {
    destroyClient = await safeRollback(client, error);
    throw error;
  } finally {
    client.release(destroyClient);
  }
}

export async function findAppliedByIdempotency(client, userId, idempotencyKey) {
  const result = await client.query(
    `SELECT * FROM public.plan_change_sets
     WHERE user_id = $1 AND apply_idempotency_key = $2 AND status = 'applied'
     LIMIT 1`,
    [userId, idempotencyKey]
  );
  return mapChangeSet(result.rows[0]);
}

export async function getCurrentPlanForUpdate(client, userId, spaceId) {
  const result = await client.query(
    `SELECT * FROM public.plans
     WHERE user_id = $1 AND space_id = $2 AND status <> 'archived'
     ORDER BY
       CASE status WHEN 'active' THEN 4 WHEN 'draft' THEN 3 WHEN 'paused' THEN 2 WHEN 'completed' THEN 1 ELSE 0 END DESC,
       updated_at_ms DESC
     LIMIT 1
     FOR UPDATE`,
    [userId, spaceId]
  );
  return result.rows[0] || null;
}

export async function markApplied(client, userId, changeSetId, {
  resultPlanId,
  idempotencyKey,
  now
}) {
  const result = await client.query(
    `UPDATE public.plan_change_sets
     SET status = 'applied', result_plan_id = $3, apply_idempotency_key = $4,
         applied_at_ms = $5, updated_at_ms = $5
     WHERE user_id = $1 AND id = $2
     RETURNING *`,
    [userId, changeSetId, resultPlanId, idempotencyKey, now]
  );
  return mapChangeSet(result.rows[0]);
}

export async function markInvalidated(client, userId, changeSetId, now) {
  await client.query(
    `UPDATE public.plan_change_sets
     SET status = 'invalidated', updated_at_ms = $3
     WHERE user_id = $1 AND id = $2`,
    [userId, changeSetId, now]
  );
}
