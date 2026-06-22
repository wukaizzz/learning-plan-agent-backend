import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';

process.env.DEEPSEEK_API_KEY ||= 'test-api-key';

const {
  ReasonerTimeoutError,
  StructuredOutputError,
  buildStructuredToolBindingOptions,
  consumeReasonerStream,
  getChatModel,
  parseStructuredToolCall,
} = await import('./llmService.js');

const schema = z.object({
  value: z.string(),
  score: z.number().min(1).max(10),
});

function assertStructuredError(callback, expectedCode) {
  assert.throws(callback, error => {
    assert.ok(error instanceof StructuredOutputError);
    assert.equal(error.code, expectedCode);
    return true;
  });
}

test('parses one matching structured tool call', () => {
  const result = parseStructuredToolCall({
    tool_calls: [{
      id: 'call-1',
      name: 'test_output',
      args: { value: 'ok', score: 8 },
      type: 'tool_call',
    }],
  }, schema, 'test_output');

  assert.deepEqual(result, { value: 'ok', score: 8 });
});

test('rejects a response without tool calls', () => {
  assertStructuredError(
    () => parseStructuredToolCall({}, schema, 'test_output'),
    'missing_tool_call'
  );
});

test('rejects multiple valid or invalid tool calls', () => {
  assertStructuredError(
    () => parseStructuredToolCall({
      tool_calls: [{ name: 'test_output', args: { value: 'ok', score: 8 } }],
      invalid_tool_calls: [{ name: 'test_output', args: '{' }],
    }, schema, 'test_output'),
    'multiple_tool_calls'
  );
});

test('rejects an unexpected tool name', () => {
  assert.throws(
    () => parseStructuredToolCall({
      tool_calls: [{
        name: 'other_output',
        args: { value: 'ok', score: 8 },
      }],
    }, schema, 'test_output'),
    error => {
      assert.ok(error instanceof StructuredOutputError);
      assert.equal(error.code, 'unexpected_tool_call');
      assert.equal(error.actualName, 'other_output');
      return true;
    }
  );
});

test('classifies LangChain invalid tool calls as invalid arguments', () => {
  assert.throws(
    () => parseStructuredToolCall({
      invalid_tool_calls: [{
        name: 'test_output',
        args: '{"value":',
        error: 'Unexpected end of JSON input',
      }],
    }, schema, 'test_output'),
    error => {
      assert.ok(error instanceof StructuredOutputError);
      assert.equal(error.code, 'invalid_tool_arguments');
      assert.deepEqual(error.issues, [{
        path: [],
        code: 'invalid_tool_call',
        message: 'Unexpected end of JSON input',
      }]);
      return true;
    }
  );
});

test('returns compact Zod issues for invalid tool arguments', () => {
  assert.throws(
    () => parseStructuredToolCall({
      tool_calls: [{
        name: 'test_output',
        args: { value: 'ok', score: 11 },
      }],
    }, schema, 'test_output'),
    error => {
      assert.ok(error instanceof StructuredOutputError);
      assert.equal(error.code, 'invalid_tool_arguments');
      assert.deepEqual(error.issues[0].path, ['score']);
      assert.equal(typeof error.issues[0].code, 'string');
      assert.equal(typeof error.issues[0].message, 'string');
      return true;
    }
  );
});

test('reuses chat models only when normalized configuration matches', () => {
  const first = getChatModel({ modelName: 'deepseek-chat', temperature: 0.17, maxTokens: 1234 });
  const same = getChatModel({ modelName: 'deepseek-chat', temperature: 0.17, maxTokens: 1234 });
  const differentTemperature = getChatModel({ modelName: 'deepseek-chat', temperature: 0.18, maxTokens: 1234 });
  const differentMaxTokens = getChatModel({ modelName: 'deepseek-chat', temperature: 0.17, maxTokens: 1235 });

  assert.strictEqual(first, same);
  assert.notStrictEqual(first, differentTemperature);
  assert.notStrictEqual(first, differentMaxTokens);
});

test('builds a named tool choice for structured output', () => {
  assert.deepEqual(
    buildStructuredToolBindingOptions('risk_assessment'),
    {
      tool_choice: {
        type: 'function',
        function: { name: 'risk_assessment' },
      },
    }
  );
});

test('consumes complete reasoner output before the deadline', async () => {
  const thinkingTokens = [];
  const contentTokens = [];
  const result = await consumeReasonerStream(
    async function* () {
      yield {
        additional_kwargs: { reasoning_content: '分析中' },
        content: '',
      };
      yield {
        additional_kwargs: {},
        content: '分析完成',
      };
    },
    {
      timeoutMillis: 100,
      onThinking: token => thinkingTokens.push(token),
      onContent: token => contentTokens.push(token),
    }
  );

  assert.deepEqual(result, {
    thinkingText: '分析中',
    contentText: '分析完成',
  });
  assert.deepEqual(thinkingTokens, ['分析中']);
  assert.deepEqual(contentTokens, ['分析完成']);
});

test('aborts a stalled reasoner stream at the configured deadline', async () => {
  let receivedSignal;
  let resolveStream;
  const stalledStream = new Promise(resolve => {
    resolveStream = resolve;
  });

  await assert.rejects(
    consumeReasonerStream(
      signal => {
        receivedSignal = signal;
        return stalledStream;
      },
      { timeoutMillis: 10 }
    ),
    error => {
      assert.ok(error instanceof ReasonerTimeoutError);
      assert.equal(error.code, 'REASONER_TIMEOUT');
      assert.equal(error.timeoutMillis, 10);
      return true;
    }
  );

  assert.equal(receivedSignal.aborted, true);
  resolveStream((async function* () {})());
});

test('normalizes provider timeout errors as reasoner timeouts', async () => {
  const providerError = Object.assign(new Error('Request timed out'), {
    name: 'APIConnectionTimeoutError',
  });

  await assert.rejects(
    consumeReasonerStream(
      async () => {
        throw providerError;
      },
      { timeoutMillis: 100 }
    ),
    error => {
      assert.ok(error instanceof ReasonerTimeoutError);
      assert.equal(error.code, 'REASONER_TIMEOUT');
      assert.strictEqual(error.cause, providerError);
      return true;
    }
  );
});
