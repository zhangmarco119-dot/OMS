import type { AiSuggestion, JsonValue, ModelReviewResult, ModelUsage } from './types.ts';

export const DEEPSEEK_MODEL = 'deepseek-v4-pro';
export const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

const DEFAULT_TIMEOUT_MS = 25_000;
const MAX_ATTEMPTS = 3;
const MAX_RESPONSE_CHARS = 200_000;
const MAX_SUGGESTION_VALUE_DEPTH = 8;
const MAX_SUGGESTION_ARRAY_LENGTH = 20;
const MAX_SUGGESTION_OBJECT_KEYS = 10;
const RETRY_DELAYS_MS = [250, 750];
const OUTPUT_TOKEN_LIMITS = [2_500, 4_000, 6_000];

type Fetch = typeof fetch;

export interface DeepSeekClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: Fetch;
  model?: string;
  provider?: 'deepseek' | 'openai';
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
}

export class DeepSeekReviewError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'DeepSeekReviewError';
  }
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const asJsonValue = (value: unknown, depth = 0): JsonValue => {
  if (depth > MAX_SUGGESTION_VALUE_DEPTH) {
    throw new DeepSeekReviewError('MODEL_INVALID_SUGGESTION', 'The AI review response contained an overly nested value.', true);
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (value.length > MAX_SUGGESTION_ARRAY_LENGTH) {
      throw new DeepSeekReviewError('MODEL_INVALID_SUGGESTION', 'The AI review response contained an oversized value.', true);
    }
    return value.map((entry) => asJsonValue(entry, depth + 1));
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > MAX_SUGGESTION_OBJECT_KEYS) {
      throw new DeepSeekReviewError('MODEL_INVALID_SUGGESTION', 'The AI review response contained an oversized value.', true);
    }
    return Object.fromEntries(entries.map(([key, entry]) => [key, asJsonValue(entry, depth + 1)]));
  }
  return null;
};

const cleanText = (value: unknown, maximum: number) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, maximum) : '';

const cleanFieldPath = (value: unknown) => {
  const path = cleanText(value, 160);
  return /^[a-zA-Z0-9_\-.[\]]*$/.test(path) ? path : null;
};

const cleanActionType = (value: unknown) => {
  const action = cleanText(value, 64).toLowerCase();
  return /^[a-z][a-z0-9_]*$/.test(action) ? action : null;
};

const requiredSuggestionKeys = new Set([
  'action_payload', 'action_type', 'code', 'confidence', 'current_value',
  'explanation', 'field_path', 'severity', 'suggested_value', 'title',
]);

const suggestionFromUnknown = (value: unknown): AiSuggestion | null => {
  const source = asRecord(value);
  const keys = Object.keys(source);
  if (keys.length !== requiredSuggestionKeys.size || keys.some((key) => !requiredSuggestionKeys.has(key))) return null;
  if (!source.action_payload || typeof source.action_payload !== 'object' || Array.isArray(source.action_payload)) return null;
  const code = cleanText(source.code, 64).toLowerCase();
  const title = cleanText(source.title, 120);
  const explanation = cleanText(source.explanation, 600);
  const confidence = Number(source.confidence);
  const actionType = cleanActionType(source.action_type);
  const fieldPath = cleanFieldPath(source.field_path);
  const severity = source.severity === 'critical' || source.severity === 'warning' || source.severity === 'info'
    ? source.severity
    : null;
  if (!/^[a-z][a-z0-9_]*$/.test(code) || !title || !explanation || !severity || !actionType
    || fieldPath === null || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return null;
  }
  return {
    action_payload: asRecord(asJsonValue(source.action_payload)) as Record<string, JsonValue>,
    action_type: actionType,
    code,
    confidence,
    current_value: asJsonValue(source.current_value),
    explanation,
    field_path: fieldPath,
    severity,
    suggested_value: asJsonValue(source.suggested_value),
    title,
  };
};

// JSON Output should normally return a bare object, but provider responses can
// still contain a BOM, prose or more than one Markdown fence. Locate only the
// first structurally complete object. Braces inside JSON strings do not affect
// balancing, including after an escaped backslash or quote.
const firstBalancedJsonObject = (value: string) => {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (start < 0) {
      if (character === '{') {
        start = index;
        depth = 1;
      }
      continue;
    }
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) return value.slice(start, index + 1);
    }
  }

  if (start >= 0) {
    throw new DeepSeekReviewError('MODEL_TRUNCATED_JSON', 'The AI service returned an incomplete JSON object.', true);
  }
  throw new DeepSeekReviewError('MODEL_INVALID_JSON', 'The AI service returned no JSON object.', true);
};

export const parseDeepSeekSuggestions = (content: unknown): AiSuggestion[] => {
  if (typeof content !== 'string' || !content.trim()) {
    throw new DeepSeekReviewError('MODEL_EMPTY_CONTENT', 'The AI service returned no review content.', true);
  }
  if (content.length > MAX_RESPONSE_CHARS) {
    throw new DeepSeekReviewError('MODEL_RESPONSE_TOO_LARGE', 'The AI review response exceeded the safe size limit.', true);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(firstBalancedJsonObject(content.replace(/^\uFEFF+/, '')));
  } catch (error) {
    if (error instanceof DeepSeekReviewError) throw error;
    throw new DeepSeekReviewError('MODEL_INVALID_JSON', 'The AI service returned invalid structured content.', true);
  }
  const root = asRecord(parsed);
  if (!Array.isArray(root.suggestions) || Object.keys(root).some((key) => key !== 'suggestions')) {
    throw new DeepSeekReviewError('MODEL_INVALID_SCHEMA', 'The AI review response did not match the required schema.', true);
  }
  if (root.suggestions.length > 50) {
    throw new DeepSeekReviewError('MODEL_TOO_MANY_SUGGESTIONS', 'The AI service returned too many suggestions.', true);
  }
  const suggestions = root.suggestions.map(suggestionFromUnknown);
  if (suggestions.some((entry) => entry === null)) {
    throw new DeepSeekReviewError('MODEL_INVALID_SUGGESTION', 'The AI review response contained an invalid suggestion.', true);
  }
  return suggestions as AiSuggestion[];
};

const numberField = (record: Record<string, unknown>, key: string) => {
  const value = Number(record[key]);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
};

const normalizeUsage = (value: unknown): ModelUsage => {
  const usage = asRecord(value);
  const details = asRecord(usage.prompt_tokens_details);
  return {
    completion_tokens: numberField(usage, 'completion_tokens'),
    prompt_cache_hit_tokens: numberField(details, 'cached_tokens') ?? numberField(usage, 'prompt_cache_hit_tokens'),
    prompt_cache_miss_tokens: numberField(usage, 'prompt_cache_miss_tokens'),
    prompt_tokens: numberField(usage, 'prompt_tokens'),
    total_tokens: numberField(usage, 'total_tokens'),
  };
};

const retryAfterMilliseconds = (response: Response) => {
  const raw = response.headers.get('retry-after');
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(2_000, seconds * 1_000));
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, Math.min(2_000, date - Date.now())) : undefined;
};

const publicHttpError = (status: number) => {
  if (status === 429) return new DeepSeekReviewError('MODEL_RATE_LIMITED', 'The AI service is temporarily rate limited.', true);
  if (status >= 500) return new DeepSeekReviewError('MODEL_UNAVAILABLE', 'The AI service is temporarily unavailable.', true);
  if (status === 401 || status === 403) return new DeepSeekReviewError('MODEL_AUTH_FAILED', 'The AI service credentials were rejected.', false);
  return new DeepSeekReviewError('MODEL_REQUEST_REJECTED', `The AI service rejected the request with HTTP ${status}.`, false);
};

const finishReasonError = (value: unknown) => {
  if (value === 'stop') return null;
  if (value === 'length') {
    return new DeepSeekReviewError('MODEL_OUTPUT_TRUNCATED', 'The AI review output reached its token limit.', true);
  }
  if (value === 'insufficient_system_resource') {
    return new DeepSeekReviewError('MODEL_INSUFFICIENT_RESOURCES', 'The AI service stopped because inference resources were unavailable.', true);
  }
  if (value === 'content_filter') {
    return new DeepSeekReviewError('MODEL_CONTENT_FILTERED', 'The AI service withheld the review output.', false);
  }
  if (value === 'tool_calls') {
    return new DeepSeekReviewError('MODEL_UNEXPECTED_TOOL_CALL', 'The AI service returned an unexpected tool call.', false);
  }
  return new DeepSeekReviewError('MODEL_INVALID_RESPONSE', 'The AI service returned an invalid completion status.', true);
};

const safeBaseUrl = (value: string | undefined, provider: 'deepseek' | 'openai') => {
  const source = (value || DEFAULT_DEEPSEEK_BASE_URL).trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(source);
  } catch {
    throw new DeepSeekReviewError('MODEL_CONFIG_INVALID', 'The AI service endpoint is invalid.', false);
  }
  if (parsed.protocol !== 'https:') {
    throw new DeepSeekReviewError('MODEL_CONFIG_INVALID', 'The AI service endpoint must use HTTPS.', false);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new DeepSeekReviewError('MODEL_CONFIG_INVALID', 'The AI service endpoint must not include credentials or query parameters.', false);
  }
  const hostname = parsed.hostname;
  const pathname = parsed.pathname;
  if (provider === 'deepseek') {
    if (hostname !== 'api.deepseek.com' || (pathname !== '/' && pathname !== '/v1')) {
      throw new DeepSeekReviewError('MODEL_CONFIG_INVALID', 'The DeepSeek API endpoint is invalid.', false);
    }
  } else if (provider === 'openai') {
    if (hostname !== 'api.openai.com' || (pathname !== '/' && pathname !== '/v1')) {
      throw new DeepSeekReviewError('MODEL_CONFIG_INVALID', 'The OpenAI API endpoint is invalid.', false);
    }
  } else {
    throw new DeepSeekReviewError('MODEL_CONFIG_INVALID', 'The AI provider is unsupported.', false);
  }
  return source;
};

const defaultSleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export class DeepSeekClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: Fetch;
  private readonly model: string;
  private readonly provider: 'deepseek' | 'openai';
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly supportsThinking: boolean;
  private readonly timeoutMs: number;

  constructor(options: DeepSeekClientOptions) {
    this.apiKey = options.apiKey.trim();
    if (!this.apiKey) throw new DeepSeekReviewError('MODEL_NOT_CONFIGURED', 'The AI service is not configured.', false);
    this.provider = options.provider ?? 'deepseek';
    this.model = options.model?.trim() || DEEPSEEK_MODEL;
    this.baseUrl = safeBaseUrl(options.baseUrl, this.provider);
    this.supportsThinking = this.provider !== 'openai';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.timeoutMs = Math.max(5_000, Math.min(60_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  }

  async review(systemPrompt: string, structuredContext: string): Promise<ModelReviewResult> {
    let lastError: DeepSeekReviewError | null = null;
    let outputTokenLimitIndex = 0;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.model,
            // Disable reasoning mode where supported to keep structured review latency bounded.
            ...(this.supportsThinking ? { thinking: { type: 'disabled' } } : {}),
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: structuredContext },
            ],
            response_format: { type: 'json_object' },
            // Deterministic sampling reduces formatting drift. A truncated
            // response is retried with a larger, still bounded output budget.
            temperature: 0,
            max_tokens: OUTPUT_TOKEN_LIMITS[outputTokenLimitIndex],
            stream: false,
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const error = publicHttpError(response.status);
          throw new DeepSeekReviewError(error.code, error.message, error.retryable, retryAfterMilliseconds(response));
        }
        const payload = asRecord(await response.json());
        const choices = Array.isArray(payload.choices) ? payload.choices : [];
        const first = asRecord(choices[0]);
        const finishError = finishReasonError(first.finish_reason);
        if (finishError) throw finishError;
        const message = asRecord(first.message);
        const suggestions = parseDeepSeekSuggestions(message.content);
        return {
          attempts: attempt,
          model: typeof payload.model === 'string' && payload.model.trim() ? payload.model : DEEPSEEK_MODEL,
          suggestions,
          systemFingerprint: typeof payload.system_fingerprint === 'string' ? payload.system_fingerprint : null,
          usage: normalizeUsage(payload.usage),
        };
      } catch (error) {
        lastError = error instanceof DeepSeekReviewError
          ? error
          : error instanceof DOMException && error.name === 'AbortError'
            ? new DeepSeekReviewError('MODEL_TIMEOUT', 'The AI review timed out.', true)
            : new DeepSeekReviewError('MODEL_NETWORK_ERROR', 'The AI service could not be reached.', true);
      } finally {
        clearTimeout(timeout);
      }

      if (!lastError.retryable || attempt === MAX_ATTEMPTS) throw lastError;
      if (lastError.code === 'MODEL_OUTPUT_TRUNCATED' && outputTokenLimitIndex < OUTPUT_TOKEN_LIMITS.length - 1) {
        outputTokenLimitIndex += 1;
      }
      await this.sleep(lastError.retryAfterMs ?? RETRY_DELAYS_MS[attempt - 1]);
    }
    throw lastError ?? new DeepSeekReviewError('MODEL_UNKNOWN_ERROR', 'The AI review failed.', true);
  }
}
