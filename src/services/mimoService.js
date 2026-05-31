import axios from 'axios';
import { config } from '../config.js';

export async function streamMimoChat(messages, agentConfig, onChunk) {
  const { apiKey, baseUrl, model } = config.mimo;

  if (!apiKey) {
    throw new Error('MIMO_API_KEY is not configured');
  }

  const apiUrl = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const systemPrompt = agentConfig?.system_prompt || 'You are a helpful AI assistant.';
  const temperature = agentConfig?.temperature || 0.7;
  const maxTokens = agentConfig?.max_tokens || 1024;

  try {
    const response = await axios.post(apiUrl, {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map(msg => ({
          role: msg.role,
          content: msg.content
        }))
      ],
      temperature,
      max_tokens: maxTokens,
      stream: true
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      responseType: 'stream'
    });

    console.log('MiMo API response status:', response.status);

    for await (const chunk of response.data) {
      const lines = chunk.toString().split('\n').filter(line => line.trim() !== '');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);

          if (data === '[DONE]') {
            onChunk({ type: 'done' });
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;

            if (content) {
              onChunk({ type: 'content', content });
            }
          } catch (e) {
            console.error('Failed to parse chunk:', e);
          }
        }
      }
    }

    onChunk({ type: 'done' });
  } catch (error) {
    if (error.response) {
      console.error('MiMo API error:', error.response.status, error.response.data);
      throw new Error(`MiMo API error: ${error.response.status}`);
    } else {
      console.error('Request error:', error.message);
      throw new Error(`Request failed: ${error.message}`);
    }
  }
}
