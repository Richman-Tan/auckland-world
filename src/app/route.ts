/**
 * The address bar as a view of the app state, so a stop, one of its pages or its room can be linked
 * to and the browser's Back button works. Pure: the history calls live in app.ts.
 *
 *   /?stop=projects                      the Projects briefing, first page
 *   /?stop=projects&page=wie-academy     one page of it
 *   /?stop=projects&room=skydeck         inside the Sky Deck (add &page= for a screen's page)
 *   /?stop=talk                          the chat
 *
 * Other parameters (map, debug, quality, time) pass through untouched.
 */
import type { SiteContent, StopId } from '../content/types';
import type { AppState } from './fsm';

export interface Route {
  stop: StopId | null;
  /** A briefing page id. Null means the first page (or no page open, in a room). */
  page: string | null;
  /** The room's id when inside it. */
  room: string | null;
}

export const NO_ROUTE: Route = { stop: null, page: null, room: null };

const ROUTE_PARAMS = ['stop', 'page', 'room'] as const;

function stopOf(content: SiteContent, id: string | null) {
  return id ? (content.stops.find((s) => s.id === id) ?? null) : null;
}

/** The id of a stop's live room, or null. */
export function liveRoomId(content: SiteContent, stop: StopId): string | null {
  for (const x of stopOf(content, stop)?.experiences ?? []) {
    if (x.kind === 'room' && x.status === 'live') return x.roomId;
  }
  return null;
}

/** Index of a page within a stop's briefing, or -1. */
export function pageIndex(content: SiteContent, stop: StopId, pageId: string | null): number {
  if (!pageId) return -1;
  return stopOf(content, stop)?.briefing.findIndex((p) => p.id === pageId) ?? -1;
}

function pageId(content: SiteContent, stop: StopId, index: number): string | null {
  return stopOf(content, stop)?.briefing[index]?.id ?? null;
}

/**
 * The route a state stands for. Null means "leave the address alone": the title, loading and error
 * screens keep whatever link the visitor arrived on.
 */
export function routeOf(state: AppState, content: SiteContent): Route | null {
  switch (state.kind) {
    case 'title':
    case 'loading':
    case 'error':
      return null;
    case 'paused':
      return routeOf(state.resumeTo, content);
    case 'briefing':
      // The first page is the stop's own address, so the common link stays short.
      return { stop: state.stop, page: state.page > 0 ? pageId(content, state.stop, state.page) : null, room: null };
    case 'chat':
      return { stop: state.stop, page: null, room: null };
    case 'room':
      return {
        stop: state.stop,
        page: state.panel === null ? null : pageId(content, state.stop, state.panel),
        room: liveRoomId(content, state.stop) ?? 'room',
      };
    default:
      return NO_ROUTE;
  }
}

/** Read a route from a query string. Anything unknown is dropped, never guessed. */
export function parseRoute(search: string, content: SiteContent): Route {
  const q = new URLSearchParams(search);
  const stop = stopOf(content, q.get('stop'));
  if (!stop) return NO_ROUTE;
  const page = pageIndex(content, stop.id, q.get('page')) >= 0 ? q.get('page') : null;
  const room = q.has('room') ? liveRoomId(content, stop.id) : null;
  // In a briefing the first page and "no page" are the same place; keep one spelling of it.
  const first = !room && page === stop.briefing[0]?.id;
  return { stop: stop.id, page: first ? null : page, room };
}

/** The query string for a route ('' or '?…'), keeping every parameter that is not part of it. */
export function searchFor(route: Route, search: string): string {
  const q = new URLSearchParams(search);
  for (const k of ROUTE_PARAMS) q.delete(k);
  if (route.stop) {
    q.set('stop', route.stop);
    if (route.room) q.set('room', route.room);
    if (route.page) q.set('page', route.page);
  }
  // URLSearchParams writes a bare flag (?debug) as "debug="; put it back the way it was typed.
  const s = q.toString().replace(/=(?=&|$)/g, '');
  return s ? `?${s}` : '';
}

export function sameRoute(a: Route | null, b: Route | null): boolean {
  return !!a && !!b && a.stop === b.stop && a.page === b.page && a.room === b.room;
}

/** Same stop and same side of the room door: a page turn, not a move. */
export function samePlace(a: Route | null, b: Route | null): boolean {
  return !!a && !!b && a.stop === b.stop && a.room === b.room;
}

/** The plain page's anchor for a route: /page/, /page/#work or /page/#projects-wie-academy. */
export function pageHref(route: Route): string {
  if (!route.stop) return '/page/';
  return `/page/#${route.stop}${route.page ? `-${route.page}` : ''}`;
}

/** Document title for a route, e.g. "WIE Academy · Richman Tan". */
export function routeTitle(route: Route | null, content: SiteContent, base: string): string {
  const stop = route ? stopOf(content, route.stop) : null;
  if (!route || !stop) return base;
  const page = route.page ? stop.briefing[pageIndex(content, stop.id, route.page)] : null;
  const head = page?.title ?? stop.label.charAt(0) + stop.label.slice(1).toLowerCase();
  return `${head} · ${content.profile.name}`;
}
