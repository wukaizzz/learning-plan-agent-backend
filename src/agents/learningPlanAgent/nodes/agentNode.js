import { AIMessage, SystemMessage } from '@langchain/core/messages';
import { getChatModel } from '../../../services/llmService.js';
import { buildSystemPrompt } from '../prompt.js';
import { agentTools } from '../tools/index.js';

function getOnEvent(config) {
  return config?.configurable?.onEvent || (() => {});
}

function getExecutionId(config, state) {
  return config?.configurable?.executionId || state.executionId;
}

function getTextContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(part => typeof part === 'string' ? part : part?.text || '')
      .join('');
  }
  return '';
}

function emitAgentStep(config, state, payload) {
  const executionId = getExecutionId(config, state);
  if (!executionId) return;
  getOnEvent(config)({
    type: 'agent_step_update',
    executionId,
    ...payload
  });
}

export async function agentNode(state, config) {
  const iteration = (state.iterationCount || 0) + 1;
  const stepId = `agent_decide_${iteration}`;

  emitAgentStep(config, state, {
    stepId,
    status: 'running',
    title: `第 ${iteration} 轮：分析用户请求并决策`,
    summary: '正在判断是否需要调用学习计划工具。'
  });

  try {
    const model = getChatModel({ temperature: 0.2 }).bindTools(agentTools);
    const systemPrompt = buildSystemPrompt({
      planData: state.planData,
      intent: state.intent,
      studySpaceId: state.studySpaceId
    });
    const response = await model.invoke([
      new SystemMessage(systemPrompt),
      ...(state.messages || [])
    ]);
    const toolCalls = Array.isArray(response.tool_calls) ? response.tool_calls : [];
    const content = getTextContent(response.content);

    emitAgentStep(config, state, {
      stepId,
      status: 'completed',
      title: `第 ${iteration} 轮：分析用户请求并决策`,
      summary: toolCalls.length > 0
        ? `决定调用工具：${toolCalls.map(call => call.name).join('、')}`
        : (content.slice(0, 120) || '已得到最终回答。'),
      metadata: {
        iteration,
        toolCalls: toolCalls.map(call => ({ name: call.name, args: call.args }))
      }
    });

    return {
      messages: [response],
      iterationCount: iteration
    };
  } catch (error) {
    emitAgentStep(config, state, {
      stepId,
      status: 'failed',
      title: `第 ${iteration} 轮：分析用户请求并决策`,
      summary: error.message || '模型决策失败'
    });

    return {
      messages: [new AIMessage('我暂时无法完成这次学习计划分析，请稍后再试。')],
      iterationCount: iteration,
      status: 'failed',
      responseText: error.message || 'Agent decision failed'
    };
  }
}

