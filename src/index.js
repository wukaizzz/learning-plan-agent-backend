import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import chatRouter from './routes/chat.js';
import doubaoRouter from './routes/doubao.js';
import toolRouter from './routes/tool.js';
import workflowRouter from './routes/workflowRoutes.js';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/chat', chatRouter);
app.use('/api/doubao', doubaoRouter);
app.use('/api/tool', toolRouter);
app.use('/api/workflows', workflowRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      deepseek: !!config.deepseek.apiKey,
      doubao: !!config.ark.apiKey,
      langgraph: true
    },
    version: '1.1.0'
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(config.server.port, () => {
  console.log(`Backend server running on port ${config.server.port}`);
  console.log(`Health check: http://localhost:${config.server.port}/health`);
});
