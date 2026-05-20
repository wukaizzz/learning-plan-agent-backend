/**
 * LLM 服务层
 * 封装 DeepSeek 双模型调用（R1 推理 + V3 对话）
 * 统一为 LangChain ChatOpenAI 接口，与 LangGraph 生态集成
 */

import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { config } from '../config.js';

let _reasonerModel = null;
let _chatModel = null;

export function getReasonerModel() {
  if (!_reasonerModel) {
    _reasonerModel = new ChatOpenAI({
      modelName: 'deepseek-reasoner',
      apiKey: config.deepseek.apiKey,
      configuration: { baseURL: config.deepseek.baseUrl },
      maxTokens: 8192,
    });
  }
  return _reasonerModel;
}

export function getChatModel(options = {}) {
  if (!_chatModel) {
    _chatModel = new ChatOpenAI({
      modelName: 'deepseek-chat',
      apiKey: config.deepseek.apiKey,
      configuration: { baseURL: config.deepseek.baseUrl },
      temperature: options.temperature ?? 0.3,
      maxTokens: options.maxTokens ?? 4096,
    });
  }
  return _chatModel;
}

/**
 * 使用 R1 推理模型进行流式思考
 * - reasoning_content → 通过 onThinking 回调推送
 * - content → 作为最终回答返回
 *
 * @param {string} prompt - 分析提示词
 * @param {object} callbacks
 * @param {(token: string) => void} [callbacks.onThinking] - 思考 token 回调
 * @param {(token: string) => void} [callbacks.onContent] - 正式回答 token 回调
 * @returns {Promise<{thinkingText: string, contentText: string}>}
 */
export async function streamReasoner(prompt, { onThinking, onContent } = {}) {
  const model = getReasonerModel();
  let thinkingText = '';
  let contentText = '';

  const stream = await model.stream([
    { role: 'user', content: prompt },
  ]);

  for await (const chunk of stream) {
    const reasoning = chunk?.additional_kwargs?.reasoning_content;
    const content = chunk?.content;

    if (reasoning) {
      thinkingText += reasoning;
      onThinking?.(reasoning);
    }

    if (content) {
      contentText += content;
      onContent?.(content);
    }
  }

  return { thinkingText, contentText };
}

/**
 * 使用 V3 对话模型进行流式输出
 *
 * @param {string} prompt - 提示词
 * @param {object} callbacks
 * @param {(token: string) => void} [callbacks.onContent] - token 回调
 * @returns {Promise<string>} 完整回答文本
 */
export async function streamChat(prompt, { onContent } = {}) {
  const model = getChatModel();
  let contentText = '';

  const stream = await model.stream([
    { role: 'user', content: prompt },
  ]);

  for await (const chunk of stream) {
    const content = chunk?.content;
    if (content) {
      contentText += content;
      onContent?.(content);
    }
  }

  return contentText;
}

/**
 * 使用 V3 对话模型 + Function Calling 输出结构化 JSON
 * 方案 C：通过 bindTools + Zod schema 实现结构化输出
 * 比 withStructuredOutput 更兼容 DeepSeek API（不依赖 json_schema 响应格式）
 *
 * 设计原则：结构化输出节点专用，不混入业务工具 schema
 *
 * @param {string} prompt - 提示词
 * @param {z.ZodSchema} schema - Zod schema
 * @param {object} [options]
 * @param {string} [options.systemPrompt] - 系统提示词
 * @param {string} [options.toolName] - 工具名称（默认 structured_output）
 * @returns {Promise<z.infer<typeof schema>>} 校验后的结构化数据
 */
export async function structuredOutput(prompt, schema, { systemPrompt, toolName = 'structured_output' } = {}) {
  const model = getChatModel();

  const jsonSchema = z.toJSONSchema(schema);
  const tool = {
    type: 'function',
    function: {
      name: toolName,
      description: '按照指定格式输出结构化数据',
      parameters: jsonSchema,
    },
  };

  const modelWithTool = model.bindTools([tool]);

  const messages = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const result = await modelWithTool.invoke(messages);

  const toolCall = result.tool_calls?.[0];
  if (!toolCall) {
    throw new Error('LLM did not call structured output tool');
  }

  return schema.parse(toolCall.args);
}

/**
 * 使用 V3 对话模型进行流式思考（模拟推理过程）
 * 当 R1 不可用或需要 Function Calling 兼容时的备选方案
 * 通过 prompt 工程让模型先输出思考过程，再输出结构化结果
 *
 * @param {string} prompt - 提示词
 * @param {object} callbacks
 * @param {(token: string) => void} [callbacks.onThinking] - 思考 token 回调
 * @param {(token: string) => void} [callbacks.onContent] - 正式回答 token 回调
 * @returns {Promise<{thinkingText: string, contentText: string}>}
 */
export async function streamChatWithThinking(prompt, { onThinking, onContent } = {}) {
  const model = getChatModel();
  let thinkingText = '';
  let contentText = '';
  let inThinkingBlock = false;
  let thinkingDone = false;

  const thinkPrompt = `请先在 <thinking>...</thinking> 标签中展示你的分析思考过程，然后在标签外给出正式回答。

${prompt}`;

  const stream = await model.stream([
    { role: 'user', content: thinkPrompt },
  ]);

  let buffer = '';

  for await (const chunk of stream) {
    const content = chunk?.content;
    if (!content) continue;

    buffer += content;

    if (!thinkingDone) {
      const thinkStartIdx = buffer.indexOf('<thinking>');
      if (thinkStartIdx !== -1 && !inThinkingBlock) {
        inThinkingBlock = true;
        buffer = buffer.slice(thinkStartIdx + '<thinking>'.length);
      }

      if (inThinkingBlock) {
        const thinkEndIdx = buffer.indexOf('</thinking>');
        if (thinkEndIdx !== -1) {
          const lastThinkingPart = buffer.slice(0, thinkEndIdx);
          thinkingText += lastThinkingPart;
          onThinking?.(lastThinkingPart);
          buffer = buffer.slice(thinkEndIdx + '</thinking>'.length);
          thinkingDone = true;
          onThinking?.('');
        } else {
          thinkingText += buffer;
          onThinking?.(buffer);
          buffer = '';
        }
      }
    }

    if (thinkingDone && buffer.length > 0) {
      contentText += buffer;
      onContent?.(buffer);
      buffer = '';
    }
  }

  if (!thinkingDone && buffer.length > 0) {
    contentText += buffer;
    onContent?.(buffer);
  }

  return { thinkingText, contentText };
}

export default {
  getReasonerModel,
  getChatModel,
  streamReasoner,
  streamChat,
  structuredOutput,
  streamChatWithThinking,
};
