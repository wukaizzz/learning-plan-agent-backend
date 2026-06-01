import { Annotation, messagesStateReducer } from '@langchain/langgraph';

export const AgentStateAnnotation = Annotation.Root({
  studySpaceId: Annotation(),
  userId: Annotation(),
  intent: Annotation(),
  userMessage: Annotation(),
  planData: Annotation(),
  messages: Annotation({
    reducer: messagesStateReducer,
    default: () => []
  }),
  iterationCount: Annotation({
    reducer: (_current, update) => update ?? 0,
    default: () => 0
  }),
  status: Annotation({
    reducer: (_current, update) => update ?? 'running',
    default: () => 'running'
  }),
  responseText: Annotation({
    reducer: (_current, update) => update ?? '',
    default: () => ''
  }),
  startTime: Annotation(),
  executionId: Annotation()
});

