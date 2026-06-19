import express from 'express';
import { resolveUser } from '../middleware/resolveUser.js';
import {
  deleteSession,
  getSession,
  getSpace,
  importLocalData,
  listSessions,
  listSpaces,
  permanentlyDeleteSpace,
  restoreSpace,
  saveSession,
  saveSpace,
  softDeleteSpace,
} from '../controllers/spaceChatPersistenceController.js';

const router = express.Router();
router.use(resolveUser);

router.get('/study-spaces', listSpaces);
router.get('/study-spaces/:spaceId', getSpace);
router.put('/study-spaces/:spaceId', saveSpace);
router.delete('/study-spaces/:spaceId', softDeleteSpace);
router.post('/study-spaces/:spaceId/restore', restoreSpace);
router.delete('/study-spaces/:spaceId/permanent', permanentlyDeleteSpace);

router.get('/chat-sessions', listSessions);
router.get('/chat-sessions/:sessionId', getSession);
router.put('/chat-sessions/:sessionId', saveSession);
router.delete('/chat-sessions/:sessionId', deleteSession);

router.post('/persistence/import-local-v1', importLocalData);

export default router;
