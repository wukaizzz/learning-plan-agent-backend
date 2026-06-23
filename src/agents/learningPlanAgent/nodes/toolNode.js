import { ToolMessage } from '@langchain/core/messages';
import { toolExecutors } from '../tools/index.js';
import { buildScheduleTaskListBlock } from '../tools/getScheduleOverview.js';

function getOnEvent(config) {
  return config?.configurable?.onEvent || (() => {});
}

function getExecutionId(config, state) {
  return config?.configurable?.executionId || state.executionId;
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

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function getLastToolCalls(messages = []) {
  const lastMessage = messages[messages.length - 1];
  return Array.isArray(lastMessage?.tool_calls) ? lastMessage.tool_calls : [];
}

export async function toolNode(state, config) {
  const onEvent = getOnEvent(config);
  const executionId = getExecutionId(config, state);
  const toolCalls = getLastToolCalls(state.messages);
  const toolMessages = [];

  for (const [index, call] of toolCalls.entries()) {
    const toolName = call.name;
    const toolCallId = call.id || `${toolName}_${Date.now()}_${index}`;
    const stepId = `tool_${state.iterationCount || 0}_${index}_${toolName}`;
    const args = call.args || {};
    const baseEvent = {
      type: 'tool_call',
      id: toolCallId,
      toolName,
      parameters: args
    };

    emitAgentStep(config, state, {
      stepId,
      status: 'running',
      title: `调用工具：${toolName}`,
      summary: '正在读取当前学习计划数据。'
    });
    onEvent({ ...baseEvent, status: 'pending', message: `准备调用 ${toolName}` });
    onEvent({ ...baseEvent, status: 'executing', message: `正在调用 ${toolName}` });

    try {
      const executor = toolExecutors[toolName];
      if (!executor) {
        throw new Error(`Unsupported tool: ${toolName}`);
      }

      const resultText = await executor(args, state.planData, {
        userId: state.userId,
        studySpaceId: state.studySpaceId,
        intent: state.intent
      });
      const parsedResult = safeJsonParse(resultText);
      const scheduleBlock = toolName === 'get_schedule_overview' && parsedResult?.range
        ? buildScheduleTaskListBlock(parsedResult, { toolCallId })
        : null;
      const uiBlock = scheduleBlock || parsedResult?.uiBlock;
      if (uiBlock) {
        onEvent({
          type: 'ui_block_update',
          action: 'add',
          block: uiBlock
        });
      }
      onEvent({
        ...baseEvent,
        status: 'completed',
        result: parsedResult,
        message: `${toolName} 调用完成`
      });
      emitAgentStep(config, state, {
        stepId,
        status: 'completed',
        title: `调用工具：${toolName}`,
        summary: `${toolName} 已返回结果。`,
        metadata: { result: parsedResult }
      });
      toolMessages.push(new ToolMessage({
        content: resultText,
        name: toolName,
        tool_call_id: toolCallId
      }));
    } catch (error) {
      const resultText = JSON.stringify({
        error: error.message || 'Tool execution failed',
        toolName
      });
      onEvent({
        ...baseEvent,
        status: 'failed',
        error: error.message || 'Tool execution failed',
        message: `${toolName} 调用失败`
      });
      emitAgentStep(config, state, {
        stepId,
        status: 'failed',
        title: `调用工具：${toolName}`,
        summary: error.message || '工具调用失败'
      });
      toolMessages.push(new ToolMessage({
        content: resultText,
        name: toolName,
        tool_call_id: toolCallId
      }));
    }
  }

  return {
    messages: toolMessages
  };
}
