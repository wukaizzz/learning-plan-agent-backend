import * as repository from '../repositories/spaceChatRepository.js';
import { PersistenceError } from './planPersistenceService.js';

const SPACE_STATUSES = new Set(['planning', 'active', 'paused', 'completed']);
const MESSAGE_ROLES = new Set(['user', 'assistant', 'system']);
const FORM_STATES = new Set(['idle', 'submitting', 'submitted']);

function requireString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PersistenceError(`${field} is required`, 'VALIDATION_ERROR');
  }
  return value.trim();
}

function optionalString(value) {
  if (value === undefined || value === null || value === '') return undefined;
  return String(value);
}

function requireTimestamp(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new PersistenceError(`${field} must be a positive timestamp`, 'VALIDATION_ERROR');
  }
  return Math.trunc(number);
}

function optionalTimestamp(value) {
  if (value === undefined || value === null || value === '') return undefined;
  return requireTimestamp(value, 'timestamp');
}

function requireObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PersistenceError(`${field} must be an object`, 'VALIDATION_ERROR');
  }
  return value;
}

function requireArray(value, field) {
  if (!Array.isArray(value)) {
    throw new PersistenceError(`${field} must be an array`, 'VALIDATION_ERROR');
  }
  return value;
}

function normalizeSpace(payload) {
  const source = payload.space && typeof payload.space === 'object'
    ? payload.space
    : payload;
  const status = source.status || 'planning';
  if (!SPACE_STATUSES.has(status)) {
    throw new PersistenceError('space.status is invalid', 'VALIDATION_ERROR');
  }
  return {
    id: requireString(source.id, 'space.id'),
    name: requireString(source.name, 'space.name'),
    description: optionalString(source.description) || '',
    color: requireString(source.color, 'space.color'),
    goal: requireObject(source.goal || {}, 'space.goal'),
    subjects: requireArray(source.subjects || [], 'space.subjects'),
    schedule: requireObject(source.schedule || {}, 'space.schedule'),
    status,
    currentPhase: optionalString(source.currentPhase) || '准备阶段',
    stats: requireObject(source.stats || {}, 'space.stats'),
    createdAt: requireTimestamp(source.createdAt, 'space.createdAt'),
    updatedAt: requireTimestamp(source.updatedAt, 'space.updatedAt'),
    lastActiveAt: requireTimestamp(source.lastActiveAt, 'space.lastActiveAt'),
    isDeleted: Boolean(source.isDeleted),
    deletedAt: optionalTimestamp(source.deletedAt),
    deletionScheduledAt: optionalTimestamp(source.deletionScheduledAt),
  };
}

function normalizeMessage(message) {
  const role = requireString(message.role, 'message.role');
  if (!MESSAGE_ROLES.has(role)) {
    throw new PersistenceError('message.role is invalid', 'VALIDATION_ERROR');
  }
  const formState = optionalString(message.form_submission_state ?? message.formSubmissionState);
  if (formState && !FORM_STATES.has(formState)) {
    throw new PersistenceError('message.formSubmissionState is invalid', 'VALIDATION_ERROR');
  }
  return {
    id: requireString(message.id, 'message.id'),
    role,
    content: typeof message.content === 'string' ? message.content : '',
    timestamp: requireTimestamp(message.timestamp, 'message.timestamp'),
    toolCalls: requireArray(message.tool_calls ?? message.toolCalls ?? [], 'message.toolCalls'),
    uiBlocks: requireArray(message.ui_blocks ?? message.uiBlocks ?? [], 'message.uiBlocks'),
    submittedFormSummary: requireArray(
      message.submitted_form_summary ?? message.submittedFormSummary ?? [],
      'message.submittedFormSummary'
    ),
    formSubmissionState: formState,
    workflowProcessSteps: requireArray(
      message.workflow_process_steps ?? message.workflowProcessSteps ?? [],
      'message.workflowProcessSteps'
    ),
  };
}

function normalizeSessionSnapshot(payload) {
  const session = requireObject(payload.session, 'session');
  const spaceId = session.spaceId === null || session.spaceId === undefined
    ? null
    : requireString(session.spaceId, 'session.spaceId');
  return {
    session: {
      id: requireString(session.id, 'session.id'),
      spaceId,
      title: requireString(session.title || '新对话', 'session.title'),
      createdAt: requireTimestamp(session.createdAt, 'session.createdAt'),
      updatedAt: requireTimestamp(session.updatedAt, 'session.updatedAt'),
    },
    messages: requireArray(payload.messages || [], 'messages').map(normalizeMessage),
  };
}

function requireFound(value, label) {
  if (!value) {
    throw new PersistenceError(`${label} not found`, `${label.toUpperCase()}_NOT_FOUND`, 404);
  }
  return value;
}

export async function listSpaces(userId, includeDeleted) {
  return repository.listSpaces(userId, includeDeleted);
}

export async function getSpace(userId, spaceId) {
  return requireFound(
    await repository.getSpace(userId, requireString(spaceId, 'spaceId')),
    'space'
  );
}

export async function saveSpace(userId, spaceId, payload) {
  const space = normalizeSpace(payload);
  if (space.id !== requireString(spaceId, 'spaceId')) {
    throw new PersistenceError('space.id must match route spaceId', 'VALIDATION_ERROR');
  }
  return repository.upsertSpace(userId, space);
}

export async function softDeleteSpace(userId, spaceId) {
  const now = Date.now();
  return requireFound(
    await repository.softDeleteSpace(
      userId,
      requireString(spaceId, 'spaceId'),
      now,
      now + 30 * 24 * 60 * 60 * 1000
    ),
    'space'
  );
}

export async function restoreSpace(userId, spaceId) {
  return requireFound(
    await repository.restoreSpace(
      userId,
      requireString(spaceId, 'spaceId'),
      Date.now()
    ),
    'space'
  );
}

export async function permanentlyDeleteSpace(userId, spaceId) {
  return repository.permanentlyDeleteSpace(userId, requireString(spaceId, 'spaceId'));
}

export async function listSessions(userId, query) {
  const hasSpaceFilter = Object.prototype.hasOwnProperty.call(query, 'spaceId');
  const spaceId = hasSpaceFilter && query.spaceId !== 'null'
    ? requireString(query.spaceId, 'spaceId')
    : null;
  return repository.listSessions(userId, spaceId, hasSpaceFilter);
}

export async function getSession(userId, sessionId) {
  return requireFound(
    await repository.getSession(userId, requireString(sessionId, 'sessionId')),
    'session'
  );
}

export async function saveSession(userId, sessionId, payload) {
  const snapshot = normalizeSessionSnapshot(payload);
  if (snapshot.session.id !== requireString(sessionId, 'sessionId')) {
    throw new PersistenceError('session.id must match route sessionId', 'VALIDATION_ERROR');
  }
  return repository.saveSession(userId, snapshot);
}

export async function deleteSession(userId, sessionId) {
  const deleted = await repository.deleteSession(
    userId,
    requireString(sessionId, 'sessionId')
  );
  return { deleted };
}

export async function importLocalData(userId, payload) {
  const spaces = requireArray(payload.studySpaces || [], 'studySpaces').map(normalizeSpace);
  const sessions = requireArray(payload.chatSessions || [], 'chatSessions')
    .map(normalizeSessionSnapshot);
  return repository.importLocalData(userId, spaces, sessions);
}

export default {
  listSpaces,
  getSpace,
  saveSpace,
  softDeleteSpace,
  restoreSpace,
  permanentlyDeleteSpace,
  listSessions,
  getSession,
  saveSession,
  deleteSession,
  importLocalData,
};
