import { describe, expect, it } from 'vitest';
import type { AppState } from '../src/app/fsm';
import { NO_ROUTE, liveRoomId, pageHref, pageIndex, parseRoute, routeOf, routeTitle, samePlace, sameRoute, searchFor } from '../src/app/route';
import { content } from '../src/content/index';

const projects = content.stops.find((s) => s.id === 'projects')!;

describe('route', () => {
  it('every stop and every page of it survives a round trip through the address bar', () => {
    for (const stop of content.stops) {
      const hasChat = stop.experiences.some((x) => x.kind === 'chat' && x.status === 'live');
      for (let i = 0; i < stop.briefing.length; i++) {
        const state: AppState = hasChat ? { kind: 'chat', stop: stop.id } : { kind: 'briefing', stop: stop.id, page: i, pageCount: stop.briefing.length };
        const route = routeOf(state, content)!;
        const back = parseRoute(searchFor(route, ''), content);
        expect(back).toEqual(route);
        expect(back.stop).toBe(stop.id);
        if (!hasChat) expect(Math.max(0, pageIndex(content, stop.id, back.page))).toBe(i);
      }
    }
  });

  it('the first page is the stop itself, so the common link stays short', () => {
    const r = routeOf({ kind: 'briefing', stop: 'projects', page: 0, pageCount: projects.briefing.length }, content)!;
    expect(searchFor(r, '')).toBe('?stop=projects');
    expect(parseRoute(`?stop=projects&page=${projects.briefing[0].id}`, content)).toEqual(r);
    const second = routeOf({ kind: 'briefing', stop: 'projects', page: 1, pageCount: projects.briefing.length }, content)!;
    expect(searchFor(second, '')).toBe(`?stop=projects&page=${projects.briefing[1].id}`);
  });

  it('the room has its own address, with or without a screen page open', () => {
    const room = liveRoomId(content, 'projects');
    expect(room).toBe('skydeck');
    const walking = routeOf({ kind: 'room', stop: 'projects', panel: null, pageCount: projects.briefing.length }, content)!;
    expect(searchFor(walking, '')).toBe('?stop=projects&room=skydeck');
    expect(parseRoute('?stop=projects&room=skydeck', content)).toEqual(walking);
    // In a room page 0 open is not the same as no page open.
    const reading = routeOf({ kind: 'room', stop: 'projects', panel: 0, pageCount: projects.briefing.length }, content)!;
    expect(reading.page).toBe(projects.briefing[0].id);
    expect(parseRoute(searchFor(reading, ''), content)).toEqual(reading);
    // A stop whose room is not built yet has no room address.
    expect(liveRoomId(content, 'work')).toBeNull();
    expect(parseRoute('?stop=work&room=office', content)).toEqual({ stop: 'work', page: null, room: null });
  });

  it('flying, the map and autopilot are the bare address; title, loading and errors leave it alone', () => {
    for (const s of [{ kind: 'flying' }, { kind: 'nav', selected: null }, { kind: 'autopilot', target: 'work', phase: 'climb' }] as AppState[]) {
      expect(routeOf(s, content)).toEqual(NO_ROUTE);
    }
    for (const s of [{ kind: 'title' }, { kind: 'loading', intent: { mode: 'fly' } }, { kind: 'error', reason: 'load' }] as AppState[]) {
      expect(routeOf(s, content)).toBeNull();
    }
    const under: AppState = { kind: 'chat', stop: 'talk' };
    expect(routeOf({ kind: 'paused', reason: 'menu', resumeTo: under }, content)).toEqual(routeOf(under, content));
  });

  it('unknown stops, pages and rooms are dropped, never guessed', () => {
    expect(parseRoute('?stop=nowhere&page=x', content)).toEqual(NO_ROUTE);
    expect(parseRoute('', content)).toEqual(NO_ROUTE);
    expect(parseRoute('?page=wie-academy', content)).toEqual(NO_ROUTE);
    expect(parseRoute('?stop=projects&page=<script>', content)).toEqual({ stop: 'projects', page: null, room: null });
    expect(parseRoute('?stop=study&page=wie-academy', content)).toEqual({ stop: 'study', page: null, room: null });
  });

  it('other parameters pass through untouched, bare flags included', () => {
    const r = { stop: 'projects' as const, page: 'wie-academy', room: null };
    expect(searchFor(r, '?map=fake&debug&quality=low')).toBe('?map=fake&debug&quality=low&stop=projects&page=wie-academy');
    expect(searchFor(NO_ROUTE, '?map=fake&debug&stop=work&page=sandfield&room=x')).toBe('?map=fake&debug');
    expect(searchFor(NO_ROUTE, '?stop=work')).toBe('');
    expect(searchFor(r, '?stop=work&time=22')).toBe('?time=22&stop=projects&page=wie-academy');
  });

  it('tells a page turn from a move', () => {
    const a = { stop: 'projects' as const, page: null, room: null };
    const b = { stop: 'projects' as const, page: 'wie-academy', room: null };
    const c = { stop: 'projects' as const, page: null, room: 'skydeck' };
    expect(samePlace(a, b)).toBe(true);
    expect(sameRoute(a, b)).toBe(false);
    expect(samePlace(a, c)).toBe(false);
    expect(samePlace(a, NO_ROUTE)).toBe(false);
    expect(sameRoute(a, { ...a })).toBe(true);
    expect(sameRoute(a, null)).toBe(false);
  });

  it('links to the same spot on the plain page, and names the tab after the open page', () => {
    expect(pageHref(NO_ROUTE)).toBe('/page/');
    expect(pageHref({ stop: 'work', page: null, room: null })).toBe('/page/#work');
    expect(pageHref({ stop: 'projects', page: 'wie-academy', room: null })).toBe('/page/#projects-wie-academy');
    const base = 'Richman Tan · over Auckland';
    expect(routeTitle(NO_ROUTE, content, base)).toBe(base);
    expect(routeTitle(null, content, base)).toBe(base);
    expect(routeTitle({ stop: 'offclock', page: null, room: null }, content, base)).toBe('Off the clock · Richman Tan');
    const wie = projects.briefing.find((p) => p.id === 'wie-academy')!;
    expect(routeTitle({ stop: 'projects', page: 'wie-academy', room: null }, content, base)).toBe(`${wie.title} · Richman Tan`);
  });
});
