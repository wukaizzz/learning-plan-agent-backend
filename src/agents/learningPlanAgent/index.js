import { HumanMessage } from '@langchain/core/messages';
import { randomUUID } from 'crypto';
import { createLearningPlanAgentGraph } from './graph.js';

export async function runLearningPlanAgentStream({
  studySpaceId,
  userId = 'default-user',
  intent,
  userMessage,
  planData,
  onEvent = () => {}
}) {
  const executionId = randomUUID();
  const startTime = Date.now();

  onEvent({
    type: 'agent_execution_start',
    executionId,
    title: '处理学习计划请求',
    executionType: 'autonomous_agent',
    steps: [],
    metadata: {
      studySpaceId,
      userId,
      intent
    }
  });

  try {
    const graph = createLearningPlanAgentGraph();
    const initialState = {
      studySpaceId,
      userId,
      intent,
      userMessage,
      planData,
      messages: [new HumanMessage(userMessage || '请分析当前学习计划。')],
      iterationCount: 0,
      status: 'running',
      responseText: '',
      startTime,
      executionId
    };

    let finalStatus = 'completed';
    let finalText = '';
    const stream = await graph.stream(initialState, {
      configurable: { onEvent, executionId }
    });

    for await (const event of stream) {
      const nodeState = Object.values(event)[0] || {};
      if (nodeState.status) finalStatus = nodeState.status;
      if (nodeState.responseText) finalText = nodeState.responseText;
    }

    onEvent({
      type: 'agent_execution_finish',
      executionId,
      status: finalStatus === 'failed' ? 'failed' : 'completed',
      summary: finalText ? '学习计划请求处理完成。' : 'Agent 执行完成。'
    });

    return {
      executionId,
      status: finalStatus,
      responseText: finalText
    };
  } catch (error) {
    onEvent({
      type: 'content',
      content: `处理学习计划请求时出现错误：${error.message || '未知错误'}`
    });
    onEvent({
      type: 'agent_execution_finish',
      executionId,
      status: 'failed',
      summary: error.message || 'Learning plan agent failed'
    });
    return {
      executionId,
      status: 'failed',
      responseText: error.message || 'Learning plan agent failed'
    };
  }
}

