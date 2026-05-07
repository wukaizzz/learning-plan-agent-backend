import axios from 'axios';
import { workflowEventGenerator } from './workflowService.js';

const DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions';

export async function streamDeepSeekChat(messages, agentConfig, onChunk) {
  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY is not configured');
  }

  const systemPrompt = agentConfig?.system_prompt || 'You are a helpful AI assistant.';
  const temperature = agentConfig?.temperature || 0.7;
  const maxTokens = agentConfig?.max_tokens || 1024;

  // 检查是否启用工作流事件
  const enableWorkflow = agentConfig?.enableWorkflow !== false; // 默认启用

  try {
    // 如果启用工作流且是用户消息，先生成工作流事件
    if (enableWorkflow && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.role === 'user') {
        // 异步生成工作流事件
        (async () => {
          try {
            for await (const event of workflowEventGenerator.generateEventsFromMessage(lastMessage.content)) {
              onChunk(event);
            }
          } catch (error) {
            console.error('Workflow event generation error:', error);
          }
        })();
      }
    }

    // 调用DeepSeek API
    const response = await axios.post(DEEPSEEK_API_URL, {
      model: 'deepseek-chat',
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
            // ✅ 安全解析：先清理SSE格式，检查是否为空或[DONE]
            let cleanChunk = data.trim();

            // 只在不是空且不是[DONE]时才解析
            if (cleanChunk && cleanChunk !== '[DONE]') {
              const parsed = JSON.parse(cleanChunk);
              const content = parsed.choices?.[0]?.delta?.content;

              if (content) {
                fullContent += content;
                onChunk({
                  type: 'content',
                  content
                });
              }
            }
          } catch (e) {
            // 忽略不完整的流式chunk，继续处理下一个
            console.log('忽略不完整的流式chunk:', e.message);
            continue;
          }
        }
      }
    }

    onChunk({ type: 'done' });
  } catch (error) {
    if (error.response) {
      console.error('DeepSeek API error:', error.response.status, error.response.data);
      throw new Error(`DeepSeek API error: ${error.response.status}`);
    } else {
      console.error('Request error:', error.message);
      throw new Error(`Request failed: ${error.message}`);
    }
  }
}
