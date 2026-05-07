/**
 * LangGraph 工作流 API 路由
 * 处理学习空间工作流的启动、恢复、状态查询等操作
 */

import express from 'express';
import { createInitialState } from '../types/workflowState.js';
import { checkpointer } from '../utils/checkpointer.js';
import { runInitialPlanning } from '../workflows/initialPlanningWorkflow.js';

const router = express.Router();

/**
 * 启动首次计划生成工作流
 * POST /api/workflows/spaces/:spaceId/start-planning
 */
router.post('/spaces/:spaceId/start-planning', async (req, res) => {
  try {
    const { spaceId } = req.params;
    const { userId, goal, subjects, availability } = req.body;

    console.log(`🚀 启动首次计划生成工作流 [spaceId: ${spaceId}]`);

    // 准备初始状态（允许从前端传入一些初始数据）
    const initialState = {};
    if (goal) initialState.goal = goal;
    if (subjects) initialState.subjects = subjects;
    if (availability) initialState.availability = availability;

    // 执行工作流
    const result = await runInitialPlanning(
      spaceId,
      userId || 'default-user',
      initialState
    );

    // 根据工作流状态返回不同响应
    if (result.interruption?.isInterrupted) {
      // 工作流被中断，等待用户输入
      return res.json({
        success: true,
        interrupted: true,
        state: result,
        message: '需要补充信息以继续',
        interruption: result.interruption
      });
    }

    // 工作流正常完成
    res.json({
      success: true,
      interrupted: false,
      state: result,
      message: '学习计划生成完成',
      summary: {
        totalTasks: result.tasksSnapshot.length,
        planVersion: result.currentPlan.versionNumber,
        riskLevel: result.riskAssessment.level
      }
    });

  } catch (error) {
    console.error('启动工作流失败:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * 恢复中断的工作流
 * POST /api/workflows/:threadId/resume
 */
router.post('/workflows/:threadId/resume', async (req, res) => {
  try {
    const { threadId } = req.params;
    const userInput = req.body;

    console.log(`▶️ 恢复工作流 [threadId: ${threadId}]`, userInput);

    // 创建新状态，包含用户输入的数据
    const updatedState = {
      ...createInitialState(threadId, userInput.userId || 'default-user'),
      ...userInput,
      studySpaceId: threadId,
      interruption: null // 清除中断状态
    };

    // 重新执行工作流（带上用户输入的数据）
    const result = await runInitialPlanning(
      threadId,
      userInput.userId || 'default-user',
      updatedState
    );

    // 检查是否还有其他缺失信息
    if (result.interruption?.isInterrupted) {
      return res.json({
        success: true,
        interrupted: true,
        state: result,
        message: '还需要补充更多信息',
        interruption: result.interruption
      });
    }

    // 工作流完成
    res.json({
      success: true,
      interrupted: false,
      state: result,
      message: '学习计划生成完成'
    });

  } catch (error) {
    console.error('恢复工作流失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 触发重规划工作流
 * POST /api/workflows/spaces/:spaceId/replan
 */
router.post('/spaces/:spaceId/replan', async (req, res) => {
  try {
    const { spaceId } = req.params;
    const { reason = 'user_initiated' } = req.body;

    console.log(`🔄 触发重规划 [spaceId: ${spaceId}]`, { reason });

    // TODO: 实现重规划工作流
    // const workflow = createReplanningWorkflow();
    // const currentState = await checkpointer.get(spaceId);
    // const result = await workflow.invoke(currentState.values, {
    //   configurable: { thread_id: spaceId }
    // });

    res.json({
      success: true,
      message: '重规划功能（Phase 3 实现中）',
      spaceId,
      reason
    });

  } catch (error) {
    console.error('重规划失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 获取当前工作流状态
 * GET /api/workflows/:threadId/state
 */
router.get('/workflows/:threadId/state', async (req, res) => {
  try {
    const { threadId } = req.params;
    
    console.log(`📊 获取工作流状态 [threadId: ${threadId}]`);
    console.log(req);

    // TODO: 从 checkpointer 获取状态
    // const state = await checkpointer.get({ configurable: { thread_id: threadId } });

    res.json({
      success: true,
      message: '状态查询功能（Phase 1 实现中）',
      threadId
    });

  } catch (error) {
    console.error('获取状态失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 提交用户反馈
 * POST /api/workflows/:threadId/feedback
 */
router.post('/workflows/:threadId/feedback', async (req, res) => {
  try {
    const { threadId } = req.params;
    const { feedback } = req.body;

    console.log(`💬 用户反馈 [threadId: ${threadId}]`, feedback);

    // TODO: 实现人机协同工作流
    // const workflow = createHumanFeedbackWorkflow();
    // const currentState = await checkpointer.get(threadId);
    // const result = await workflow.invoke(
    //   { ...currentState.values, feedback },
    //   { configurable: { thread_id: threadId } }
    // );

    res.json({
      success: true,
      message: '人机协同功能（Phase 4 实现中）',
      feedback
    });

  } catch (error) {
    console.error('处理反馈失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 获取工作流执行历史
 * GET /api/workflows/:threadId/history
 */
router.get('/workflows/:threadId/history', async (req, res) => {
  try {
    const { threadId } = req.params;

    // TODO: 从 checkpointer 获取历史
    // const history = await getHistory(threadId);

    res.json({
      success: true,
      history: [],
      message: '历史查询功能（Phase 1 实现中）'
    });

  } catch (error) {
    console.error('获取历史失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
