import express from 'express';
import { streamDoubao } from '../controllers/doubaoController.js';

const router = express.Router();

router.post('/', streamDoubao);

export default router;
