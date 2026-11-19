/**
 * The app's state machine. Pure: transition(state, event, ctx) -> next state (or the same object
 * when the event does not apply). Side effects live in app.ts, which reacts to state changes.
 * Stops with a live chat open { kind: 'chat' } where others open a briefing. Stops with a room can
 * be landed on ({ kind: 'room' }), where screens open that stop's briefing pages as a panel.
 */
import type { StopId } from '../content/types';

export type AutopilotPhase = 'climb' | 'cruise' | 'descend' | 'arrive';

export type LoadIntent = { mode: 'fly' } | { mode: 'stop'; stop: StopId };

export type AppState =
  | { kind: 'title' }
  | { kind: 'loading'; intent: LoadIntent }
  | { kind: 'flying' }
  /** Destinations overlay. The simulation is paused while it is open. */
  | { kind: 'nav'; selected: StopId | null }
  | { kind: 'autopilot'; target: StopId; phase: AutopilotPhase }
  /** Reading a stop's briefing; the plane holds an orbit around the beacon. */
  | { kind: 'briefing'; stop: StopId; page: number; pageCount: number }
  /** Talking to the avatar at a chat stop; the plane holds an orbit like a briefing. */
  | { kind: 'chat'; stop: StopId }
  /** Walking around a stop's room; panel is the briefing page open over it, if any. The plane waits outside. */
  | { kind: 'room'; stop: StopId; panel: number | null; pageCount: number }
  | { kind: 'paused'; reason: 'menu' | 'hidden'; resumeTo: ActiveState }
  /** webgl: no 3D support. load: the map failed to load. context: the browser dropped the 3D view and never gave it back. */
  | { kind: 'error'; reason: 'webgl' | 'load' | 'context'; message?: string };

export type ActiveState = Extract<AppState, { kind: 'flying' | 'nav' | 'autopilot' | 'briefing' | 'chat' | 'room' }>;

export type AppEvent =
  | { type: 'FLY' }
  | { type: 'GO_TO_STOP'; stop: StopId }
  | { type: 'LOADED' }
  | { type: 'LOAD_FAILED'; message?: string }
  | { type: 'NO_WEBGL' }
  /** The WebGL context was lost and did not come back. */
  | { type: 'CONTEXT_LOST' }
  | { type: 'OPEN_NAV' }
  | { type: 'CLOSE_NAV' }
  | { type: 'NAV_SELECT'; stop: StopId }
  /** Engage autopilot to the given stop, or to the nav selection. */
  | { type: 'ENGAGE'; stop?: StopId }
  | { type: 'AUTOPILOT_PHASE'; phase: AutopilotPhase }
  | { type: 'ARRIVED' }
  /** Any manual flight input during autopilot. */
  | { type: 'CANCEL_AUTOPILOT' }
  | { type: 'OPEN_BRIEFING'; stop: StopId }
  | { type: 'PAGE'; delta: number }
  | { type: 'PAGE_SET'; page: number }
  | { type: 'CLOSE_BRIEFING' }
  | { type: 'CLOSE_CHAT' }
  /** Land on a stop's room (from flying near it, or from its briefing). */
  | { type: 'ENTER_ROOM'; stop: StopId }
  | { type: 'LEAVE_ROOM' }
  /** Open a briefing page over the room (walking up to a screen). */
  | { type: 'ROOM_PANEL'; page: number }
  /** Use whatever the walker is facing (tap on the room prompt); handled by the app, not the FSM. */
  | { type: 'ROOM_USE' }
  /** Esc: close whatever is on top, or open the pause menu while flying. */
  | { type: 'BACK' }
  | { type: 'PAUSE'; reason: 'menu' | 'hidden' }
  | { type: 'RESUME' };

export interface FsmContext {
  /** Number of briefing pages for a stop (>= 1). */
  pageCount(stop: StopId): number;
  /** True when the stop opens a chat instead of its briefing. */
  hasChat(stop: StopId): boolean;
  /** True when the stop has a room you can land on. */
  hasRoom(stop: StopId): boolean;
}

function room(stop: StopId, ctx: FsmContext): AppState {
  return { kind: 'room', stop, panel: null, pageCount: Math.max(1, ctx.pageCount(stop)) };
}

/** What arriving at a stop opens: its chat if it has one, else page 0 of its briefing. */
function arrive(stop: StopId, ctx: FsmContext): AppState {
  if (ctx.hasChat(stop)) return { kind: 'chat', stop };
  const pageCount = Math.max(1, ctx.pageCount(stop));
  return { kind: 'briefing', stop, page: 0, pageCount };
}

function isActive(s: AppState): s is ActiveState {
  return s.kind === 'flying' || s.kind === 'nav' || s.kind === 'autopilot' || s.kind === 'briefing' || s.kind === 'chat' || s.kind === 'room';
}

export function transition(state: AppState, event: AppEvent, ctx: FsmContext): AppState {
  // Errors are terminal; the error screen offers the read-as-page link instead.
  if (state.kind === 'error') return state;
  if (event.type === 'NO_WEBGL') return { kind: 'error', reason: 'webgl' };
  if (event.type === 'CONTEXT_LOST') return { kind: 'error', reason: 'context' };

  if (event.type === 'PAUSE') {
    if (!isActive(state)) return state;
    return { kind: 'paused', reason: event.reason, resumeTo: state };
  }

  switch (state.kind) {
    case 'title':
      if (event.type === 'FLY') return { kind: 'loading', intent: { mode: 'fly' } };
      if (event.type === 'GO_TO_STOP') return { kind: 'loading', intent: { mode: 'stop', stop: event.stop } };
      return state;

    case 'loading':
      if (event.type === 'LOADED') {
        return state.intent.mode === 'stop' ? arrive(state.intent.stop, ctx) : { kind: 'flying' };
      }
      if (event.type === 'LOAD_FAILED') return { kind: 'error', reason: 'load', message: event.message };
      return state;

    case 'flying':
      switch (event.type) {
        case 'OPEN_NAV':
          return { kind: 'nav', selected: null };
        case 'OPEN_BRIEFING':
        case 'GO_TO_STOP':
          return arrive(event.stop, ctx);
        case 'ENTER_ROOM':
          return ctx.hasRoom(event.stop) ? room(event.stop, ctx) : state;
        case 'ENGAGE':
          return event.stop ? { kind: 'autopilot', target: event.stop, phase: 'climb' } : state;
        case 'BACK':
          return { kind: 'paused', reason: 'menu', resumeTo: state };
        default:
          return state;
      }

    case 'nav':
      switch (event.type) {
        case 'NAV_SELECT':
          return { kind: 'nav', selected: event.stop };
        case 'ENGAGE': {
          const target = event.stop ?? state.selected;
          return target ? { kind: 'autopilot', target, phase: 'climb' } : state;
        }
        case 'GO_TO_STOP':
          return { kind: 'autopilot', target: event.stop, phase: 'climb' };
        case 'CLOSE_NAV':
        case 'OPEN_NAV': // M toggles
        case 'BACK':
          return { kind: 'flying' };
        default:
          return state;
      }

    case 'autopilot':
      switch (event.type) {
        case 'AUTOPILOT_PHASE':
          return event.phase === state.phase ? state : { ...state, phase: event.phase };
        case 'ARRIVED':
          return arrive(state.target, ctx);
        case 'CANCEL_AUTOPILOT':
        case 'BACK':
          return { kind: 'flying' };
        case 'OPEN_NAV':
          return { kind: 'nav', selected: state.target };
        case 'ENGAGE':
          return event.stop && event.stop !== state.target
            ? { kind: 'autopilot', target: event.stop, phase: 'climb' }
            : state;
        default:
          return state;
      }

    case 'briefing':
      switch (event.type) {
        case 'PAGE': {
          const page = Math.min(Math.max(state.page + event.delta, 0), state.pageCount - 1);
          return page === state.page ? state : { ...state, page };
        }
        case 'PAGE_SET': {
          const page = Math.min(Math.max(event.page, 0), state.pageCount - 1);
          return page === state.page ? state : { ...state, page };
        }
        case 'OPEN_BRIEFING':
          return event.stop === state.stop ? state : arrive(event.stop, ctx);
        case 'ENTER_ROOM':
          return event.stop === state.stop && ctx.hasRoom(event.stop) ? room(event.stop, ctx) : state;
        case 'CLOSE_BRIEFING':
        case 'BACK':
          return { kind: 'flying' };
        case 'OPEN_NAV':
          return { kind: 'nav', selected: state.stop };
        case 'ENGAGE':
          return event.stop && event.stop !== state.stop
            ? { kind: 'autopilot', target: event.stop, phase: 'climb' }
            : state;
        case 'GO_TO_STOP':
          return event.stop === state.stop ? state : { kind: 'autopilot', target: event.stop, phase: 'climb' };
        default:
          return state;
      }

    case 'chat':
      switch (event.type) {
        case 'CLOSE_CHAT':
        case 'BACK':
          return { kind: 'flying' };
        case 'OPEN_BRIEFING':
          return event.stop === state.stop ? state : arrive(event.stop, ctx);
        case 'OPEN_NAV':
          return { kind: 'nav', selected: state.stop };
        case 'ENGAGE':
        case 'GO_TO_STOP':
          return event.stop && event.stop !== state.stop
            ? { kind: 'autopilot', target: event.stop, phase: 'climb' }
            : state;
        default:
          return state;
      }

    case 'room':
      if (state.panel !== null) {
        switch (event.type) {
          case 'CLOSE_BRIEFING':
          case 'BACK':
            return { ...state, panel: null };
          case 'PAGE': {
            const page = Math.min(Math.max(state.panel + event.delta, 0), state.pageCount - 1);
            return page === state.panel ? state : { ...state, panel: page };
          }
          case 'PAGE_SET':
          case 'ROOM_PANEL': {
            const page = Math.min(Math.max(event.page, 0), state.pageCount - 1);
            return page === state.panel ? state : { ...state, panel: page };
          }
          default:
            break;
        }
      }
      switch (event.type) {
        case 'ROOM_PANEL':
          return { ...state, panel: Math.min(Math.max(event.page, 0), state.pageCount - 1) };
        case 'LEAVE_ROOM':
        case 'BACK':
          return { kind: 'flying' };
        case 'OPEN_NAV':
          return { kind: 'nav', selected: state.stop };
        case 'ENGAGE':
        case 'GO_TO_STOP':
          return event.stop && event.stop !== state.stop
            ? { kind: 'autopilot', target: event.stop, phase: 'climb' }
            : state;
        default:
          return state;
      }

    case 'paused':
      if (event.type === 'RESUME') return state.resumeTo;
      if (event.type === 'BACK' && state.reason === 'menu') return state.resumeTo;
      return state;
  }
}

/** Is the flight simulation stepping in this state? */
export function simulationRunning(s: AppState): boolean {
  return s.kind === 'flying' || s.kind === 'autopilot' || s.kind === 'briefing' || s.kind === 'chat';
}
