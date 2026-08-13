import {
  DeepSeekClient,
  DeepSeekReviewError,
  parseDeepSeekSuggestions,
} from './deepseek-client.ts';

const assert: (condition: unknown, message?: string) => asserts condition = (condition, message = 'Assertion failed') => {
  if (!condition) throw new Error(message);
};

const assertEquals = (actual: unknown, expected: unknown) => {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`Expected ${right}, received ${left}`);
};

const validContent = JSON.stringify({ suggestions: [{
  code: 'unit_mismatch', severity: 'warning', title: '单位可能不一致', explanation: '当前单位与货品库单位不同，请人工复核。',
  field_path: 'arrival.items[0].unit', current_value: '箱', suggested_value: '盒', action_type: 'review', action_payload: {}, confidence: 0.91,
}] });

const successResponse = (content = validContent, finishReason: unknown = 'stop') => new Response(JSON.stringify({
  model: 'deepseek-v4-pro', system_fingerprint: 'fp-test',
  choices: [{ finish_reason: finishReason, message: { content } }],
  usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
}), { status: 200, headers: { 'Content-Type': 'application/json' } });

Deno.test('parses strict JSON suggestions and rejects extra root fields', () => {
  assertEquals(parseDeepSeekSuggestions(validContent)[0].severity, 'warning');
  let rejected = false;
  try {
    parseDeepSeekSuggestions(JSON.stringify({ suggestions: [], commentary: 'not allowed' }));
  } catch (error) {
    rejected = error instanceof DeepSeekReviewError && error.code === 'MODEL_INVALID_SCHEMA';
  }
  assert(rejected);
});

Deno.test('rejects invalid confidence, action type and field path instead of coercing them', () => {
  const base = JSON.parse(validContent) as { suggestions: Array<Record<string, unknown>> };
  let overlyNested: unknown = 'value';
  for (let depth = 0; depth < 10; depth += 1) overlyNested = { value: overlyNested };
  for (const patch of [
    { confidence: 1.2 },
    { action_type: '' },
    { field_path: '../../secret' },
    { current_value: overlyNested },
    { suggested_value: Array.from({ length: 21 }, () => null) },
  ]) {
    const payload = { suggestions: [{ ...base.suggestions[0], ...patch }] };
    let rejected = false;
    try {
      parseDeepSeekSuggestions(JSON.stringify(payload));
    } catch (error) {
      rejected = error instanceof DeepSeekReviewError && error.code === 'MODEL_INVALID_SUGGESTION';
    }
    assert(rejected);
  }
});

Deno.test('extracts a BOM-prefixed balanced JSON object from prose and multiple fences', () => {
  const parsed = JSON.parse(validContent) as { suggestions: Array<Record<string, unknown>> };
  const explanation = '字符串内的括号 } {、引号 " 和反斜杠 \\ 不应影响边界。';
  parsed.suggestions[0].explanation = explanation;
  const surrounded = `\uFEFF检查结果如下：\n\`\`\`text\n暂无额外说明\n\`\`\`\n\`\`\`json\n${JSON.stringify(parsed)}\n\`\`\`\n后缀说明\n\`\`\``;
  const suggestions = parseDeepSeekSuggestions(surrounded);
  assertEquals(suggestions.length, 1);
  assertEquals(suggestions[0].explanation, explanation);
});

Deno.test('does not skip a malicious first object to accept a later valid object', () => {
  const maliciousFirst = `prefix {"suggestions":[],"__proto__":{"polluted":true}} suffix ${validContent}`;
  let rejected = false;
  try {
    parseDeepSeekSuggestions(maliciousFirst);
  } catch (error) {
    rejected = error instanceof DeepSeekReviewError && error.code === 'MODEL_INVALID_SCHEMA';
  }
  assert(rejected);
  assert(({} as Record<string, unknown>).polluted === undefined);
});

Deno.test('rejects an incomplete first JSON object instead of scanning into a later payload', () => {
  let rejected = false;
  try {
    parseDeepSeekSuggestions(`prefix {"unfinished": ${validContent}`);
  } catch (error) {
    rejected = error instanceof DeepSeekReviewError && error.code === 'MODEL_TRUNCATED_JSON';
  }
  assert(rejected);
});

Deno.test('uses the official endpoint, fixed deepseek-v4-pro model and disables thinking', async () => {
  let url = '';
  let body: Record<string, unknown> = {};
  const client = new DeepSeekClient({
    apiKey: 'test-secret-not-real',
    fetchImpl: async (input, init) => {
      url = String(input);
      body = JSON.parse(String(init?.body));
      return successResponse();
    },
    sleep: async () => {},
  });
  const result = await client.review('system', '{"workflow":"product"}');
  assertEquals(url, 'https://api.deepseek.com/chat/completions');
  assertEquals(body.model, 'deepseek-v4-pro');
  assertEquals(body.thinking, { type: 'disabled' });
  assertEquals(body.response_format, { type: 'json_object' });
  assertEquals(body.temperature, 0);
  assertEquals(body.max_tokens, 2_500);
  assertEquals(result.suggestions.length, 1);
});

Deno.test('reports completion finish reasons explicitly and expands only the bounded retry budget', async () => {
  const tokenLimits: unknown[] = [];
  let calls = 0;
  const lengthClient = new DeepSeekClient({
    apiKey: 'test-secret-not-real',
    fetchImpl: async (_input, init) => {
      calls += 1;
      tokenLimits.push((JSON.parse(String(init?.body)) as Record<string, unknown>).max_tokens);
      return successResponse(validContent.slice(0, -1), 'length');
    },
    sleep: async () => {},
  });
  let lengthCode = '';
  try {
    await lengthClient.review('system', '{}');
  } catch (error) {
    lengthCode = error instanceof DeepSeekReviewError ? error.code : '';
  }
  assertEquals(calls, 3);
  assertEquals(tokenLimits, [2_500, 4_000, 6_000]);
  assertEquals(lengthCode, 'MODEL_OUTPUT_TRUNCATED');

  for (const [finishReason, expectedCode] of [
    ['content_filter', 'MODEL_CONTENT_FILTERED'],
    ['tool_calls', 'MODEL_UNEXPECTED_TOOL_CALL'],
  ]) {
    let finishCalls = 0;
    const client = new DeepSeekClient({
      apiKey: 'test-secret-not-real',
      fetchImpl: async () => {
        finishCalls += 1;
        return successResponse(validContent, finishReason);
      },
      sleep: async () => {},
    });
    let code = '';
    try {
      await client.review('system', '{}');
    } catch (error) {
      code = error instanceof DeepSeekReviewError ? error.code : '';
    }
    assertEquals(finishCalls, 1);
    assertEquals(code, expectedCode);
  }

  let resourceCalls = 0;
  const resourceClient = new DeepSeekClient({
    apiKey: 'test-secret-not-real',
    fetchImpl: async () => resourceCalls++ === 0
      ? successResponse('', 'insufficient_system_resource')
      : successResponse(),
    sleep: async () => {},
  });
  const recovered = await resourceClient.review('system', '{}');
  assertEquals(resourceCalls, 2);
  assertEquals(recovered.attempts, 2);
});

Deno.test('retries rate limits, empty content and invalid JSON only a bounded number of times', async () => {
  const responses = [
    new Response('{}', { status: 429 }),
    successResponse(''),
    successResponse(validContent),
  ];
  let calls = 0;
  const client = new DeepSeekClient({
    apiKey: 'test-secret-not-real',
    fetchImpl: async () => responses[calls++] ?? successResponse(),
    sleep: async () => {},
  });
  const result = await client.review('system', '{}');
  assertEquals(calls, 3);
  assertEquals(result.attempts, 3);
});

Deno.test('retries invalid JSON and then accepts a valid structured response', async () => {
  let calls = 0;
  const client = new DeepSeekClient({
    apiKey: 'test-secret-not-real',
    fetchImpl: async () => calls++ === 0 ? successResponse('{invalid') : successResponse(),
    sleep: async () => {},
  });
  const result = await client.review('system', '{}');
  assertEquals(calls, 2);
  assertEquals(result.attempts, 2);
});

Deno.test('does not retry authentication failures or expose the API key in errors', async () => {
  let calls = 0;
  const client = new DeepSeekClient({
    apiKey: 'super-secret-api-key',
    fetchImpl: async () => {
      calls += 1;
      return new Response('credential rejected: super-secret-api-key', { status: 401 });
    },
    sleep: async () => {},
  });
  let message = '';
  try {
    await client.review('system', '{}');
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertEquals(calls, 1);
  assert(!message.includes('super-secret-api-key'));
});

Deno.test('rejects a non-official API base URL', () => {
  let rejected = false;
  try {
    new DeepSeekClient({ apiKey: 'test', baseUrl: 'https://example.com/v1' });
  } catch (error) {
    rejected = error instanceof DeepSeekReviewError && error.code === 'MODEL_CONFIG_INVALID';
  }
  assert(rejected);
});
