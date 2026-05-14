import { streamDeepSeekChat } from '../services/deepseekService.js';
import { runInitialPlanning } from '../workflows/initialPlanningWorkflow.js';
import { generateId } from '../utils/idGenerator.js';

/**
 * 检测用户是否想要生成学习计划
 */
function detectPlanGenerationIntent(messages) {
  if (!messages || messages.length === 0) return false;

  const lastMessage = messages[messages.length - 1];
  if (!lastMessage || lastMessage.role !== 'user') return false;

  const content = lastMessage.content?.toLowerCase() || '';

  // 检测关键词
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

/**
 * 发送工作流状态事件
 */
function sendWorkflowEvent(res, type, data) {
  res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
}

export async function streamChat(req, res) {
  const { messages, agentConfig } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid messages format' });
  }

  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    // 检测是否要生成学习计划
    if (detectPlanGenerationIntent(messages)) {
      console.log('🎯 检测到学习计划生成意图，启动 LangGraph 工作流');

      const spaceId = generateId('space_');
      const userId = agentConfig?.userId || 'default-user';

      // 发送工作流开始事件
      sendWorkflowEvent(res, 'workflow_step', {
        step: 'collecting',
        progress: 10
      });

      // 发送处理状态
      sendWorkflowEvent(res, 'processing', {
        stage: '启动工作流',
        progress: 20
      });

      // 运行 LangGraph 工作流
      const result = await runInitialPlanning(spaceId, userId, {
        goal: {
          primaryGoal: '生成学习计划'
        }
      });

      console.log('工作流执行完成:', {
        stage: result.workflow.stage,
        interrupted: result.interruption?.isInterrupted,
        uiBlocksCount: result.uiBlocks?.length || 0
      });

      // 发送工作流阶段更新
      sendWorkflowEvent(res, 'workflow_step', {
        step: result.workflow.stage === 'finalized' ? 'reviewing' : 'collecting',
        progress: result.workflow.stage === 'finalized' ? 100 : 50
      });

      // 发送 UI Blocks 更新
      if (result.uiBlocks && result.uiBlocks.length > 0) {
        result.uiBlocks.forEach(block => {
          // 传递一个json对象，{type,action,block}
          sendWorkflowEvent(res, 'ui_block_update', {
            action: 'add',
            block
          });
        });
      }

      // 如果有中断，发送信息收集事件
      if (result.interruption?.isInterrupted) {
        sendWorkflowEvent(res, 'info_needed', {
          question: result.interruption.waitingFor?.question,
          field: result.interruption.waitingFor?.field,
          type: result.interruption.waitingFor?.ty,
          options: result.interruption.waitingFor?.options
        });

        // 发送文本响应
        sendWorkflowEvent(res, 'content', {
          content: `我需要了解更多信息来为你制定学习计划。${result.interruption.waitingFor?.question || ''}`
        });
      } else if (result.workflow.stage === 'finalized') {
        // 工作流完成，发送总结
        const taskCount = result.tasksSnapshot?.length || 0;
        const planVersion = result.currentPlan?.versionNumber || 1;

        sendWorkflowEvent(res, 'content', {
          content: `我已经为你生成了学习计划！\n\n📊 计划概览：\n- 总任务数：${taskCount} 个\n- 计划版本：v${planVersion}\n\n你可以查看下方的详细计划，并根据需要进行调整。`
        });

        sendWorkflowEvent(res, 'analysis_result', {
          summary: '学习计划生成完成',
          findings: [
            `已生成 ${taskCount} 个学习任务`,
            `计划版本：v${planVersion}`
          ],
          recommendations: [
            '建议每天按时完成计划任务',
            '可以根据实际情况调整任务优先级'
          ]
        });
      }

      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    // 普通聊天流程
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