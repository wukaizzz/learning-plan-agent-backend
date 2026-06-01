import { isAIMessage } from '@langchain/core/messages';

const V1_NOTICE = 'V1 说明：以上为分析和建议，暂未实际修改学习计划。';

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

function findLastAIText(messages = []) {
  for (const message of [...messages].reverse()) {
    if (!isAIMessage(message)) continue;
    const text = getTextContent(message.content).trim();
    if (text) return text;
  }
  return '';
}

function appendV1Notice(text) {
  const base = text?.trim() || '我已经完成当前学习计划分析，但没有生成足够明确的结论。你可以补充具体日期、科目或任务，我再继续判断。';
  if (base.includes(V1_NOTICE)) return base;
  return `${base}\n\n${V1_NOTICE}`;
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

export async function finalizeNode(state, config) {
  emitAgentStep(config, state, {
    stepId: 'finalize',
    status: 'running',
    title: '整理最终回答',
    summary: '正在基于工具结果输出结论。'
  });

  const finalText = appendV1Notice(findLastAIText(state.messages));
  getOnEvent(config)({
    type: 'content',
    content: finalText
  });

  emitAgentStep(config, state, {
    stepId: 'finalize',
    status: 'completed',
    title: '整理最终回答',
    summary: '最终回答已输出。'
  });

  return {
    responseText: finalText,
    status: state.status === 'failed' ? 'failed' : 'completed'
  };
}

