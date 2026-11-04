import { describe, expect, it } from 'vitest';
import { createScriptedBackend, MAX_QUESTION } from '../src/chat';
import { bestMatch, nextSuggestions, normalise } from '../src/chat/match';
import { content } from '../src/content';
import { frameGrid, HEIGHT, WIDTH, BASE, PORTRAIT_PALETTE } from '../src/ui/portrait';

const topics = content.chatTopics;
const priority = content.chat.smallTalk.filter((s) => s.priority);
const rest = content.chat.smallTalk.filter((s) => !s.priority);
const match = (q: string) => bestMatch(q, priority)?.id ?? bestMatch(q, topics)?.id ?? bestMatch(q, rest)?.id ?? null;

describe('normalise', () => {
  it('keeps c# and .net, drops apostrophes and punctuation', () => {
    expect(normalise("What's your C# / .NET experience?")).toBe('whats your c# dotnet experience');
    expect(normalise('  Hey!!  ')).toBe('hey');
  });
});

describe('scripted matching', () => {
  const cases: [string, string | null][] = [
    ['Who are you?', 'who'],
    ['tell me about yourself', 'who'],
    ['What do you do?', 'what-do'],
    ['what do you do for fun', 'fun'],
    ['Do you snowboard?', 'fun'],
    ['any hobbies?', 'fun'],
    ['what have you built', 'built'],
    ['show me your projects', 'built'],
    ['where do you work', 'work'],
    ['where are you working now?', 'work'],
    ['are you looking for a new job?', 'by-email'],
    ['would you relocate', 'by-email'],
    ['his project', 'built'],
    ['Tell me about Sandfield', 'work'],
    ['did you do an internship?', 'work'],
    ["what's your gpa", 'study'],
    ['which university did you go to', 'study'],
    ['what is your tech stack', 'stack'],
    ['what languages do you know', 'stack'],
    ['do you know C#?', 'stack'],
    ['.NET?', 'stack'],
    ['tell me about dementia guide', 'dementiaguide'],
    ['DementiaGuide', 'dementiaguide'],
    ['what is WIE', 'wie'],
    ['were you a scrum master', 'wie'],
    ['how did you build this site', 'site'],
    ['how was this website made', 'site'],
    ['how do I contact you', 'reach'],
    ['can I hire you', 'reach'],
    ['where are you based', 'where'],
    ['hello', 'hello'],
    ['kia ora', 'hello'],
    ["how's it going?", 'how-are-you'],
    ['thanks!', 'thanks'],
    ['bye', 'bye'],
    ['his', null],
    ['asdfgh', null],
    ['', null],
  ];
  for (const [q, want] of cases) it(`"${q}" -> ${want}`, () => expect(match(q)).toBe(want));
});

describe('suggestions', () => {
  it('offers follow-ups first, never the current or an asked topic', () => {
    const s = nextSuggestions(topics, 'who', new Set(['who', 'study']), content.chat.starters);
    expect(s[0]).toBe('what-do');
    expect(s).not.toContain('who');
    expect(s).not.toContain('study');
    expect(s).toHaveLength(3);
  });
  it('still offers three once everything has been asked', () => {
    const all = new Set(topics.map((t) => t.id));
    const s = nextSuggestions(topics, 'reach', all, content.chat.starters);
    expect(s).toHaveLength(3);
    expect(s).not.toContain('reach');
  });
});

describe('scripted backend', () => {
  it('greets with the starters', () => {
    const b = createScriptedBackend(topics, content.chat);
    const g = b.greet();
    expect(g.kind).toBe('greeting');
    expect(g.suggestions).toEqual(content.chat.starters);
  });
  it('answers chips and typed questions, and falls back', async () => {
    const b = createScriptedBackend(topics, content.chat);
    expect((await b.ask({ topicId: 'fun' })).topicId).toBe('fun');
    expect((await b.ask({ text: 'where do you work?' })).topicId).toBe('work');
    expect((await b.ask({ text: 'hi there' })).kind).toBe('smalltalk');
    const f = await b.ask({ text: 'what is the airspeed of a swallow' });
    expect(f.kind).toBe('fallback');
    expect(f.suggestions.length).toBe(3);
    expect(f.suggestions).not.toContain('fun');
    expect(f.suggestions).not.toContain('work');
  });
  it('caps question length', async () => {
    const b = createScriptedBackend(topics, content.chat);
    const r = await b.ask({ text: `${'x'.repeat(MAX_QUESTION)} snowboard` });
    expect(r.kind).toBe('fallback');
  });
});

describe('portrait', () => {
  it('has a rectangular grid in the palette', () => {
    expect(BASE.every((r) => r.length === WIDTH)).toBe(true);
    expect(BASE).toHaveLength(HEIGHT);
    for (const f of [frameGrid('open', 'closed'), frameGrid('closed', 'open')]) {
      for (const ch of f.join('')) expect(ch === '.' || ch in PORTRAIT_PALETTE).toBe(true);
    }
  });
});
