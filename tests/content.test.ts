import { describe, expect, it } from 'vitest';
import { content } from '../src/content/index';
import type { Block } from '../src/content/types';

/** Every string in the content, including nested blocks, links and chat. */
function allStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => allStrings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => allStrings(x, out));
  return out;
}
const strings = allStrings(content);
const blob = strings.join('\n');

function allBlocks(): Block[] {
  return [...content.stops.flatMap((s) => s.briefing.flatMap((p) => p.blocks)), ...content.chatTopics.flatMap((t) => t.answer)];
}
function allLinks() {
  return [
    ...content.profile.links,
    ...allBlocks().flatMap((b) => (b.type === 'links' ? b.links : [])),
  ];
}

describe('profile', () => {
  it('has the fixed identity', () => {
    expect(content.profile.name).toBe('Richman Tan');
    expect(content.profile.title).toBe('Software Developer · Sandfield');
    expect(content.profile.location).toBe('Auckland, New Zealand');
    expect(content.profile.email).toBe('richmantan0@gmail.com');
    const hrefs = content.profile.links.map((l) => l.href);
    expect(hrefs).toContain('https://github.com/Richman-Tan');
    expect(hrefs).toContain('https://www.linkedin.com/in/richman-tan/');
    expect(hrefs).toContain('mailto:richmantan0@gmail.com');
  });
  it('has no phone number', () => {
    expect(blob).not.toMatch(/\+64|\b021\b|\bphone\b|\bmobile number\b/i);
    expect(blob).not.toMatch(/\d{3}[\s-]\d{3}[\s-]\d{3,4}/);
  });
});

describe('study facts', () => {
  it('shows the CV GPA and never 8.25', () => {
    expect(blob).toContain('8.0 / 9');
    expect(blob).not.toContain('8.25');
    expect(blob).toContain('Dean\'s Honours List 2023 & 2024');
    expect(blob).toContain('top 5% of cohort');
    expect(blob).toContain('2023–2026');
  });
});

describe('Sandfield', () => {
  const deny = ['CallerChecker', 'Caller Verification', 'SecurityDashboard', 'security vulnerability dashboard', 'SAL.', 'Mainstreet', '200+ engineers', '1,000+ security alerts'];
  it('keeps internal names out of every string', () => {
    for (const d of deny) expect(blob).not.toContain(d);
  });
  it('has no digits-heavy metrics in the Sandfield page', () => {
    const p = content.stops.find((s) => s.id === 'work')!.briefing.find((x) => x.id === 'sandfield')!;
    const text = allStrings(p.blocks).join(' ');
    expect(text).not.toMatch(/\d+\+|\d+ (repositories|alerts|engineers|APIs)/i);
  });
});

describe('links', () => {
  it('only uses https: or mailto:', () => {
    for (const l of allLinks()) expect(l.href).toMatch(/^(https:\/\/|mailto:)/);
    for (const c of content.credits) if (c.href) expect(c.href).toMatch(/^https:\/\//);
    for (const m of blob.matchAll(/\]\(([^)]+)\)/g)) expect(m[1]).toMatch(/^(https:\/\/|mailto:)/);
  });
  it('has no WIE links and no dropped private repo links', () => {
    const wie = content.stops.find((s) => s.id === 'projects')!.briefing.find((p) => p.id === 'wie-academy')!;
    expect(wie.blocks.some((b) => b.type === 'links')).toBe(false);
    expect(allStrings(wie)).not.toContain('github');
    expect(blob).not.toContain('SOFTENG761-Project');
    expect(blob).not.toContain('group-project-chuds');
  });
});

describe('copy style', () => {
  it('has no em dashes', () => {
    expect(blob).not.toContain('—');
  });
  it('does not mention upcoming trips on the off-the-clock stop', () => {
    const t = allStrings(content.stops.find((s) => s.id === 'offclock')).join(' ');
    expect(t).not.toMatch(/\b(next month|upcoming|this (summer|winter)|booked|flying to|20(26|27))\b/i);
  });
});

describe('stops', () => {
  it('has five stops with at least one page each, unique page ids', () => {
    expect(content.stops.map((s) => s.id)).toEqual(['projects', 'work', 'study', 'talk', 'offclock']);
    for (const s of content.stops) {
      expect(s.briefing.length).toBeGreaterThan(0);
      expect(new Set(s.briefing.map((p) => p.id)).size).toBe(s.briefing.length);
    }
  });
  it('keeps the M0 beacon anchors', () => {
    const b = Object.fromEntries(content.stops.map((s) => [s.id, s.beacon]));
    expect(b.projects).toMatchObject({ at: { kind: 'landmark', id: 'skyTower' }, color: 'pohutukawa', icon: 'code', triggerRadius: 220, orbitRadius: 240 });
    expect(b.work).toMatchObject({ at: { kind: 'geo', lat: -36.856975, lon: 174.747333 }, color: 'kowhai', icon: 'briefcase', triggerRadius: 180, orbitRadius: 200 });
    expect(b.study).toMatchObject({ at: { kind: 'geo', lat: -36.8523, lon: 174.7698 }, color: 'harbour', icon: 'cap', triggerRadius: 180, orbitRadius: 200 });
    expect(b.talk).toMatchObject({ at: { kind: 'landmark', id: 'harbourBridgeTop' }, color: 'cream', icon: 'chat', triggerRadius: 200, orbitRadius: 220 });
    expect(b.offclock).toMatchObject({ at: { kind: 'geo', lat: -36.87805, lon: 174.76452 }, color: 'volcanic', icon: 'peak', triggerRadius: 220, orbitRadius: 240 });
  });
  it('covers the required projects and work entries', () => {
    const ids = (id: string) => content.stops.find((s) => s.id === id)!.briefing.map((p) => p.id);
    expect(ids('projects')).toEqual(expect.arrayContaining(['dementiaguide', 'wie-academy', 'chudvents', 'vps', 'this-site']));
    expect(ids('work')).toEqual(['sandfield', 'fetch-tcg']);
    expect(ids('study')).toEqual(expect.arrayContaining(['degree', 'sesa', 'wdcc']));
  });
});

describe('media and chat', () => {
  it('gives every media item alt text and dimensions', () => {
    for (const b of allBlocks()) {
      if (b.type !== 'media') continue;
      expect(b.media.alt.trim().length).toBeGreaterThan(3);
      expect(b.media.width).toBeGreaterThan(0);
      expect(b.media.height).toBeGreaterThan(0);
      expect(b.media.src).toMatch(/\.webp$/);
    }
  });
  it('has 4 to 6 quick answers', () => {
    expect(content.chatTopics.length).toBeGreaterThanOrEqual(4);
    expect(content.chatTopics.length).toBeLessThanOrEqual(6);
    const qa = content.stops.find((s) => s.id === 'talk')!.briefing.find((p) => p.id === 'quick-answers')!;
    const text = allStrings(qa.blocks).join('\n');
    for (const t of content.chatTopics) expect(text).toContain(t.prompt);
  });
  it('has credits', () => {
    const t = content.credits.map((c) => c.text).join(' ');
    expect(t).toMatch(/OpenStreetMap/);
    expect(t).toMatch(/ODbL/);
    expect(t).toMatch(/LINZ/);
    expect(t).toMatch(/CC BY 4\.0/);
    expect(t).toMatch(/Open Font License/);
    expect(t).toMatch(/dvlan\.dev/);
  });
});
