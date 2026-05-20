import { streamDeepSeekChat } from '../services/deepseekService.js';
import { runInitialPlanningStream, runInitialPlanning } from '../workflows/initialPlanningWorkflow.js';
import { generateId } from '../utils/idGenerator.js';

function detectPlanGenerationIntent(messages) {
  if (!messages || messages.length === 0) return false;

  const lastMessage = messages[messages.length - 1];
  if (!lastMessage || lastMessage.role !== 'user') return false;

  const content = lastMessage.content?.toLowerCase() || '';

  const planKeywords = [
    '生成学习计划',
    '帮我制定计划',
    '帮我规划',
    '创建学习计划',
    '制定学习计划',
    '帮我生成计划',
    '学习计划'
  ];

  return planKeywords.some(keyword => content.includes(keyword));
}

function sendWorkflowEvent(res, type, data) {
  res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
}

export async function streamChat(req, res) {
  const { messages, agentConfig } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid messages format' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    if (detectPlanGenerationIntent(messages)) {
      console.log('🎯 检测到学习计划生成意图，启动 LangGraph 流式工作流');

      const spaceId = generateId('space_');
      const userId = agentConfig?.userId || 'default-user';

      const onEvent = (event) => {
        try {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        } catch (e) {
          console.warn('SSE write failed (client disconnected?):', e.message);
        }
      };

      try {
        const stream = runInitialPlanningStream(spaceId, userId, {
          goal: { primaryGoal: '生成学习计划' }
        }, {
          configurable: { onEvent }
        });

        for await (const { nodeName, state: nodeState } of stream) {
          if (nodeState.interruption?.isInterrupted) {
            sendWorkflowEvent(res, 'info_needed', {
              question: nodeState.interruption.waitingFor?.question,
              field: nodeState.interruption.waitingFor?.field,
              fieldType: nodeState.interruption.waitingFor?.type,
              options: nodeState.interruption.waitingFor?.options
            });
            sendWorkflowEvent(res, 'content', {
              content: `我需要了解更多信息来为你制定学习计划。${nodeState.interruption.waitingFor?.question || ''}`
            });
          } else if (nodeState.workflow?.stage === 'finalized') {
            const taskCount = nodeState.tasksSnapshot?.length || 0;
            const planVersion = nodeState.currentPlan?.versionNumber || 1;
            sendWorkflowEvent(res, 'content', {
              content: `\n\n我已经为你生成了学习计划！\n\n📊 计划概览：\n- 总任务数：${taskCount} 个\n- 计划版本：v${planVersion}\n\n你可以查看下方的详细计划，并根据需要进行调整。`
            });
            sendWorkflowEvent(res, 'analysis_result', {
              summary: '学习计划生成完成',
              findings: [`已生成 ${taskCount} 个学习任务`, `计划版本：v${planVersion}`],
              recommendations: ['建议每天按时完成计划任务', '可以根据实际情况调整任务优先级']
            });
          }
        }
      } catch (workflowError) {
        console.error('Workflow stream error:', workflowError);
        sendWorkflowEvent(res, 'error', { error: workflowError.message });
      }

      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    await streamDeepSeekChat(messages, agentConfig, (chunk) => {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    });

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('Chat error:', error);
    res.write(`data: ${JSON.stringify({
      type: 'error',
      error: error.message
    })}\n\n`);
    res.end();
  }
}
