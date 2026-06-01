import { StateGraph, START, END } from '@langchain/langgraph';
import { AgentStateAnnotation } from './state.js';
import { agentNode } from './nodes/agentNode.js';
import { toolNode } from './nodes/toolNode.js';
import { finalizeNode } from './nodes/finalizeNode.js';

export const MAX_ITERATIONS = 6;

function getLastToolCalls(messages = []) {
  const lastMessage = messages[messages.length - 1];
  return Array.isArray(lastMessage?.tool_calls) ? lastMessage.tool_calls : [];
}

function shouldContinue(state) {
  if (state.status === 'failed') {
    return 'finalize';
  }

  if ((state.iterationCount || 0) >= MAX_ITERATIONS) {
    return 'finalize';
  }

  return getLastToolCalls(state.messages).length > 0 ? 'execute_tools' : 'finalize';
}

export function createLearningPlanAgentGraph() {
  const graph = new StateGraph(AgentStateAnnotation)
    .addNode('agent_decide', agentNode)
    .addNode('execute_tools', toolNode)
    .addNode('finalize', finalizeNode)
    .addEdge(START, 'agent_decide')
    .addConditionalEdges('agent_decide', shouldContinue, {
      execute_tools: 'execute_tools',
      finalize: 'finalize'
    })
    .addEdge('execute_tools', 'agent_decide')
    .addEdge('finalize', END);

  return graph.compile();
}

