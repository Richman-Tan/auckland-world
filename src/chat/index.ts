/**
 * Chat backends. The UI only knows ChatBackend, so a remote one (an /api/chat endpoint backed by
 * an LLM, with the scripted backend as its fallback) can replace this without touching the view.
 */
import type { Block, ChatScript, ChatTopic } from '../content/types';
import { bestMatch, nextSuggestions } from './match';

export type ChatQuestion = { topicId: string } | { text: string };

export interface ChatReply {
  kind: 'greeting' | 'topic' | 'smalltalk' | 'fallback';
  blocks: Block[];
  /** Topic ids to offer next. */
  suggestions: string[];
  topicId: string | null;
}

export interface ChatBackend {
  greet(): ChatReply;
  ask(q: ChatQuestion): Promise<ChatReply>;
  /** The chip label for a topic id. */
  promptFor(topicId: string): string | null;
}

/** Longest question a visitor can type. */
export const MAX_QUESTION = 200;

export function createScriptedBackend(topics: readonly ChatTopic[], script: ChatScript): ChatBackend {
  const asked = new Set<string>();
  const byId = new Map(topics.map((t) => [t.id, t]));

  function topicReply(t: ChatTopic): ChatReply {
    asked.add(t.id);
    return { kind: 'topic', blocks: t.answer, suggestions: nextSuggestions(topics, t.id, asked, script.starters), topicId: t.id };
  }

  function answer(q: ChatQuestion): ChatReply {
    if ('topicId' in q) {
      const t = byId.get(q.topicId);
      if (t) return topicReply(t);
    } else {
      const text = q.text.slice(0, MAX_QUESTION);
      const first = bestMatch(text, script.smallTalk.filter((s) => s.priority));
      if (first) return { kind: 'smalltalk', blocks: first.answer, suggestions: nextSuggestions(topics, null, asked, script.starters), topicId: null };
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
  };
}
