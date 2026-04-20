import express from 'express';
import { streamChat } from '../controllers/chatController.js';

const router = express.Router();

router.post('/', streamChat);

export default router;
