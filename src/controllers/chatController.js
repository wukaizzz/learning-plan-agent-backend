import { runSupervisorAgent } from '../services/supervisorAgentService.js';

export async function streamChat(req, res) {
  const { messages, agentConfig, studySpaceId, spaceId: requestSpaceId } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid messages format' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const onEvent = (event) => {
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch (e) {
        console.warn('SSE write failed (client disconnected?):', e.message);
      }
    };

    await runSupervisorAgent({
      messages,
      agentConfig,
      studySpaceId,
      requestSpaceId,
      onEvent
    });

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('Chat error:', error);
    res.write(`data: ${JSON.stringify({
      type: 'error',
      error: error.message
    })}\n\n`);
    res.end();
  }
}
