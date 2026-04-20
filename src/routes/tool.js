import express from 'express';
import { executeTool } from '../controllers/toolController.js';

const router = express.Router();

router.post('/', executeTool);

export default router;
