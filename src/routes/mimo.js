import express from 'express';
import { streamMimo } from '../controllers/mimoController.js';

const router = express.Router();

router.post('/', streamMimo);

export default router;
