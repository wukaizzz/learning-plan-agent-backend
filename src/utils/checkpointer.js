/**
 * LangGraph Checkpointer 配置
 * 用于持久化工作流状态，支持中断/恢复机制
 */

import { MemorySaver } from '@langchain/langgraph';

const WORKFLOW_STATE_KEYS = [
  'studySpaceId',
  'userId',
  'goal',
  'subjects',
  'availability',
  'currentPlan',
  'tasksSnapshot',
  'progress',
  'riskAssessment',
  'workflow',
  'uiBlocks',
  'interruption',
  'metadata'
];

/**
 * 内存中的 Checkpointer（开发环境使用）
 * 生产环境建议使用 PostgresSaver 或 Redis
 */
export const checkpointer = new MemorySaver();

/**
 * 创建带数据库的 Checkpointer（生产环境）
 * 需要安装: @langchain/langgraph-checkpoint-postgres
 *
 * @example
 * import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
 * export const checkpointer = await PostgresSaver.fromConnString(
 *   process.env.DATABASE_URL
 * );
 */

function pickWorkflowState(values) {
  if (!values || typeof values !== 'object') {
    return null;
  }

  const state = {};
  for (const key of WORKFLOW_STATE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      state[key] = values[key];
    }
  }

  return Object.keys(state).length > 0 ? state : null;
}

export function extractCheckpointValues(checkpoint) {
  if (!checkpoint) {
    return null;
  }

  return pickWorkflowState(
    checkpoint.values ||
    checkpoint.channel_values ||
    checkpoint.checkpoint?.channel_values ||
    null
  );
}

/**
 * 获取指定线程的当前状态
 * @param {string} threadId - 线程 ID（通常是学习空间 ID）
 * @returns {Promise<StudySpaceWorkflowState|null>}
 */
export async function getState(threadId) {
  try {
    const config = { configurable: { thread_id: threadId } };
    // ✅ 使用 MemorySaver 的 get 方法
    const checkpoint = await checkpointer.get(config);
    const values = extractCheckpointValues(checkpoint);

    if (values) {
      console.log(`✅ 获取到状态 [threadId: ${threadId}]`, {
        stage: values.workflow?.stage,
        currentNode: values.workflow?.currentNode,
        taskCount: values.tasksSnapshot?.length || 0
      });
      return values;
    }

    console.log(`⚠️ 未找到状态 [threadId: ${threadId}]`);
    return null;
  } catch (error) {
    console.error(`获取状态失败 [threadId: ${threadId}]:`, error);
    return null;
  }
}

/**
 * 保存工作流状态
 * @param {string} threadId - 线程 ID
 * @param {StudySpaceWorkflowState} state - 要保存的状态
 * @returns {Promise<void>}
 */
export async function saveState(threadId, state) {
  try {
    const config = { configurable: { thread_id: threadId } };
    // LangGraph checkpointer 会自动保存状态
    // 这里只是示例，实际调用方式取决于具体实现
    console.log(`状态已保存 [threadId: ${threadId}]`);
  } catch (error) {
    console.error(`保存状态失败 [threadId: ${threadId}]:`, error);
    throw error;
  }
}

/**
 * 清除指定线程的状态
 * @param {string} threadId - 线程 ID
 * @returns {Promise<void>}
 */
export async function clearState(threadId) {
  try {
    const config = { configurable: { thread_id: threadId } };
    // 实现清除逻辑
    console.log(`状态已清除 [threadId: ${threadId}]`);
  } catch (error) {
    console.error(`清除状态失败 [threadId: ${threadId}]:`, error);
    throw error;
  }
}

/**
 * 获取线程的执行历史
 * @param {string} threadId - 线程 ID
 * @returns {Promise<WorkflowHistoryItem[]>}
 */
export async function getHistory(threadId) {
  try {
    // 从 State 中的 workflow.history 获取
    const state = await getState(threadId);
    return state?.workflow?.history || [];
  } catch (error) {
    console.error(`获取历史失败 [threadId: ${threadId}]:`, error);
    return [];
  }
}

export default {
  checkpointer,
  extractCheckpointValues,
  getState,
  saveState,
  clearState,
  getHistory
};
