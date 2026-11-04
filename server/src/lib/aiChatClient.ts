import { HttpError } from '../errors';

/* Generic OpenAI-compatible chat-completions client — both Groq and OpenRouter speak this
   same shape, so the tool-calling loop in aiSuggestionService.ts can point at either. */

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  tools?: unknown[];
  tool_choice?: 'auto' | 'none' | 'required';
  temperature?: number;
  max_tokens?: number;
}

export interface ChatCompletionResponse {
  choices: { message: ChatMessage; finish_reason: string }[];
}

function mapErrorResponse(res: Response): HttpError {
  if (res.status === 401 || res.status === 403) return new HttpError(400, 'ai.invalid_key');
  // The key is fine, the account isn't: Cerebras and OpenRouter both answer 402 once the free
  // allowance or the prepaid balance is gone. Unlike a 429 this does not clear on its own.
  if (res.status === 402) return new HttpError(402, 'ai.quota_exhausted');
  if (res.status === 429) return new HttpError(429, 'ai.rate_limited');
  return new HttpError(502, 'ai.upstream_error');
}

/**
 * Failures that mean "this provider cannot serve the request" rather than "the request is wrong".
 *
 * A caller holding more than one key can retry the same conversation on the next provider instead
 * of surfacing any of these — see the failover in aiSuggestionService.
 */
const PROVIDER_FAILURE_CODES: ReadonlySet<string> = new Set([
  'ai.invalid_key',
  'ai.quota_exhausted',
  'ai.rate_limited',
  'ai.upstream_error',
  'ai.timeout',
]);

export function isProviderFailure(err: unknown): err is HttpError {
  return err instanceof HttpError && PROVIDER_FAILURE_CODES.has(err.code);
}

/** Providers send this on 429s, usually a fraction of a second to a few seconds for burst limits. */
function retryDelayMs(res: Response, attempt: number): number {
  const header = res.headers.get('retry-after');
  const seconds = header ? Number(header) : NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 10_000);
  return attempt * 1000; // no header: back off a bit more each retry
}

const MAX_ATTEMPTS = 3;

/* Replies are streamed. A self-hosted model behind Cloudflare is cut off with a 524 when nothing
   comes back for 100 s, and a non-streamed reply sends nothing until it is done — a minute or
   more while the GPU is busy. Streamed, the first bytes arrive within seconds. So the limit is on
   silence, not on length: a stream that stops for IDLE_MS is dead, and TOTAL_MS bounds the rest. */
const IDLE_MS = 60_000;
const TOTAL_MS = 300_000;

interface StreamDelta {
  content?: string | null;
  tool_calls?: {
    index: number;
    id?: string;
    type?: 'function';
    function?: { name?: string; arguments?: string };
  }[];
}

/** Folds an OpenAI-style SSE stream back into the one completion a non-streamed call returns. */
export async function readCompletionStream(
  body: ReadableStream<Uint8Array>,
  onChunk: () => void = () => {},
): Promise<ChatCompletionResponse | undefined> {
  let content = '';
  let finish = 'stop';
  let sawChoice = false;
  const calls: ToolCall[] = [];
  const decoder = new TextDecoder();
  let buffer = '';
  const take = (line: string): boolean => {
    if (!line.startsWith('data:')) return false;
    const data = line.slice(5).trim();
    if (data === '[DONE]') return true;
    const event = JSON.parse(data) as {
      error?: unknown;
      choices?: { delta?: StreamDelta; finish_reason?: string | null }[];
    };
    if (event.error) throw new HttpError(502, 'ai.upstream_error');
    const choice = event.choices?.[0];
    if (!choice) return false;
    sawChoice = true;
    if (choice.finish_reason) finish = choice.finish_reason;
    const delta = choice.delta ?? {};
    if (delta.content) content += delta.content;
    for (const part of delta.tool_calls ?? []) {
      const call = (calls[part.index] ??= {
        id: '',
        type: 'function',
        function: { name: '', arguments: '' },
      });
      if (part.id) call.id = part.id;
      if (part.function?.name) call.function.name += part.function.name;
      if (part.function?.arguments) call.function.arguments += part.function.arguments;
    }
    return false;
  };
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onChunk();
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) if (take(line.trim())) return result();
  }
  if (buffer.trim()) take(buffer.trim());
  return result();

  function result(): ChatCompletionResponse | undefined {
    if (!sawChoice) return undefined;
    const toolCalls = calls.filter(Boolean);
    return {
      choices: [
        {
          message: {
            role: 'assistant',
            content: content || null,
            ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
          },
          finish_reason: finish,
        },
      ],
    };
  }
}

/**
 * A 200 does not guarantee a completion. Providers occasionally answer OK with an error envelope
 * instead (OpenRouter does this when its own upstream fails), and a body without a usable
 * `choices` entry would otherwise be cast straight through and blow up in the caller's tool loop.
 * Rejecting it here turns it into an ordinary provider failure, so a user with a second key fails
 * over to it exactly as they would on a 402 or a 429.
 */
function asChatCompletion(payload: unknown): ChatCompletionResponse | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const { choices } = payload as { choices?: unknown };
  if (!Array.isArray(choices) || !choices.length) return undefined;
  if (!choices.every((c) => c && typeof c === 'object' && 'message' in c)) return undefined;
  return payload as ChatCompletionResponse;
}

/** This is the server's only outbound fetch — Node's global fetch, no new dependency. */
export async function chatCompletion(
  baseUrl: string,
  apiKey: string,
  body: ChatCompletionRequest,
  extraHeaders?: Record<string, string>,
): Promise<ChatCompletionResponse> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    const controller = new AbortController();
    let idle = setTimeout(() => controller.abort(), IDLE_MS);
    const total = setTimeout(() => controller.abort(), TOTAL_MS);
    const alive = () => {
      clearTimeout(idle);
      idle = setTimeout(() => controller.abort(), IDLE_MS);
    };
    const stop = () => {
      clearTimeout(idle);
      clearTimeout(total);
    };
    const timedOut = () => {
      stop();
      return controller.signal.aborted
        ? new HttpError(504, 'ai.timeout')
        : new HttpError(502, 'ai.upstream_error');
    };
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          ...extraHeaders,
        },
        body: JSON.stringify({ ...body, stream: true }),
        signal: controller.signal,
      });
    } catch {
      throw timedOut();
    }
    if (res.ok) {
      let payload: unknown;
      let completion: ChatCompletionResponse | undefined;
      try {
        // Some providers answer a streamed request with one JSON body (an error envelope, or a
        // proxy that does not stream): read whichever came back.
        if (res.headers.get('content-type')?.includes('text/event-stream') && res.body) {
          completion = await readCompletionStream(res.body, alive);
        } else {
          payload = await res.json().catch(() => undefined);
          completion = asChatCompletion(payload);
        }
      } catch (err) {
        if (err instanceof HttpError) {
          stop();
          throw err;
        }
        throw timedOut();
      }
      stop();
      if (completion) return completion;
      console.warn(
        `ai chat (${baseUrl}): 200 without usable choices`,
        JSON.stringify(payload)?.slice(0, 500),
      );
      throw new HttpError(502, 'ai.upstream_error');
    }

    // Free-tier rate limits are commonly short bursts, not real capacity problems — the account
    // can easily have headroom while a single request still gets a 429. Retry a couple of times
    // honoring Retry-After before giving up.
    if (res.status === 429 && attempt < MAX_ATTEMPTS) {
      stop();
      const detail = await res.text().catch(() => '');
      const wait = retryDelayMs(res, attempt);
      console.warn(
        `ai chat (${baseUrl}): 429 on attempt ${attempt}/${MAX_ATTEMPTS}, retrying in ${wait}ms`,
        detail.slice(0, 500),
      );
      await new Promise((resolve) => setTimeout(resolve, wait));
      continue;
    }

    stop();
    const detail = await res.text().catch(() => '');
    if (detail)
      console.warn(`ai chat (${baseUrl}): request failed (${res.status})`, detail.slice(0, 500));
    throw mapErrorResponse(res);
  }
  throw new HttpError(429, 'ai.rate_limited');
}
