/**
 * The /api/chat request handler, written against web-standard Request/Response so it runs as a
 * Vercel Node.js function and in tests. It imports only the SDK, so the function needs no bundling. The Anthropic client is injected; with no client (no API key
 * set) the endpoint reports itself disabled and the site falls back to its scripted answers.
 *
 * The contract
 *
 *   GET  /api/chat   200 { "enabled": boolean }
 *   POST /api/chat   body { "messages": [{ "role": "user" | "assistant", "text": string }, ...] }
 *                    1 to 12 turns, alternating, starting and ending with the visitor.
 *
 *   Anything wrong before an answer starts is a JSON error with a status, whatever was asked for:
 *     400 json | invalid, 403 origin, 405 method, 413 too_large, 429 rate_limited,
 *     502 refused | empty | upstream, 503 disabled | busy            body { "error": string }
 *
 *   Without "Accept: text/event-stream" the answer is one JSON object:
 *     200 { "text": string }
 *
 *   With it, the answer is a server-sent event stream that starts once the first sentence is ready:
 *     event: text    data: { "text": string }    one or more; the answer is their concatenation
 *     event: done    data: {}                    the answer is complete and may be kept
 *     event: error   data: { "error": string }   discard everything received (a refusal or a
 *                                                failure arrived after text had been sent)
 *   A stream that ends without "done" is a failure too. Every piece of text is already in house
 *   style (see houseStyle and createTidyStream), so a client may show each one as it arrives.
 *
 * Spend is bounded three ways: short answers (max_tokens), per-visitor and per-instance rate limits
 * here, and the monthly spend limit set on the Anthropic account, which is the hard cap. The origin
 * and Sec-Fetch-Site checks only stop other websites' pages; a script can forge them, so they are not
 * an abuse control.
 */
import Anthropic from '@anthropic-ai/sdk';

export const CHAT_MODEL = 'claude-haiku-5-5';
/** Matches MAX_QUESTION in ./index.ts (kept separate so this file has no UI imports). */
const MAX_USER_CHARS = 200;
/** Real answers are under 70 words; a longer forged "Richman said" turn is rejected. */
const MAX_ASSISTANT_CHARS = 600;
const MAX_TURNS = 12;
const MAX_BODY_BYTES = 16_000;

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface ChatHandlerDeps {
  /** Null when no API key is configured. */
  client: Pick<Anthropic, 'messages'> | null;
  system: string;
  isAllowedOrigin(origin: string): boolean;
  /** URLs the site itself links to; any other link in an answer is shown as plain text. */
  allowedLinks: ReadonlySet<string>;
  now?: () => number;
  /** Requests per visitor IP per window, and per instance per hour. */
  limits?: { perIp: number; windowMs: number; perHour: number };
  log?: (entry: Record<string, unknown>) => void;
}

const SITE_ORIGINS = new Set(['https://richmantan.vercel.app', 'https://richmantan.dev', 'https://www.richmantan.dev']);
const PREVIEW_ORIGIN = /^https:\/\/richmantan-[a-z0-9-]+-richman-tans-projects-2141fd6d\.vercel\.app$/;
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function isSiteOrigin(origin: string): boolean {
  return SITE_ORIGINS.has(origin) || PREVIEW_ORIGIN.test(origin) || LOCAL_ORIGIN.test(origin);
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/** Parses and checks the request body; returns the turns or an error string. */
export function parseTurns(body: unknown): ChatTurn[] | string {
  const messages = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > MAX_TURNS) return 'messages must be 1 to 12 turns';
  const turns: ChatTurn[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i] as { role?: unknown; text?: unknown };
    const role = i % 2 === 0 ? 'user' : 'assistant';
    if (m?.role !== role) return 'turns must alternate, starting with the visitor';
    if (typeof m.text !== 'string') return 'each turn needs text';
    const text = m.text.trim();
    const max = role === 'user' ? MAX_USER_CHARS : MAX_ASSISTANT_CHARS;
    if (!text || text.length > max) return `turn ${i + 1} is empty or too long`;
    turns.push({ role, text });
  }
  if (turns[turns.length - 1].role !== 'user') return 'the last turn must be the visitor';
  return turns;
}

const LINK = /\[([^\]]*)\]\(([^)\s]*)\)/g;
const roundBrackets = (s: string) => s.replace(/\[/g, '(').replace(/\]/g, ')');

/**
 * House style for an answer, or for one piece of it: no em dashes, and links only to URLs the site
 * already uses. A link to anywhere else keeps its label and loses its address.
 *
 * Every other square bracket becomes a round one, so the only "[" and "]" left are the two that
 * delimit each link that was checked. That is what makes the allowlist hold however the text is
 * put together afterwards: no leftover brackets can be combined into a link, whether by nesting
 * ("[[a](b)](c)" would otherwise leave "[a](c)") or by joining two pieces that were each harmless.
 */
export function houseStyle(text: string, allowedLinks: ReadonlySet<string> = new Set()): string {
  const t = text.replace(/\s*—\s*/g, ', ');
  let out = '';
  let at = 0;
  for (const m of t.matchAll(LINK)) {
    const label = roundBrackets(m[1]);
    out += roundBrackets(t.slice(at, m.index)) + (allowedLinks.has(m[2]) ? `[${label}](${m[2]})` : label);
    at = m.index + m[0].length;
  }
  return out + roundBrackets(t.slice(at));
}

/** House style for a whole answer; one cut off by max_tokens also ends at a full sentence. */
export function tidyAnswer(text: string, truncated: boolean, allowedLinks: ReadonlySet<string> = new Set()): string {
  let t = houseStyle(text, allowedLinks).trim();
  if (truncated) {
    const end = Math.max(t.lastIndexOf('. '), t.lastIndexOf('! '), t.lastIndexOf('? '));
    if (end > 15) t = t.slice(0, end + 1);
  }
  return t.slice(0, MAX_ASSISTANT_CHARS);
}

/** From a "[" to the end of the text: a link that has started and could still be completed. */
const PENDING_LINK = /^\[[^\]]*(\](\([^)\s]*)?)?$/;
/** The end of a sentence (with a closing quote or bracket), when whitespace follows; or a line break. */
const SENTENCE_END = /[.!?]["')\]]?(?=\s)|\n/g;
/** Text held back waiting for a sentence to end or a link to close is released at this length regardless. */
const MAX_HOLD = 300;

export interface TidyStream {
  /** Feed the next piece of the model's text; returns what is now safe to show ('' if nothing yet). */
  push(delta: string): string;
  /** The model has stopped. Returns the last piece. `truncated`: it was cut off mid-thought. */
  end(truncated: boolean): string;
  /** Characters returned so far. */
  readonly emitted: number;
  /** True once the answer has reached its length limit; anything further is dropped. */
  readonly full: boolean;
}

/**
 * tidyAnswer for text that arrives a few characters at a time. It releases whole sentences, each
 * already in house style, so a piece can be shown the moment it is released.
 *
 *  - A link is held back until it is complete, so that it reaches houseStyle in one piece and a
 *    link the site allows stays a link. (Safety does not depend on this: see houseStyle.)
 *  - An answer cut off by max_tokens ends at the last full sentence, because the unfinished one
 *    was never released. So does one that reaches the length limit.
 *
 * For an answer within the limit that is not cut off, the pieces joined together are
 * tidyAnswer(text) of the whole (bar brackets nested inside a link's label, which come out as
 * plain text either way).
 */
export function createTidyStream(allowedLinks: ReadonlySet<string> = new Set()): TidyStream {
  let buf = '';
  let emitted = 0;
  let full = false;

  /** Release the first n characters of the buffer. */
  function take(n: number, last: boolean): string {
    let out = houseStyle(buf.slice(0, n), allowedLinks);
    buf = buf.slice(n);
    if (full) return '';
    if (emitted === 0) out = out.trimStart();
    if (last) out = out.trimEnd();
    const room = MAX_ASSISTANT_CHARS - emitted;
    if (out.length > room) {
      // Over the limit. Stop at the sentence before, unless this is the first thing to say.
      full = true;
      buf = '';
      out = emitted > 0 ? '' : out.slice(0, room);
    }
    emitted += out.length;
    return out;
  }

  /** How much of the buffer ends on a sentence and is not inside a link that might still close. */
  function safeLength(): number {
    let n = 0;
    SENTENCE_END.lastIndex = 0;
    for (let m = SENTENCE_END.exec(buf); m; m = SENTENCE_END.exec(buf)) n = m.index + m[0].length;
    const open = buf.lastIndexOf('[', n - 1);
    if (n > 0 && open >= 0 && PENDING_LINK.test(buf.slice(open, n))) n = open;
    return n;
  }

  return {
    get emitted() {
      return emitted;
    },
    get full() {
      return full;
    },
    push(delta) {
      if (full) return '';
      buf += delta;
      const n = safeLength();
      if (n > 0) return take(n, false);
      if (buf.length <= MAX_HOLD) return '';
      // No sentence end in sight (or one endless "link"): let it go at a word break.
      const space = buf.lastIndexOf(' ');
      return take(space > 0 ? space : buf.length, false);
    },
    end(truncated) {
      // Cut off mid-sentence: what has been released already ends on a full sentence, so stop there.
      if (full || (truncated && emitted > 0)) {
        buf = '';
        return '';
      }
      return take(buf.length, true);
    },
  };
}

/** How long an answer may take before it is cut short; inside the function's 15 s maxDuration (vercel.json). */
const ANSWER_DEADLINE_MS = 9_000;

type Outcome = { ok: true } | { ok: false; error: 'refused' | 'empty' | 'upstream' | 'busy' };
const STATUS: Record<Exclude<Outcome, { ok: true }>['error'], number> = { refused: 502, empty: 502, upstream: 502, busy: 503 };

const encoder = new TextEncoder();
const sse = (event: string, data: unknown) => encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

export function createChatHandler(deps: ChatHandlerDeps): (req: Request) => Promise<Response> {
  const now = deps.now ?? Date.now;
  const limits = deps.limits ?? { perIp: 12, windowMs: 10 * 60_000, perHour: 400 };
  const log = deps.log ?? ((e) => console.log(JSON.stringify(e)));
  const hits = new Map<string, number[]>();
  let hourStart = now();
  let hourCount = 0;

  function limited(ip: string): boolean {
    const t = now();
    if (t - hourStart > 3_600_000) {
      hourStart = t;
      hourCount = 0;
    }
    if (hourCount >= limits.perHour) return true;
    const recent = (hits.get(ip) ?? []).filter((x) => t - x < limits.windowMs);
    if (recent.length >= limits.perIp) {
      hits.set(ip, recent);
      return true;
    }
    recent.push(t);
    hits.set(ip, recent);
    if (hits.size > 5000) hits.delete(hits.keys().next().value as string);
    hourCount++;
    return false;
  }

  /**
   * One answer, as tidied pieces. Yields each piece when it is ready; returns how it ended. When
   * `gone` fires (the visitor has left) the request to the model is aborted there and then. On
   * Vercel that signal only arrives because vercel.json sets supportsCancellation for this function.
   */
  async function* answer(client: Pick<Anthropic, 'messages'>, turns: ChatTurn[], gone: AbortSignal): AsyncGenerator<string, Outcome> {
    const tidy = createTidyStream(deps.allowedLinks);
    // Output tokens are reported when the model stops; an answer this handler ends early logs null.
    const usage = { in: 0, out: null as number | null, cacheRead: 0, cacheWrite: 0 };
    let stop: string | null = null;
    /** Why this handler stopped the model's stream itself, if it did. (An object, because the timer sets it from a callback.) */
    const run = { ended: null as 'capped' | 'timeout' | 'gone' | null };
    const upstream = client.messages.stream(
      {
        model: CHAT_MODEL,
        max_tokens: 1024,
        // Low effort: short, grounded answers; the model can skip thinking on easy questions.
        output_config: { effort: 'low' },
        system: [{ type: 'text', text: deps.system, cache_control: { type: 'ephemeral' } }],
        messages: turns.map((t) => ({ role: t.role, content: t.text })),
      },
      // No retry: the browser gives up at 12 s and shows the scripted answer, so a retry would be spend nobody sees.
      { timeout: ANSWER_DEADLINE_MS, maxRetries: 0 },
    );
    const stopFor = (why: 'timeout' | 'gone') => {
      run.ended ??= why;
      upstream.abort();
    };
    const timer = setTimeout(() => stopFor('timeout'), ANSWER_DEADLINE_MS);
    const onGone = () => stopFor('gone');
    gone.addEventListener('abort', onGone, { once: true });
    if (gone.aborted) onGone();
    try {
      for await (const ev of upstream) {
        if (ev.type === 'message_start') {
          const u = ev.message.usage;
          usage.in = u.input_tokens;
          usage.cacheRead = u.cache_read_input_tokens ?? 0;
          usage.cacheWrite = u.cache_creation_input_tokens ?? 0;
        } else if (ev.type === 'message_delta') {
          stop = ev.delta.stop_reason;
          usage.out = ev.usage.output_tokens;
        } else if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
          const piece = tidy.push(ev.delta.text);
          if (piece) yield piece;
          if (tidy.full) {
            // Long enough: leaving the loop aborts the request, so no more tokens are generated.
            run.ended = 'capped';
            break;
          }
        }
      }
    } catch (err) {
      // Aborting the stream ourselves (deadline, visitor gone) surfaces here as an error too; that one is expected.
      if (run.ended === null) {
        if (err instanceof Anthropic.RateLimitError) {
          log({ chat: 'upstream_rate_limited', stream: true });
          return { ok: false, error: 'busy' };
        }
        if (err instanceof Anthropic.APIError) log({ chat: 'upstream_error', stream: true, status: err.status ?? null });
        else log({ chat: 'error', stream: true, message: err instanceof Error ? err.message : String(err) });
        return { ok: false, error: 'upstream' };
      }
    } finally {
      clearTimeout(timer);
      gone.removeEventListener('abort', onGone);
    }
    // Usage only; visitor text is never logged.
    log({ chat: 'ok', stream: true, stop: run.ended ?? stop, ...usage });
    if (run.ended === 'gone') return { ok: true };
    if (stop === 'refusal') return { ok: false, error: 'refused' };
    // Out of time with nothing complete to show: let the visitor's browser use its scripted answer.
    if (run.ended === 'timeout' && tidy.emitted === 0) return { ok: false, error: 'upstream' };
    if (run.ended !== 'capped') {
      const last = tidy.end(stop === 'max_tokens' || run.ended === 'timeout');
      if (last) yield last;
    }
    return tidy.emitted > 0 ? { ok: true } : { ok: false, error: 'empty' };
  }

  /** The answer as an event stream, or a JSON error if it fails before its first piece. */
  async function streamed(client: Pick<Anthropic, 'messages'>, turns: ChatTurn[], req: Request): Promise<Response> {
    const gone = new AbortController();
    req.signal.addEventListener('abort', () => gone.abort(), { once: true });
    const pieces = answer(client, turns, gone.signal);
    const first = await pieces.next();
    if (first.done) return first.value.ok ? json(502, { error: 'empty' }) : json(STATUS[first.value.error], { error: first.value.error });
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(sse('text', { text: first.value }));
      },
      async pull(c) {
        const next = await pieces.next();
        if (gone.signal.aborted) return;
        if (!next.done) {
          c.enqueue(sse('text', { text: next.value }));
          return;
        }
        c.enqueue(next.value.ok ? sse('done', {}) : sse('error', { error: next.value.error }));
        c.close();
      },
      // The visitor closed the chat or the tab: stop generating now, not at the next sentence.
      cancel() {
        gone.abort();
        void pieces.return({ ok: true });
      },
    });
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store, no-transform', 'x-accel-buffering': 'no' },
    });
  }

  return async (req) => {
    if (req.method === 'GET') return json(200, { enabled: deps.client !== null });
    if (req.method !== 'POST') return json(405, { error: 'method' });

    const origin = req.headers.get('origin') ?? '';
    if (!deps.isAllowedOrigin(origin)) return json(403, { error: 'origin' });
    if (!deps.client) return json(503, { error: 'disabled' });

    // Browsers mark same-site fetches; this keeps other sites' pages out (scripts can still forge it).
    const site = req.headers.get('sec-fetch-site');
    if (site !== null && site !== 'same-origin') return json(403, { error: 'origin' });
    if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return json(413, { error: 'too_large' });
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return json(413, { error: 'too_large' });
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return json(400, { error: 'json' });
    }
    const turns = parseTurns(body);
    if (typeof turns === 'string') return json(400, { error: 'invalid', detail: turns });

    const ip =
      req.headers.get('x-real-ip') ||
      req.headers.get('x-vercel-forwarded-for') ||
      (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() ||
      'unknown';
    if (limited(ip)) return json(429, { error: 'rate_limited' });

    if ((req.headers.get('accept') ?? '').includes('text/event-stream')) return streamed(deps.client, turns, req);

    try {
      const res = await deps.client.messages.create(
        {
          model: CHAT_MODEL,
          max_tokens: 1024,
          // Low effort: short, grounded answers; the model can skip thinking on easy questions.
          output_config: { effort: 'low' },
          system: [{ type: 'text', text: deps.system, cache_control: { type: 'ephemeral' } }],
          messages: turns.map((t) => ({ role: t.role, content: t.text })),
        },
        // No retry: the browser gives up at 12 s and shows the scripted answer, so a retry would be spend nobody sees.
        // 9 s also keeps inside the function's 15 s maxDuration (vercel.json).
        { timeout: 9_000, maxRetries: 0 },
      );
      // Usage only; visitor text is never logged.
      log({
        chat: 'ok',
        stop: res.stop_reason,
        in: res.usage.input_tokens,
        out: res.usage.output_tokens,
        cacheRead: res.usage.cache_read_input_tokens ?? 0,
        cacheWrite: res.usage.cache_creation_input_tokens ?? 0,
      });
      if (res.stop_reason === 'refusal') return json(502, { error: 'refused' });
      const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('').trim();
      if (!text) return json(502, { error: 'empty' });
      return json(200, { text: tidyAnswer(text, res.stop_reason === 'max_tokens', deps.allowedLinks) });
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) {
        log({ chat: 'upstream_rate_limited' });
        return json(503, { error: 'busy' });
      }
      if (err instanceof Anthropic.APIError) {
        log({ chat: 'upstream_error', status: err.status ?? null });
        return json(502, { error: 'upstream' });
      }
      log({ chat: 'error', message: err instanceof Error ? err.message : String(err) });
      return json(502, { error: 'upstream' });
    }
  };
}
