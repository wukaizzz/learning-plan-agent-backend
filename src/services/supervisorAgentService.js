import { streamDeepSeekChat } from './deepseekService.js';
import { structuredOutput, streamChatWithThinking } from './llmService.js';
import { executeToolHandler, getAvailableTools, isToolAllowed } from './toolService.js';
import { runInitialPlanningStream } from '../workflows/initialPlanningWorkflow.js';
import { SupervisorIntentDecisionSchema } from '../types/llmSchemas.js';
import { generateId } from '../utils/idGenerator.js';
import { logger } from '../logger/index.js';

const CONFIDENCE_THRESHOLD = 0.65;

const PLAN_KEYWORDS = ['学习计划', '制定计划', '生成计划', '帮我规划', '复习计划', '备考计划'];
const QUERY_PLAN_KEYWORDS = ['查看计划', '查询计划', '已有计划', '当前计划', '我的计划'];
const ADJUST_PLAN_KEYWORDS = ['调整计划', '修改计划', '改一下计划', '调整任务', '修改任务'];
const REPLAN_KEYWORDS = ['重新规划', '重规划', '重新制定', '重新生成计划', '重新安排'];
const SUBJECT_NAMES = ['数学', '英语', '物理', '化学', '生物', '政治', '历史', '高等数学', '大学英语'];

const INTENT_LABELS = {
  general_chat: '普通对话',
  initial_planning: '创建初次学习计划',
  tool_assisted_answer: '需要工具辅助回答',
  query_plan: '查询已有学习计划',
  adjust_plan: '调整已有学习计划',
  replan: '重新规划学习计划',
  clarification: '需要确认你的意图',
  unknown: '需要进一步确认'
};

const TOOL_LABELS = {
  calculator: '计算工具',
  weather: '天气工具',
  web_search: '搜索工具'
};

const UNSUPPORTED_INTENT_MESSAGES = {
  query_plan: '我已经识别到你想查询已有学习计划，但这个能力还没有接入真实计划数据查询。当前版本先不会假装查询结果。',
  adjust_plan: '我已经识别到你想调整已有学习计划，但调整计划工作流还没有开放。当前版本先不会直接修改计划。',
  replan: '我已经识别到你想重新规划学习计划，但重规划工作流还没有开放。当前版本先不会生成新的替代计划。'
};

function emitPublicThinking(onEvent, text) {
  for (const chunk of text.match(/.{1,12}/gu) || [text]) {
    onEvent({ type: 'thinking', content: chunk });
  }
}

function getLastUserMessage(messages = []) {
  return [...messages].reverse().find(message => message.role === 'user') || null;
}

function compactMessages(messages = []) {
  return messages
    .slice(-6)
    .map(message => `${message.role}: ${message.content}`)
    .join('\n');
}

function toIsoDateFromDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
}

function estimateExamDistance(examDate) {
  if (!examDate) return undefined;
  const target = new Date(examDate);
  if (Number.isNaN(target.getTime())) return undefined;
  const today = new Date();
  const diffMs = target.setHours(0, 0, 0, 0) - today.setHours(0, 0, 0, 0);
  return Math.max(1, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
}

function certaintyFromConfidence(confidence = 0) {
  if (confidence >= 0.7) return 'high';
  if (confidence >= 0.5) return 'medium';
  return 'low';
}

function extractPlanningSeed(content) {
  const seed = {
    goal: {
      primaryGoal: content || '生成学习计划',
      priority: 5
    },
    subjects: [],
    availability: {}
  };

  const targetScoreMatch = content.match(/(?:目标|考到|达到)?\s*(\d{2,3})\s*分/);
  if (targetScoreMatch) {
    seed.goal.targetScore = Number(targetScoreMatch[1]);
  }

  const isoDateMatch = content.match(/\b(20\d{2}-\d{1,2}-\d{1,2})\b/);
  const daysLaterMatch = content.match(/(\d+)\s*天后/);
  if (isoDateMatch) {
    seed.goal.examDate = isoDateMatch[1];
  } else if (daysLaterMatch) {
    seed.goal.examDate = toIsoDateFromDays(Number(daysLaterMatch[1]));
  }

  const dailyHoursMatch = content.match(/每天\s*(\d+(?:\.\d+)?)\s*(?:小时|h|H)/);
  if (dailyHoursMatch) {
    seed.availability.dailyHours = Number(dailyHoursMatch[1]);
  }

  const examDistance = estimateExamDistance(seed.goal.examDate);
  if (examDistance) {
    seed.availability.examDistance = examDistance;
  }

  seed.subjects = SUBJECT_NAMES
    .filter(subject => content.includes(subject))
    .map(subject => ({
      id: subject.toLowerCase().replace(/\s+/g, '_'),
      name: subject,
      currentLevel: 6,
      targetLevel: 8,
      priority: 'high'
    }));

  return removeEmptyPlanningSeed(seed);
}

function removeEmptyPlanningSeed(seed) {
  const next = {};
  if (seed.goal && Object.keys(seed.goal).length > 0) {
    next.goal = seed.goal;
  }
  if (seed.subjects?.length > 0) {
    next.subjects = seed.subjects;
  }
  if (seed.availability && Object.keys(seed.availability).length > 0) {
    next.availability = seed.availability;
  }
  return next;
}

function normalizePlanningSeed(planningSeed = {}, fallbackContent = '') {
  const fallbackSeed = extractPlanningSeed(fallbackContent);
  const merged = {
    goal: {
      ...fallbackSeed.goal,
      ...planningSeed.goal
    },
    subjects: planningSeed.subjects?.length ? planningSeed.subjects : fallbackSeed.subjects,
    availability: {
      ...fallbackSeed.availability,
      ...planningSeed.availability
    }
  };

  if (merged.goal?.examDate && !merged.availability.examDistance) {
    merged.availability.examDistance = estimateExamDistance(merged.goal.examDate);
  }

  if (merged.subjects?.length) {
    merged.subjects = merged.subjects.map((subject, index) => ({
      id: subject.id || `subject_${index + 1}`,
      name: subject.name || `科目 ${index + 1}`,
      currentLevel: subject.currentLevel || 6,
      targetLevel: subject.targetLevel || 8,
      priority: subject.priority || 'medium',
      ...(subject.weakPoints?.length ? { weakPoints: subject.weakPoints } : {})
    }));
  }

  return removeEmptyPlanningSeed(merged);
}

function buildDecision(partialDecision, source) {
  const confidence = partialDecision.confidence ?? 0;
  return {
    shouldUseTools: false,
    toolCalls: [],
    ...partialDecision,
    source,
    certainty: partialDecision.certainty || certaintyFromConfidence(confidence)
  };
}

function inferFallbackDecision(messages = []) {
  const lastUserMessage = getLastUserMessage(messages);
  const content = lastUserMessage?.content || '';

  if (REPLAN_KEYWORDS.some(keyword => content.includes(keyword))) {
    return buildDecision({
      intent: 'replan',
      confidence: 0.75,
      certainty: 'high',
      reason: '规则兜底识别到重新规划请求'
    }, 'rule_fallback');
  }

  if (ADJUST_PLAN_KEYWORDS.some(keyword => content.includes(keyword))) {
    return buildDecision({
      intent: 'adjust_plan',
      confidence: 0.75,
      certainty: 'high',
      reason: '规则兜底识别到调整计划请求'
    }, 'rule_fallback');
  }

  if (QUERY_PLAN_KEYWORDS.some(keyword => content.includes(keyword))) {
    return buildDecision({
      intent: 'query_plan',
      confidence: 0.75,
      certainty: 'high',
      reason: '规则兜底识别到查询计划请求'
    }, 'rule_fallback');
  }

  const arithmeticMatch = content.match(/[-+*/().\d\s]{3,}/);
  if (/(计算|算一下|calculate)/i.test(content) && arithmeticMatch) {
    return buildDecision({
      intent: 'tool_assisted_answer',
      confidence: 0.7,
      certainty: 'high',
      reason: '规则兜底识别到计算请求',
      shouldUseTools: true,
      toolCalls: [{
        toolName: 'calculator',
        parameters: { expression: arithmeticMatch[0].trim() },
        reason: '计算用户提供的表达式'
      }]
    }, 'rule_fallback');
  }

  if (/(天气|weather)/i.test(content)) {
    return buildDecision({
      intent: 'tool_assisted_answer',
      confidence: 0.7,
      certainty: 'high',
      reason: '规则兜底识别到天气查询',
      shouldUseTools: true,
      toolCalls: [{
        toolName: 'weather',
        parameters: { location: content.replace(/天气|weather/gi, '').trim() || '当前城市' },
        reason: '查询天气信息'
      }]
    }, 'rule_fallback');
  }

  if (/(搜索|查一下|search)/i.test(content)) {
    return buildDecision({
      intent: 'tool_assisted_answer',
      confidence: 0.7,
      certainty: 'high',
      reason: '规则兜底识别到搜索请求',
      shouldUseTools: true,
      toolCalls: [{
        toolName: 'web_search',
        parameters: { query: content },
        reason: '搜索用户请求的信息'
      }]
    }, 'rule_fallback');
  }

  if (PLAN_KEYWORDS.some(keyword => content.includes(keyword))) {
    return buildDecision({
      intent: 'initial_planning',
      confidence: 0.75,
      certainty: 'high',
      reason: '规则兜底识别到学习计划相关请求',
      planningSeed: extractPlanningSeed(content)
    }, 'rule_fallback');
  }

  if (/(学习|复习|备考|计划)/.test(content)) {
    return buildDecision({
      intent: 'clarification',
      confidence: 0.55,
      certainty: 'medium',
      reason: '规则兜底识别到学习相关表达，但无法确定具体操作'
    }, 'rule_fallback');
  }

  return buildDecision({
    intent: 'clarification',
    confidence: 0.4,
    certainty: 'low',
    reason: '规则兜底无法确认用户意图'
  }, 'rule_fallback');
}

function buildSupervisorPrompt(messages) {
  return `你是学习规划应用的 Supervisor Agent。你的职责是识别用户意图、决定是否需要调用白名单工具、以及选择后续路由。

可选意图：
- general_chat：普通聊天或解释
- initial_planning：用户想创建/生成/制定新的学习计划
- tool_assisted_answer：需要先调用工具再回答
- query_plan：用户想查看或查询已有学习计划
- adjust_plan：用户想小范围调整已有计划或任务
- replan：用户想重新规划或大幅重做计划
- clarification：需要向用户确认意图
- unknown：用户意图不清晰

可用工具：
${JSON.stringify(getAvailableTools(), null, 2)}

最近对话：
${compactMessages(messages)}

决策要求：
1. 如果用户要生成新的学习计划，选择 initial_planning。
2. initial_planning 只提取已明确给出的 goal、subjects、availability；缺失信息交给工作流收集。
3. 如果需要工具，只选择 calculator、weather、web_search。
4. 查询计划、调整计划、重规划要分别选择 query_plan、adjust_plan、replan，不要伪装成普通聊天。
5. 不要把详细排课算法放在 Supervisor 中。`;
}

async function decideIntentWithModel(messages, onEvent) {
  const startTime = Date.now();
  const prompt = buildSupervisorPrompt(messages);

  onEvent({
    type: 'processing',
    stage: 'intent_detection',
    details: '我正在理解你的学习需求，判断该直接回答、调用工具，还是进入学习计划相关流程。',
    progress: 10
  });

  let thinkingText = '';
  try {
    emitPublicThinking(
      onEvent,
      '我正在从你的消息里提取目标、上下文和操作意图，并判断是否需要工具或工作流辅助。\n'
    );

    const result = await streamChatWithThinking(prompt, {
      onThinking: (token) => {
        thinkingText += token;
      },
      onContent: (token) => {
        thinkingText += token;
      }
    });
    thinkingText = thinkingText || result.thinkingText || result.contentText || '';
  } finally {
    const duration = (Date.now() - startTime) / 1000;
    onEvent({ type: 'thinking_end', duration: Number(duration.toFixed(1)) });
  }

  onEvent({
    type: 'processing',
    stage: 'intent_classification',
    details: '我已经完成初步理解，正在形成结构化路由决策。',
    progress: 25
  });

  const structuredPrompt = `基于以下 Supervisor 分析和对话，输出路由决策。

Supervisor 分析：
${thinkingText}

最近对话：
${compactMessages(messages)}

只输出工具调用参数和规划初始数据，不要生成最终学习计划。`;

  const decision = await structuredOutput(structuredPrompt, SupervisorIntentDecisionSchema, {
    systemPrompt: '你是学习规划系统的 Supervisor Agent。必须调用结构化输出工具返回决策。',
    toolName: 'supervisor_intent_decision'
  });

  return buildDecision(decision, 'llm');
}

async function classifyIntent(messages, onEvent) {
  try {
    const modelDecision = await decideIntentWithModel(messages, onEvent);
    if (modelDecision.confidence >= CONFIDENCE_THRESHOLD) {
      return modelDecision;
    }

    onEvent({
      type: 'processing',
      stage: 'rule_fallback',
      details: '模型判断不够确定，我正在用规则兜底再次确认意图。',
      progress: 30
    });
    return inferFallbackDecision(messages);
  } catch (error) {
    logger.warn({ err: error.message }, 'Supervisor model decision failed, using fallback');
    onEvent({
      type: 'processing',
      stage: 'rule_fallback',
      details: '模型路由暂时不可用，我正在用规则兜底识别你的意图。',
      progress: 30
    });
    return inferFallbackDecision(messages);
  }
}

function normalizeDecision(decision, messages) {
  const lastUserMessage = getLastUserMessage(messages);
  const normalized = buildDecision(decision, decision.source || 'llm');

  return {
    ...normalized,
    planningSeed: normalized.intent === 'initial_planning'
      ? normalizePlanningSeed(normalized.planningSeed, lastUserMessage?.content || '')
      : undefined
  };
}

function emitIntentRouted(onEvent, decision) {
  onEvent({
    type: 'intent_routed',
    payload: {
      intent: decision.intent,
      confidence: decision.confidence,
      source: decision.source,
      certainty: decision.certainty,
      message: `已识别为${INTENT_LABELS[decision.intent] || '继续处理你的请求'}。`
    }
  });
}

async function executePlannedTools(toolCalls = [], onEvent) {
  const results = [];

  for (const [index, call] of toolCalls.entries()) {
    if (!call?.toolName || !isToolAllowed(call.toolName)) {
      continue;
    }

    const callId = `tool_${Date.now()}_${index}`;
    const toolLabel = TOOL_LABELS[call.toolName] || call.toolName;
    const baseEvent = {
      type: 'tool_call',
      id: callId,
      toolName: call.toolName,
      parameters: call.parameters || {},
      reason: call.reason || `我需要调用${toolLabel}来辅助处理你的请求。`
    };

    onEvent({ ...baseEvent, status: 'pending', message: `准备调用${toolLabel}。` });
    onEvent({ ...baseEvent, status: 'executing', message: `正在调用${toolLabel}。` });

    try {
      const result = await executeToolHandler(call.toolName, call.parameters);
      const completed = { ...baseEvent, status: 'completed', result, message: `${toolLabel}调用完成。` };
      onEvent(completed);
      results.push({
        toolName: call.toolName,
        parameters: call.parameters || {},
        result
      });
    } catch (error) {
      const failed = { ...baseEvent, status: 'failed', error: error.message, message: `${toolLabel}调用失败。` };
      onEvent(failed);
      results.push({
        toolName: call.toolName,
        parameters: call.parameters || {},
        error: error.message
      });
    }
  }

  return results;
}

export function buildToolResultMessage(toolResults = []) {
  if (toolResults.length === 0) {
    return '';
  }

  return `\n\n工具调用结果：\n${toolResults
    .map(result => `- ${result.toolName}: ${JSON.stringify(result.result ?? { error: result.error })}`)
    .join('\n')}`;
}

async function routeGeneralChat({ messages, agentConfig, onEvent, toolResults = [] }) {
  const toolResultMessage = buildToolResultMessage(toolResults);
  const responseMessages = toolResultMessage
    ? [
      ...messages,
      {
        role: 'user',
        content: `请基于以下工具结果回答用户刚才的问题，回答要简洁清晰。${toolResultMessage}`
      }
    ]
    : messages;

  await streamDeepSeekChat(responseMessages, agentConfig, onEvent);
}

async function routeInitialPlanning({ decision, agentConfig, studySpaceId, requestSpaceId, onEvent }) {
  const spaceId = studySpaceId || requestSpaceId || agentConfig?.studySpaceId || generateId('space_');
  const userId = agentConfig?.userId || 'default-user';
  const stream = runInitialPlanningStream(spaceId, userId, decision.planningSeed || {}, {
    configurable: { onEvent }
  });

  for await (const { state: nodeState } of stream) {
    if (nodeState.interruption?.isInterrupted) {
      continue;
    }

    if (nodeState.workflow?.stage === 'finalized') {
      const taskCount = nodeState.tasksSnapshot?.length || 0;
      const planVersion = nodeState.currentPlan?.versionNumber || 1;
      onEvent({
        type: 'content',
        content: `\n\n我已经为你生成了学习计划！\n\n计划概览：\n- 总任务数：${taskCount} 个\n- 计划版本：v${planVersion}\n\n你可以查看下方的详细计划，并根据需要进行调整。`
      });
      onEvent({
        type: 'analysis_result',
        summary: '学习计划生成完成',
        findings: [`已生成 ${taskCount} 个学习任务`, `计划版本：v${planVersion}`],
        recommendations: ['建议每天按时完成计划任务', '可以根据实际情况调整任务优先级']
      });
    }
  }
}

function routeUnsupportedIntent({ decision, onEvent }) {
  onEvent({
    type: 'content',
    content: UNSUPPORTED_INTENT_MESSAGES[decision.intent] || '我已经识别到你的请求，但这个能力当前版本还没有开放。'
  });
}

function routeClarification({ onEvent }) {
  onEvent({
    type: 'info_needed',
    question: '我还不确定你想让我做什么。你是想创建新学习计划、查询已有计划、调整计划，还是问一个普通问题？',
    field: 'intent',
    fieldName: 'intent',
    fieldLabel: '处理意图',
    fieldType: 'select',
    options: ['创建新学习计划', '查询已有计划', '调整计划', '普通问题'],
    required: true
  });
}

async function routeDecision(context) {
  const { decision, onEvent } = context;

  switch (decision.intent) {
    case 'initial_planning':
      await routeInitialPlanning(context);
      return;
    case 'tool_assisted_answer': {
      const toolResults = await executePlannedTools(decision.toolCalls || [], onEvent);
      await routeGeneralChat({ ...context, toolResults });
      return;
    }
    case 'general_chat':
      await routeGeneralChat(context);
      return;
    case 'query_plan':
    case 'adjust_plan':
    case 'replan':
      routeUnsupportedIntent(context);
      return;
    case 'clarification':
    case 'unknown':
    default:
      routeClarification(context);
  }
}

export async function runSupervisorAgent({
  messages,
  agentConfig,
  studySpaceId,
  requestSpaceId,
  onEvent = () => {}
}) {
  const classifiedDecision = await classifyIntent(messages, onEvent);
  const decision = normalizeDecision(classifiedDecision, messages);

  emitIntentRouted(onEvent, decision);

  await routeDecision({
    messages,
    agentConfig,
    studySpaceId,
    requestSpaceId,
    decision,
    onEvent
  });

  return { decision };
}

export default {
  runSupervisorAgent,
  buildToolResultMessage
};
