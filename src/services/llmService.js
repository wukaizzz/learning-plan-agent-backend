/**
 * LLM 服务层
 * 封装 DeepSeek 双模型调用（R1 推理 + V3 对话）
 * 统一为 LangChain ChatOpenAI 接口，与 LangGraph 生态集成
 */

import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { config } from '../config.js';

let _reasonerModel = null;
const _chatModels = new Map();

const STRUCTURED_OUTPUT_ERROR_MESSAGES = {
  missing_tool_call: 'Required structured output tool was not called',
  multiple_tool_calls: 'Expected exactly one structured output tool call',
  unexpected_tool_call: 'Unexpected structured output tool was called',
  invalid_tool_arguments: 'Structured output tool arguments are invalid',
};

export class StructuredOutputError extends Error {
  constructor(code, { toolName, actualName, count, issues } = {}) {
    super(STRUCTURED_OUTPUT_ERROR_MESSAGES[code] || 'Structured output failed');
    this.name = 'StructuredOutputError';
    this.code = code;
    this.toolName = toolName;

    if (actualName !== undefined) this.actualName = actualName;
    if (count !== undefined) this.count = count;
    if (issues !== undefined) this.issues = issues;
  }
}

export class ReasonerTimeoutError extends Error {
  constructor(timeoutMillis, cause) {
    super(`DeepSeek reasoner exceeded ${timeoutMillis}ms`, cause ? { cause } : undefined);
    this.name = 'ReasonerTimeoutError';
    this.code = 'REASONER_TIMEOUT';
    this.timeoutMillis = timeoutMillis;
  }
}

function isTimeoutLikeError(error) {
  const code = String(error?.code || '').toUpperCase();
  const name = String(error?.name || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return code === 'ETIMEDOUT' ||
    name.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('timeout');
}

export function getReasonerModel() {
  if (!_reasonerModel) {
    _reasonerModel = new ChatOpenAI({
      modelName: 'deepseek-reasoner',
      apiKey: config.deepseek.apiKey,
      configuration: { baseURL: config.deepseek.baseUrl },
      maxTokens: 8192,
      maxRetries: 0,
      timeout: config.deepseek.reasonerTimeoutMillis,
    });
  }
  return _reasonerModel;
}

export function getChatModel(options = {}) {
  const modelName = options.modelName ?? 'deepseek-chat';
  const temperature = options.temperature ?? 0.3;
  const maxTokens = options.maxTokens ?? 4096;
  const cacheKey = `${modelName}|t=${temperature}|m=${maxTokens}`;

  if (!_chatModels.has(cacheKey)) {
    _chatModels.set(cacheKey, new ChatOpenAI({
      modelName,
      apiKey: config.deepseek.apiKey,
      configuration: { baseURL: config.deepseek.baseUrl },
      temperature,
      maxTokens,
    }));
  }

  return _chatModels.get(cacheKey);
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
export async function consumeReasonerStream(
  streamFactory,
  {
    onThinking,
    onContent,
    timeoutMillis = config.deepseek.reasonerTimeoutMillis,
  } = {}
) {
  const controller = new AbortController();
  let thinkingText = '';
  let contentText = '';
  let timedOut = false;
  let timeoutId;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new ReasonerTimeoutError(timeoutMillis));
    }, timeoutMillis);
  });

  const consumePromise = (async () => {
    const stream = await streamFactory(controller.signal);

    for await (const chunk of stream) {
      if (timedOut) {
        throw new ReasonerTimeoutError(timeoutMillis);
      }

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
  })();

  try {
    return await Promise.race([consumePromise, timeoutPromise]);
  } catch (error) {
    if (error instanceof ReasonerTimeoutError) {
      throw error;
    }
    if (timedOut || isTimeoutLikeError(error)) {
      throw new ReasonerTimeoutError(timeoutMillis, error);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function streamReasoner(prompt, callbacks = {}) {
  const model = getReasonerModel();
  return consumeReasonerStream(
    signal => model.stream(
      [{ role: 'user', content: prompt }],
      { signal }
    ),
    callbacks
  );
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
export function buildStructuredToolBindingOptions(toolName) {
  return {
    tool_choice: {
      type: 'function',
      function: { name: toolName },
    },
  };
}

export function parseStructuredToolCall(result, schema, toolName) {
  const toolCalls = Array.isArray(result?.tool_calls) ? result.tool_calls : [];
  const invalidToolCalls = Array.isArray(result?.invalid_tool_calls) ? result.invalid_tool_calls : [];
  const totalCalls = toolCalls.length + invalidToolCalls.length;

  if (totalCalls === 0) {
    throw new StructuredOutputError('missing_tool_call', { toolName, count: 0 });
  }

  if (totalCalls > 1) {
    throw new StructuredOutputError('multiple_tool_calls', { toolName, count: totalCalls });
  }

  if (invalidToolCalls.length === 1) {
    const invalidCall = invalidToolCalls[0];
    throw new StructuredOutputError('invalid_tool_arguments', {
      toolName,
      actualName: invalidCall.name,
      issues: [{
        path: [],
        code: 'invalid_tool_call',
        message: invalidCall.error || 'Tool arguments could not be parsed',
      }],
    });
  }

  const toolCall = toolCalls[0];
  if (toolCall.name !== toolName) {
    throw new StructuredOutputError('unexpected_tool_call', {
      toolName,
      actualName: toolCall.name,
    });
  }

  const parsed = schema.safeParse(toolCall.args);
  if (!parsed.success) {
    throw new StructuredOutputError('invalid_tool_arguments', {
      toolName,
      actualName: toolCall.name,
      issues: parsed.error.issues.map(issue => ({
        path: issue.path,
        code: issue.code,
        message: issue.message,
      })),
    });
  }

  return parsed.data;
}

export async function structuredOutput(prompt, schema, { systemPrompt, toolName = 'structured_output' } = {}) {
  const model = getChatModel({ temperature: 0 });

  const jsonSchema = z.toJSONSchema(schema);
  const tool = {
    type: 'function',
    function: {
      name: toolName,
      description: '按照指定格式输出结构化数据',
      parameters: jsonSchema,
    },
  };

  const modelWithTool = model.bindTools(
    [tool],
    buildStructuredToolBindingOptions(toolName)
  );

  const messages = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const result = await modelWithTool.invoke(messages);
  return parseStructuredToolCall(result, schema, toolName);
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
  StructuredOutputError,
  ReasonerTimeoutError,
  getReasonerModel,
  getChatModel,
  consumeReasonerStream,
  streamReasoner,
  streamChat,
  buildStructuredToolBindingOptions,
  parseStructuredToolCall,
  structuredOutput,
  streamChatWithThinking,
};
