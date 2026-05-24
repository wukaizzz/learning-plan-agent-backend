import axios from 'axios';

const ARK_API_URL = process.env.ARK_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
const ARK_MODEL = process.env.ARK_MODEL || 'doubao-seed-2-0-lite-260215';

export async function streamDoubaoChat(messages, agentConfig, onChunk) {
  const apiKey = process.env.ARK_API_KEY;

  if (!apiKey) {
    throw new Error('ARK_API_KEY is not configured');
  }

  const systemPrompt = agentConfig?.system_prompt || 'You are a helpful AI assistant.';
  const temperature = agentConfig?.temperature || 0.7;
  const maxTokens = agentConfig?.max_tokens || 1024;

  try {
    const response = await axios.post(ARK_API_URL, {
      model: ARK_MODEL,
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

    console.log('Doubao API response status:', response.status);

    let fullContent = '';

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
              fullContent += content;
              onChunk({
                type: 'content',
                content
              });
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
      console.error('Doubao API error:', error.response.status, error.response.data);
      throw new Error(`Doubao API error: ${error.response.status}`);
    } else {
      console.error('Request error:', error.message);
      throw new Error(`Request failed: ${error.message}`);
    }
  }
}
