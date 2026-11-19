import { describe, expect, it } from 'vitest';
import { type AppState, simulationRunning, transition } from '../src/app/fsm';

const ctx = { pageCount: (s: string) => (s === 'projects' ? 4 : 2), hasChat: (s: string) => s === 'talk', hasRoom: (s: string) => s === 'projects' };
const run = (s: AppState, ...events: Parameters<typeof transition>[1][]) => events.reduce((st, e) => transition(st, e, ctx), s);

describe('fsm', () => {
  it('title -> loading -> flying', () => {
    const s = run({ kind: 'title' }, { type: 'FLY' }, { type: 'LOADED' });
    expect(s).toEqual({ kind: 'flying' });
  });

  it('go straight to a stop opens its briefing after loading', () => {
    const s = run({ kind: 'title' }, { type: 'GO_TO_STOP', stop: 'projects' }, { type: 'LOADED' });
    expect(s).toEqual({ kind: 'briefing', stop: 'projects', page: 0, pageCount: 4 });
  });

  it('nav -> select -> engage -> arrive -> briefing -> back', () => {
    let s = run({ kind: 'flying' }, { type: 'OPEN_NAV' }, { type: 'NAV_SELECT', stop: 'study' });
    expect(s).toEqual({ kind: 'nav', selected: 'study' });
    s = run(s, { type: 'ENGAGE' });
    expect(s).toEqual({ kind: 'autopilot', target: 'study', phase: 'climb' });
    s = run(s, { type: 'AUTOPILOT_PHASE', phase: 'cruise' }, { type: 'ARRIVED' });
    expect(s).toEqual({ kind: 'briefing', stop: 'study', page: 0, pageCount: 2 });
    s = run(s, { type: 'BACK' });
    expect(s).toEqual({ kind: 'flying' });
  });

  it('engage with nothing selected does nothing', () => {
    const s: AppState = { kind: 'nav', selected: null };
    expect(transition(s, { type: 'ENGAGE' }, ctx)).toBe(s);
  });

  it('Tab toggles the nav overlay', () => {
    expect(run({ kind: 'flying' }, { type: 'OPEN_NAV' }, { type: 'OPEN_NAV' })).toEqual({ kind: 'flying' });
  });

  it('manual input cancels autopilot', () => {
    const s = run({ kind: 'autopilot', target: 'work', phase: 'cruise' }, { type: 'CANCEL_AUTOPILOT' });
    expect(s).toEqual({ kind: 'flying' });
  });

  it('briefing pages clamp', () => {
    let s = run({ kind: 'flying' }, { type: 'OPEN_BRIEFING', stop: 'projects' });
    s = run(s, { type: 'PAGE', delta: -1 });
    expect(s).toMatchObject({ page: 0 });
    s = run(s, { type: 'PAGE', delta: 1 }, { type: 'PAGE', delta: 1 }, { type: 'PAGE', delta: 1 }, { type: 'PAGE', delta: 1 });
    expect(s).toMatchObject({ page: 3 });
    s = run(s, { type: 'PAGE_SET', page: 1 });
    expect(s).toMatchObject({ page: 1 });
  });

  it('pause and resume restore the previous state', () => {
    const before: AppState = { kind: 'autopilot', target: 'talk', phase: 'descend' };
    const paused = transition(before, { type: 'PAUSE', reason: 'hidden' }, ctx);
    expect(paused.kind).toBe('paused');
    expect(transition(paused, { type: 'BACK' }, ctx)).toBe(paused); // hidden pause ignores Esc
    expect(transition(paused, { type: 'RESUME' }, ctx)).toEqual(before);
  });

  it('Esc while flying opens the pause menu; Esc again resumes', () => {
    const s = run({ kind: 'flying' }, { type: 'BACK' });
    expect(s).toMatchObject({ kind: 'paused', reason: 'menu' });
    expect(run(s, { type: 'BACK' })).toEqual({ kind: 'flying' });
  });

  it('a link from the title opens the stop at that page, or inside its room', () => {
    let s = run({ kind: 'title' }, { type: 'GO_TO_STOP', stop: 'projects', page: 2 });
    expect(s).toEqual({ kind: 'loading', intent: { mode: 'stop', stop: 'projects', page: 2 } });
    expect(run(s, { type: 'LOADED' })).toEqual({ kind: 'briefing', stop: 'projects', page: 2, pageCount: 4 });
    // A page past the end is clamped rather than trusted.
    expect(run({ kind: 'title' }, { type: 'GO_TO_STOP', stop: 'projects', page: 99 }, { type: 'LOADED' })).toMatchObject({ kind: 'briefing', page: 3 });
    s = run({ kind: 'title' }, { type: 'GO_TO_STOP', stop: 'projects', room: true }, { type: 'LOADED' });
    expect(s).toEqual({ kind: 'room', stop: 'projects', panel: null, pageCount: 4 });
    s = run({ kind: 'title' }, { type: 'GO_TO_STOP', stop: 'projects', room: true, page: 1 }, { type: 'LOADED' });
    expect(s).toEqual({ kind: 'room', stop: 'projects', panel: 1, pageCount: 4 });
    // No room at this stop: the link falls back to its briefing. A chat stop ignores the page.
    expect(run({ kind: 'title' }, { type: 'GO_TO_STOP', stop: 'study', room: true }, { type: 'LOADED' })).toEqual({ kind: 'briefing', stop: 'study', page: 0, pageCount: 2 });
    expect(run({ kind: 'title' }, { type: 'GO_TO_STOP', stop: 'talk', page: 1 }, { type: 'LOADED' })).toEqual({ kind: 'chat', stop: 'talk' });
  });

  it('the tour loads, then flies to its first stop on autopilot', () => {
    const s = run({ kind: 'title' }, { type: 'TOUR', stop: 'projects' });
    expect(s).toEqual({ kind: 'loading', intent: { mode: 'tour', stop: 'projects' } });
    expect(run(s, { type: 'LOADED' })).toEqual({ kind: 'autopilot', target: 'projects', phase: 'climb' });
    expect(run({ kind: 'flying' }, { type: 'TOUR', stop: 'projects' })).toEqual({ kind: 'flying' });
  });

  it('JUMP cuts to a stop, page or room from any active state, and nowhere else', () => {
    const active: AppState[] = [
      { kind: 'flying' },
      { kind: 'nav', selected: 'work' },
      { kind: 'autopilot', target: 'work', phase: 'cruise' },
      { kind: 'briefing', stop: 'study', page: 1, pageCount: 2 },
      { kind: 'chat', stop: 'talk' },
      { kind: 'room', stop: 'projects', panel: 2, pageCount: 4 },
    ];
    for (const s of active) {
      expect(run(s, { type: 'JUMP', stop: 'projects', page: 1 })).toEqual({ kind: 'briefing', stop: 'projects', page: 1, pageCount: 4 });
      expect(run(s, { type: 'JUMP', stop: 'talk' })).toEqual({ kind: 'chat', stop: 'talk' });
      expect(run(s, { type: 'JUMP', stop: 'projects', room: true })).toEqual({ kind: 'room', stop: 'projects', panel: null, pageCount: 4 });
    }
    const title: AppState = { kind: 'title' };
    expect(run(title, { type: 'JUMP', stop: 'projects' })).toBe(title);
    const paused: AppState = { kind: 'paused', reason: 'menu', resumeTo: { kind: 'flying' } };
    expect(run(paused, { type: 'JUMP', stop: 'projects' })).toBe(paused);
    // Jumping to where you already are changes nothing (same object, so no re-render).
    const here: AppState = { kind: 'briefing', stop: 'projects', page: 0, pageCount: 4 };
    expect(run(here, { type: 'JUMP', stop: 'projects' })).toBe(here);
    expect(run(here, { type: 'JUMP', stop: 'projects', page: 0 })).toBe(here);
  });

  it('a WebGL context that never comes back ends on the error screen from any state', () => {
    const from: AppState[] = [
      { kind: 'title' },
      { kind: 'flying' },
      { kind: 'briefing', stop: 'projects', page: 1, pageCount: 4 },
      { kind: 'room', stop: 'projects', panel: null, pageCount: 4 },
      { kind: 'paused', reason: 'menu', resumeTo: { kind: 'flying' } },
    ];
    for (const s of from) expect(run(s, { type: 'CONTEXT_LOST' })).toEqual({ kind: 'error', reason: 'context' });
    expect(run({ kind: 'error', reason: 'webgl' }, { type: 'CONTEXT_LOST' })).toEqual({ kind: 'error', reason: 'webgl' });
  });

  it('errors are terminal', () => {
    const s = run({ kind: 'title' }, { type: 'NO_WEBGL' }, { type: 'FLY' });
    expect(s).toEqual({ kind: 'error', reason: 'webgl' });
    expect(run({ kind: 'loading', intent: { mode: 'fly' } }, { type: 'LOAD_FAILED', message: 'x' })).toMatchObject({ kind: 'error', reason: 'load' });
  });

  it('knows when the simulation runs', () => {
    expect(simulationRunning({ kind: 'flying' })).toBe(true);
    expect(simulationRunning({ kind: 'nav', selected: null })).toBe(false);
    expect(simulationRunning({ kind: 'briefing', stop: 'work', page: 0, pageCount: 1 })).toBe(true);
  });
  it('a chat stop opens the chat, from every way of arriving', () => {
    expect(run({ kind: 'title' }, { type: 'GO_TO_STOP', stop: 'talk' }, { type: 'LOADED' })).toEqual({ kind: 'chat', stop: 'talk' });
    expect(run({ kind: 'flying' }, { type: 'OPEN_BRIEFING', stop: 'talk' })).toEqual({ kind: 'chat', stop: 'talk' });
    expect(run({ kind: 'autopilot', target: 'talk', phase: 'arrive' }, { type: 'ARRIVED' })).toEqual({ kind: 'chat', stop: 'talk' });
    expect(run({ kind: 'briefing', stop: 'work', page: 1, pageCount: 2 }, { type: 'OPEN_BRIEFING', stop: 'talk' })).toEqual({ kind: 'chat', stop: 'talk' });
  });

  it('chat closes, pauses, opens the map and flies on', () => {
    const chat: AppState = { kind: 'chat', stop: 'talk' };
    expect(run(chat, { type: 'CLOSE_CHAT' })).toEqual({ kind: 'flying' });
    expect(run(chat, { type: 'BACK' })).toEqual({ kind: 'flying' });
    expect(run(chat, { type: 'OPEN_NAV' })).toEqual({ kind: 'nav', selected: 'talk' });
    expect(run(chat, { type: 'GO_TO_STOP', stop: 'work' })).toEqual({ kind: 'autopilot', target: 'work', phase: 'climb' });
    expect(run(chat, { type: 'GO_TO_STOP', stop: 'talk' })).toBe(chat);
    expect(run(chat, { type: 'PAGE', delta: 1 })).toBe(chat);
    const paused = run(chat, { type: 'PAUSE', reason: 'hidden' });
    expect(paused).toEqual({ kind: 'paused', reason: 'hidden', resumeTo: chat });
    expect(run(paused, { type: 'RESUME' })).toEqual(chat);
    expect(simulationRunning(chat)).toBe(true);
  });
  it('lands on a room from flying or its briefing, and only where there is one', () => {
    const r = { kind: 'room', stop: 'projects', panel: null, pageCount: 4 };
    expect(run({ kind: 'flying' }, { type: 'ENTER_ROOM', stop: 'projects' })).toEqual(r);
    expect(run({ kind: 'briefing', stop: 'projects', page: 2, pageCount: 4 }, { type: 'ENTER_ROOM', stop: 'projects' })).toEqual(r);
    const f: AppState = { kind: 'flying' };
    expect(run(f, { type: 'ENTER_ROOM', stop: 'work' })).toBe(f);
  });

  it('opens screens as panels, pages them, closes them, then leaves', () => {
    let s: AppState = { kind: 'room', stop: 'projects', panel: null, pageCount: 4 };
    s = run(s, { type: 'ROOM_PANEL', page: 1 });
    expect(s).toMatchObject({ kind: 'room', panel: 1 });
    s = run(s, { type: 'PAGE', delta: 1 });
    expect(s).toMatchObject({ panel: 2 });
    s = run(s, { type: 'PAGE', delta: 9 });
    expect(s).toMatchObject({ panel: 3 });
    s = run(s, { type: 'BACK' });
    expect(s).toMatchObject({ kind: 'room', panel: null });
    expect(simulationRunning(s)).toBe(false);
    const paused = run(s, { type: 'PAUSE', reason: 'hidden' });
    expect(run(paused, { type: 'RESUME' })).toEqual(s);
    expect(run(s, { type: 'OPEN_NAV' })).toEqual({ kind: 'nav', selected: 'projects' });
    expect(run(s, { type: 'BACK' })).toEqual({ kind: 'flying' });
    expect(run(s, { type: 'LEAVE_ROOM' })).toEqual({ kind: 'flying' });
    expect(run({ ...s, panel: 1 } as AppState, { type: 'LEAVE_ROOM' })).toEqual({ kind: 'flying' });
  });
});
