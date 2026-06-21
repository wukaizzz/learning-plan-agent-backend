import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import chatRouter from './routes/chat.js';
import doubaoRouter from './routes/doubao.js';
import mimoRouter from './routes/mimo.js';
import toolRouter from './routes/tool.js';
import workflowRouter from './routes/workflowRoutes.js';
import planPersistenceRouter from './routes/planPersistenceRoutes.js';
import spaceChatPersistenceRouter from './routes/spaceChatPersistenceRoutes.js';
import { checkDatabaseConnection } from './db/pool.js';
import {
  getCheckpointerStatus,
  initializeCheckpointer,
} from './utils/checkpointer.js';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/chat', chatRouter);
app.use('/api/doubao', doubaoRouter);
app.use('/api/mimo', mimoRouter);
app.use('/api/tool', toolRouter);
app.use('/api/workflows', workflowRouter);
app.use('/api', planPersistenceRouter);
app.use('/api', spaceChatPersistenceRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      deepseek: !!config.deepseek.apiKey,
      doubao: !!config.ark.apiKey,
      mimo: !!config.mimo.apiKey,
      langgraph: true,
      database: config.database.enabled,
      checkpointer: getCheckpointerStatus(),
    },
    version: '1.1.0'
  });
});

app.get('/health/db', async (req, res) => {
  if (!config.database.enabled) {
    return res.status(503).json({
      status: 'not_configured',
      message: 'Set DATABASE_URL in .env to enable PostgreSQL.'
    });
  }

  try {
    const database = await checkDatabaseConnection();
    res.json({
      status: 'ok',
      database
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      error: error.message
    });
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

await initializeCheckpointer();

app.listen(config.server.port, () => {
  console.log(`Backend server running on port ${config.server.port}`);
  console.log(`Health check: http://localhost:${config.server.port}/health`);
});
