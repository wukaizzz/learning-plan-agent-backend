import { executeToolHandler } from '../services/toolService.js';

export async function executeTool(req, res) {
  const { toolName, params } = req.body;

  if (!toolName) {
    return res.status(400).json({ error: 'Tool name is required' });
  }

  try {
    const result = await executeToolHandler(toolName, params);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Tool execution error:', error);
    res.status(500).json({ error: error.message });
  }
}
