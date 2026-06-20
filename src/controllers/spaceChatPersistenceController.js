import * as service from '../services/spaceChatPersistenceService.js';
import { PersistenceError } from '../services/planPersistenceService.js';

function success(res, data, status = 200) {
  return res.status(status).json({ success: true, data, error: null });
}

function failure(res, error) {
  const normalizedError = !(error instanceof PersistenceError) && error?.code === '23503'
    ? new PersistenceError(
        'Study space must be synchronized before its related data',
        'SPACE_DEPENDENCY_NOT_READY',
        409
      )
    : error;
  const known = normalizedError instanceof PersistenceError;
  if (!known) console.error(error);
  return res.status(known ? normalizedError.status : 500).json({
    success: false,
    data: null,
    error: {
      message: normalizedError.message || 'Internal server error',
      code: known ? normalizedError.code : 'INTERNAL_SERVER_ERROR',
      ...(known && normalizedError.details !== undefined
        ? { details: normalizedError.details }
        : {}),
    },
  });
}

export async function listSpaces(req, res) {
  try {
    return success(
      res,
      await service.listSpaces(req.userId, req.query.includeDeleted === 'true')
    );
  } catch (error) {
    return failure(res, error);
  }
}

export async function getSpace(req, res) {
  try {
    return success(res, await service.getSpace(req.userId, req.params.spaceId));
  } catch (error) {
    return failure(res, error);
  }
}

export async function saveSpace(req, res) {
  try {
    return success(
      res,
      await service.saveSpace(req.userId, req.params.spaceId, req.body)
    );
  } catch (error) {
    return failure(res, error);
  }
}

export async function softDeleteSpace(req, res) {
  try {
    return success(res, await service.softDeleteSpace(req.userId, req.params.spaceId));
  } catch (error) {
    return failure(res, error);
  }
}

export async function restoreSpace(req, res) {
  try {
    return success(res, await service.restoreSpace(req.userId, req.params.spaceId));
  } catch (error) {
    return failure(res, error);
  }
}

export async function permanentlyDeleteSpace(req, res) {
  try {
    return success(
      res,
      await service.permanentlyDeleteSpace(req.userId, req.params.spaceId)
    );
  } catch (error) {
    return failure(res, error);
  }
}

export async function listSessions(req, res) {
  try {
    return success(res, await service.listSessions(req.userId, req.query));
  } catch (error) {
    return failure(res, error);
  }
}

export async function getSession(req, res) {
  try {
    return success(res, await service.getSession(req.userId, req.params.sessionId));
  } catch (error) {
    return failure(res, error);
  }
}

export async function saveSession(req, res) {
  try {
    return success(
      res,
      await service.saveSession(req.userId, req.params.sessionId, req.body)
    );
  } catch (error) {
    return failure(res, error);
  }
}

export async function deleteSession(req, res) {
  try {
    return success(res, await service.deleteSession(req.userId, req.params.sessionId));
  } catch (error) {
    return failure(res, error);
  }
}

export async function importLocalData(req, res) {
  try {
    return success(res, await service.importLocalData(req.userId, req.body));
  } catch (error) {
    return failure(res, error);
  }
}
