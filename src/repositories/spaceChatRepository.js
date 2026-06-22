import { getDatabasePool, query } from '../db/pool.js';
import { safeRollback } from '../db/reliability.js';

function mapSpace(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    color: row.color,
    goal: row.goal || {},
    subjects: Array.isArray(row.subjects) ? row.subjects : [],
    schedule: row.schedule || {},
    status: row.status,
    currentPhase: row.current_phase,
    stats: row.stats || {},
    createdAt: Number(row.created_at_ms),
    updatedAt: Number(row.updated_at_ms),
    lastActiveAt: Number(row.last_active_at_ms),
    isPlaceholder: row.is_placeholder,
    isDeleted: row.is_deleted,
    deletedAt: row.deleted_at_ms === null ? undefined : Number(row.deleted_at_ms),
    deletionScheduledAt: row.deletion_scheduled_at_ms === null
      ? undefined
      : Number(row.deletion_scheduled_at_ms),
  };
}

function mapMessage(row) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    timestamp: Number(row.timestamp_ms),
    ...(row.tool_calls?.length ? { tool_calls: row.tool_calls } : {}),
    ...(row.ui_blocks?.length ? { ui_blocks: row.ui_blocks } : {}),
    ...(row.submitted_form_summary?.length
      ? { submitted_form_summary: row.submitted_form_summary }
      : {}),
    ...(row.form_submission_state
      ? { form_submission_state: row.form_submission_state }
      : {}),
    ...(row.workflow_process_steps?.length
      ? { workflow_process_steps: row.workflow_process_steps }
      : {}),
    thinkingActive: false,
  };
}

function mapSession(row, messages = []) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    spaceId: row.space_id,
    title: row.title,
    messages,
    createdAt: Number(row.created_at_ms),
    updatedAt: Number(row.updated_at_ms),
  };
}

async function loadSession(executor, userId, sessionId) {
  const sessionResult = await executor.query(
    'SELECT * FROM public.chat_sessions WHERE user_id = $1 AND id = $2',
    [userId, sessionId]
  );
  if (sessionResult.rowCount === 0) return null;

  const messageResult = await executor.query(
    `SELECT *
     FROM public.chat_messages
     WHERE user_id = $1 AND session_id = $2
     ORDER BY timestamp_ms ASC, id ASC`,
    [userId, sessionId]
  );
  return mapSession(sessionResult.rows[0], messageResult.rows.map(mapMessage));
}

export async function upsertSpaceWithExecutor(executor, userId, space) {
  const existing = await executor.query(
    'SELECT updated_at_ms FROM public.study_spaces WHERE user_id = $1 AND id = $2',
    [userId, space.id]
  );
  if (
    existing.rowCount > 0 &&
    Number(existing.rows[0].updated_at_ms) > space.updatedAt
  ) {
    const current = await executor.query(
      'SELECT * FROM public.study_spaces WHERE user_id = $1 AND id = $2',
      [userId, space.id]
    );
    return { data: mapSpace(current.rows[0]), action: 'skipped' };
  }

  const result = await executor.query(
    `INSERT INTO public.study_spaces (
       id, user_id, name, description, color, goal, subjects, schedule,
       status, current_phase, stats, created_at_ms, updated_at_ms,
       last_active_at_ms, is_placeholder, is_deleted, deleted_at_ms,
       deletion_scheduled_at_ms
     )
     VALUES (
       $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb,
       $9, $10, $11::jsonb, $12, $13, $14, false, $15, $16, $17
     )
     ON CONFLICT (user_id, id) DO UPDATE
     SET name = EXCLUDED.name,
         description = EXCLUDED.description,
         color = EXCLUDED.color,
         goal = EXCLUDED.goal,
         subjects = EXCLUDED.subjects,
         schedule = EXCLUDED.schedule,
         status = EXCLUDED.status,
         current_phase = EXCLUDED.current_phase,
         stats = EXCLUDED.stats,
         created_at_ms = EXCLUDED.created_at_ms,
         updated_at_ms = EXCLUDED.updated_at_ms,
         last_active_at_ms = EXCLUDED.last_active_at_ms,
         is_placeholder = false,
         is_deleted = EXCLUDED.is_deleted,
         deleted_at_ms = EXCLUDED.deleted_at_ms,
         deletion_scheduled_at_ms = EXCLUDED.deletion_scheduled_at_ms
     RETURNING *`,
    [
      space.id,
      userId,
      space.name,
      space.description,
      space.color,
      JSON.stringify(space.goal),
      JSON.stringify(space.subjects),
      JSON.stringify(space.schedule),
      space.status,
      space.currentPhase,
      JSON.stringify(space.stats),
      space.createdAt,
      space.updatedAt,
      space.lastActiveAt,
      space.isDeleted,
      space.deletedAt ?? null,
      space.deletionScheduledAt ?? null,
    ]
  );
  return {
    data: mapSpace(result.rows[0]),
    action: existing.rowCount === 0 ? 'imported' : 'updated',
  };
}

export async function upsertSpace(userId, space) {
  return upsertSpaceWithExecutor({ query }, userId, space);
}

export async function listSpaces(userId, includeDeleted) {
  const result = await query(
    `SELECT *
     FROM public.study_spaces
     WHERE user_id = $1
       AND is_placeholder = false
       AND ($2::boolean OR is_deleted = false)
     ORDER BY last_active_at_ms DESC, id ASC`,
    [userId, includeDeleted]
  );
  return result.rows.map(mapSpace);
}

export async function getSpace(userId, spaceId) {
  const result = await query(
    'SELECT * FROM public.study_spaces WHERE user_id = $1 AND id = $2',
    [userId, spaceId]
  );
  return mapSpace(result.rows[0]);
}

export async function softDeleteSpace(userId, spaceId, now, scheduledAt) {
  const result = await query(
    `UPDATE public.study_spaces
     SET is_deleted = true,
         deleted_at_ms = $3,
         deletion_scheduled_at_ms = $4,
         updated_at_ms = $3
     WHERE user_id = $1 AND id = $2
     RETURNING *`,
    [userId, spaceId, now, scheduledAt]
  );
  return mapSpace(result.rows[0]);
}

export async function restoreSpace(userId, spaceId, now) {
  const result = await query(
    `UPDATE public.study_spaces
     SET is_deleted = false,
         deleted_at_ms = NULL,
         deletion_scheduled_at_ms = NULL,
         updated_at_ms = $3,
         last_active_at_ms = $3
     WHERE user_id = $1 AND id = $2
     RETURNING *`,
    [userId, spaceId, now]
  );
  return mapSpace(result.rows[0]);
}

export async function permanentlyDeleteSpace(userId, spaceId) {
  const pool = getDatabasePool();
  const client = await pool.connect();
  let destroyClient = false;
  try {
    await client.query('BEGIN');
    const counts = await client.query(
      `SELECT
         (SELECT count(*)::integer FROM public.study_spaces WHERE user_id = $1 AND id = $2) AS spaces,
         (SELECT count(*)::integer FROM public.chat_sessions WHERE user_id = $1 AND space_id = $2) AS sessions,
         (SELECT count(*)::integer
          FROM public.chat_messages m
          JOIN public.chat_sessions s ON s.id = m.session_id AND s.user_id = m.user_id
          WHERE s.user_id = $1 AND s.space_id = $2) AS messages,
         (SELECT count(*)::integer FROM public.plans WHERE user_id = $1 AND space_id = $2) AS plans,
         (SELECT count(*)::integer FROM public.tasks WHERE user_id = $1 AND space_id = $2) AS tasks,
         (SELECT count(*)::integer FROM public.plan_blocks WHERE user_id = $1 AND space_id = $2) AS blocks,
         (SELECT count(*)::integer FROM public.agent_executions WHERE user_id = $1 AND space_id = $2) AS executions`,
      [userId, spaceId]
    );
    await client.query(
      'DELETE FROM public.study_spaces WHERE user_id = $1 AND id = $2',
      [userId, spaceId]
    );
    await client.query('COMMIT');
    return counts.rows[0];
  } catch (error) {
    destroyClient = await safeRollback(client, error);
    throw error;
  } finally {
    client.release(destroyClient);
  }
}

export async function saveSessionWithExecutor(executor, userId, snapshot) {
  const existing = await executor.query(
    'SELECT updated_at_ms FROM public.chat_sessions WHERE user_id = $1 AND id = $2',
    [userId, snapshot.session.id]
  );
  if (
    existing.rowCount > 0 &&
    Number(existing.rows[0].updated_at_ms) > snapshot.session.updatedAt
  ) {
    return {
      data: await loadSession(executor, userId, snapshot.session.id),
      action: 'skipped',
    };
  }

  await executor.query(
    `INSERT INTO public.chat_sessions (
       id, user_id, space_id, title, created_at_ms, updated_at_ms
     )
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, id) DO UPDATE
     SET space_id = EXCLUDED.space_id,
         title = EXCLUDED.title,
         created_at_ms = EXCLUDED.created_at_ms,
         updated_at_ms = EXCLUDED.updated_at_ms`,
    [
      snapshot.session.id,
      userId,
      snapshot.session.spaceId,
      snapshot.session.title,
      snapshot.session.createdAt,
      snapshot.session.updatedAt,
    ]
  );

  await executor.query(
    'DELETE FROM public.chat_messages WHERE user_id = $1 AND session_id = $2',
    [userId, snapshot.session.id]
  );
  for (const message of snapshot.messages) {
    await executor.query(
      `INSERT INTO public.chat_messages (
         id, user_id, session_id, role, content, timestamp_ms,
         tool_calls, ui_blocks, submitted_form_summary,
         form_submission_state, workflow_process_steps
       )
       VALUES (
         $1, $2, $3, $4, $5, $6,
         $7::jsonb, $8::jsonb, $9::jsonb, $10, $11::jsonb
       )`,
      [
        message.id,
        userId,
        snapshot.session.id,
        message.role,
        message.content,
        message.timestamp,
        JSON.stringify(message.toolCalls),
        JSON.stringify(message.uiBlocks),
        JSON.stringify(message.submittedFormSummary),
        message.formSubmissionState ?? null,
        JSON.stringify(message.workflowProcessSteps),
      ]
    );
  }

  return {
    data: await loadSession(executor, userId, snapshot.session.id),
    action: existing.rowCount === 0 ? 'imported' : 'updated',
  };
}

export async function saveSession(userId, snapshot) {
  const pool = getDatabasePool();
  const client = await pool.connect();
  let destroyClient = false;
  try {
    await client.query('BEGIN');
    const result = await saveSessionWithExecutor(client, userId, snapshot);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    destroyClient = await safeRollback(client, error);
    throw error;
  } finally {
    client.release(destroyClient);
  }
}

export async function listSessions(userId, spaceId, hasSpaceFilter) {
  const sessionResult = await query(
    `SELECT *
     FROM public.chat_sessions
     WHERE user_id = $1
       AND (NOT $3::boolean OR space_id IS NOT DISTINCT FROM $2)
     ORDER BY updated_at_ms DESC, id ASC`,
    [userId, spaceId, hasSpaceFilter]
  );
  if (sessionResult.rowCount === 0) return [];

  const messageResult = await query(
    `SELECT m.*
     FROM public.chat_messages m
     JOIN public.chat_sessions s
       ON s.user_id = m.user_id
      AND s.id = m.session_id
     WHERE s.user_id = $1
       AND (NOT $3::boolean OR s.space_id IS NOT DISTINCT FROM $2)
     ORDER BY m.timestamp_ms ASC, m.id ASC`,
    [userId, spaceId, hasSpaceFilter]
  );
  const messagesBySession = new Map();
  for (const row of messageResult.rows) {
    const messages = messagesBySession.get(row.session_id) || [];
    messages.push(mapMessage(row));
    messagesBySession.set(row.session_id, messages);
  }
  return sessionResult.rows.map(row => (
    mapSession(row, messagesBySession.get(row.id) || [])
  ));
}

export async function getSession(userId, sessionId) {
  return loadSession({ query }, userId, sessionId);
}

export async function deleteSession(userId, sessionId) {
  const result = await query(
    'DELETE FROM public.chat_sessions WHERE user_id = $1 AND id = $2 RETURNING id',
    [userId, sessionId]
  );
  return result.rowCount > 0;
}

export async function importLocalData(userId, spaces, sessions) {
  const pool = getDatabasePool();
  const client = await pool.connect();
  let destroyClient = false;
  const summary = {
    spaces: { imported: 0, updated: 0, skipped: 0 },
    sessions: { imported: 0, updated: 0, skipped: 0 },
  };
  try {
    await client.query('BEGIN');
    for (const space of spaces) {
      const result = await upsertSpaceWithExecutor(client, userId, space);
      summary.spaces[result.action] += 1;
    }
    for (const session of sessions) {
      const result = await saveSessionWithExecutor(client, userId, session);
      summary.sessions[result.action] += 1;
    }
    await client.query('COMMIT');
    return summary;
  } catch (error) {
    destroyClient = await safeRollback(client, error);
    throw error;
  } finally {
    client.release(destroyClient);
  }
}

export default {
  upsertSpace,
  listSpaces,
  getSpace,
  softDeleteSpace,
  restoreSpace,
  permanentlyDeleteSpace,
  saveSession,
  listSessions,
  getSession,
  deleteSession,
  importLocalData,
};
