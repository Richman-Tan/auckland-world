/**
 * Chat backends. The UI only knows ChatBackend: the scripted one here, or the remote one in
 * ./remote.ts (the /api/chat endpoint, with this scripted backend as its fallback).
 */
import type { Block, ChatScript, ChatTopic } from '../content/types';
import { bestMatch, nextSuggestions } from './match';

export type ChatQuestion = { topicId: string } | { text: string };

export interface ChatReply {
  kind: 'greeting' | 'topic' | 'smalltalk' | 'fallback' | 'ai';
  blocks: Block[];
  /** Topic ids to offer next. */
  suggestions: string[];
  topicId: string | null;
}

/**
 * Called with the answer so far while it is still being written (only AI answers arrive in
 * pieces). Each call carries everything received up to then, not just the new part. What it showed
 * is provisional: the reply `ask` resolves with is the answer, and it can be a different one if
 * the AI failed or declined part-way.
 */
export type LiveReply = (partial: Block[]) => void;

export interface ChatBackend {
  greet(): ChatReply;
  ask(q: ChatQuestion, live?: LiveReply): Promise<ChatReply>;
  /** The chip label for a topic id. */
  promptFor(topicId: string): string | null;
  /** Whether typed questions are answered by the AI ('ai') or by keyword matching ('scripted'). */
  mode?(): Promise<'ai' | 'scripted'>;
}

/** The scripted backend, plus the pieces a remote backend reuses. */
export interface ScriptedBackend extends ChatBackend {
  /** A reply for questions that should always go to email (job hunting, salary...), else null. */
  deflect(text: string): ChatReply | null;
  /** Topic ids to offer after a reply that was not about a topic. */
  suggestions(): string[];
}

/** Longest question a visitor can type. */
export const MAX_QUESTION = 200;

export function createScriptedBackend(topics: readonly ChatTopic[], script: ChatScript): ScriptedBackend {
  const asked = new Set<string>();
  const byId = new Map(topics.map((t) => [t.id, t]));

  function topicReply(t: ChatTopic): ChatReply {
    asked.add(t.id);
    return { kind: 'topic', blocks: t.answer, suggestions: nextSuggestions(topics, t.id, asked, script.starters), topicId: t.id };
  }

  const suggestions = () => nextSuggestions(topics, null, asked, script.starters);

  function deflect(text: string): ChatReply | null {
    const hit = bestMatch(text.slice(0, MAX_QUESTION), script.smallTalk.filter((s) => s.priority));
    return hit ? { kind: 'smalltalk', blocks: hit.answer, suggestions: suggestions(), topicId: null } : null;
  }

  function answer(q: ChatQuestion): ChatReply {
    if ('topicId' in q) {
      const t = byId.get(q.topicId);
      if (t) return topicReply(t);
    } else {
      const text = q.text.slice(0, MAX_QUESTION);
      const first = deflect(text);
      if (first) return first;
      const t = bestMatch(text, topics);
      if (t) return topicReply(t);
      const small = bestMatch(text, script.smallTalk.filter((s) => !s.priority));
      if (small) return { kind: 'smalltalk', blocks: small.answer, suggestions: nextSuggestions(topics, null, asked, script.starters), topicId: null };
    }
    return { kind: 'fallback', blocks: script.fallback, suggestions: nextSuggestions(topics, null, asked, script.starters), topicId: null };
  }

  return {
    greet: () => ({ kind: 'greeting', blocks: script.greeting, suggestions: nextSuggestions(topics, null, asked, script.starters), topicId: null }),
    ask: (q) => Promise.resolve(answer(q)),
    promptFor: (id) => byId.get(id)?.prompt ?? null,
    mode: () => Promise.resolve('scripted'),
    deflect,
    suggestions,
  };
}
