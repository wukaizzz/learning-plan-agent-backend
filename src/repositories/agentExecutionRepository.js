import { query } from '../db/pool.js';

function mapExecution(row) {
  if (!row) return null;

  return {
    executionId: row.execution_id,
    userId: row.user_id,
    spaceId: row.space_id,
    sessionId: row.session_id ?? undefined,
    messageId: row.message_id ?? undefined,
    title: row.title ?? undefined,
    status: row.status ?? undefined,
    steps: row.steps || [],
    summary: row.summary ?? undefined,
    rawExecution: row.raw_execution || {},
    updatedAt: Number(row.updated_at_ms),
  };
}

export async function upsertExecution(userId, execution) {
  const result = await query(
    `INSERT INTO public.agent_executions (
       execution_id, user_id, space_id, session_id, message_id, title, status,
       steps, summary, raw_execution, updated_at_ms
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10::jsonb, $11)
     ON CONFLICT (execution_id) DO UPDATE
     SET user_id = EXCLUDED.user_id,
         space_id = EXCLUDED.space_id,
         session_id = EXCLUDED.session_id,
         message_id = EXCLUDED.message_id,
         title = EXCLUDED.title,
         status = EXCLUDED.status,
         steps = EXCLUDED.steps,
         summary = EXCLUDED.summary,
         raw_execution = EXCLUDED.raw_execution,
         updated_at_ms = EXCLUDED.updated_at_ms
     RETURNING *`,
    [
      execution.executionId,
      userId,
      execution.spaceId,
      execution.sessionId ?? null,
      execution.messageId ?? null,
      execution.title ?? null,
      execution.status ?? null,
      JSON.stringify(execution.steps || []),
      execution.summary ?? null,
      JSON.stringify(execution.rawExecution || {}),
      execution.updatedAt,
    ]
  );

  return mapExecution(result.rows[0]);
}

export async function getLatestExecutionBySpace(userId, spaceId) {
  const result = await query(
    `SELECT *
     FROM public.agent_executions
     WHERE user_id = $1 AND space_id = $2
     ORDER BY updated_at_ms DESC
     LIMIT 1`,
    [userId, spaceId]
  );

  return mapExecution(result.rows[0]);
}

export default {
  upsertExecution,
  getLatestExecutionBySpace,
};
