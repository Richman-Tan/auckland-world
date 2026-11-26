/**
 * Module contracts. Frozen after M0: the world (src/world, src/render), flight (src/flight,
 * src/input) and UI (src/ui, src/content) modules are built in parallel against these, and
 * app.ts (M5) wires them together. Change them only through the integrator.
 *
 * Conventions
 *  - World frame: x east, z south (north is -z), y up, metres ASL. See src/shared/mapFormat.ts.
 *  - Heading: radians, 0 = grid north (-z), increasing clockwise (pi/2 = east).
 *    Forward vector = (sin h, 0, -cos h). True heading = grid heading - meta.crs.trueNorthAngleRad.
 *  - Bank: radians, positive = right wing down. Pitch: radians, positive = nose up.
 *  - Fixed simulation step: 1/60 s.
 *  - Keyboard: only src/input listens to keys. UI components handle pointer clicks and dispatch
 *    AppEvents; keys reach the UI as InputActions routed by app.ts.
 */
import type { Camera, Object3D, PerspectiveCamera, WebGLRenderer } from 'three';
import type { SiteContent, StopId } from '../content/types';
import type { SharedUniforms } from '../render/uniforms';
import type { MapMeta } from '../shared/mapFormat';
import type { WorldQuery } from '../shared/collision';
import type { PaletteKey } from '../shared/palette';
import type { Look } from '../shared/timeOfDay';
import type { AppEvent, AppState, AutopilotPhase } from './fsm';
import type { ProgressView } from './progress';
import type { SettingsStore } from './settings';

export type { ProgressView } from './progress';
export type { WorldQuery, Collider, CollisionGrid } from '../shared/collision';
export type { AppEvent, AppState, AutopilotPhase } from './fsm';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/* ------------------------------------------------------------------ stops */

/** A stop resolved into world coordinates (src/app/placement.ts). */
export interface StopPlacement {
  id: StopId;
  hotkey: number;
  label: string;
  place: string;
  color: PaletteKey;
  icon: 'code' | 'briefcase' | 'cap' | 'chat' | 'peak';
  x: number;
  z: number;
  /** Ground (or water) height under the beacon. */
  groundY: number;
  /** Base of the light column (the point the plane is flying "to"). */
  baseY: number;
  triggerRadius: number;
  orbitRadius: number;
  /** Altitude (m ASL) of the holding orbit. */
  orbitY: number;
}

/* ----------------------------------------------------------------- flight */

export interface Controls {
  /** -1 = left, +1 = right. */
  turn: number;
  /** -1 = nose down, +1 = nose up. */
  pitch: number;
  boost: boolean;
}

export const NO_CONTROLS: Controls = { turn: 0, pitch: 0, boost: false };

export interface FlightState {
  pos: Vec3;
  heading: number;
  pitch: number;
  bank: number;
  /** Airspeed, m/s. */
  speed: number;
  /** Vertical speed, m/s. */
  vy: number;
  /** Boost reserve, 0..1. */
  boost: number;
  boosting: boolean;
}

export interface FlightStepResult {
  collided: boolean;
  /** Name of what was hit (a collider name, "building", "ground", "water"), when collided. */
  hit?: string;
  respawned: boolean;
  pullUp: boolean;
  /** Outside the world bounds and being turned back. */
  outOfBounds: boolean;
}

/** src/flight/flightModel.ts */
export interface FlightSim {
  readonly state: FlightState;
  reset(spawn: { pos: Vec3; heading: number; speed?: number }): void;
  /** Advance one fixed step of `dt` seconds (normally 1/60). */
  step(dt: number, controls: Controls, world: WorldQuery): FlightStepResult;
}

export interface AutopilotStatus {
  phase: AutopilotPhase;
  /** Time-warp factor to apply this frame (simulation steps per real step), >= 1. */
  warp: number;
  /** Estimated real seconds to arrival, after warp. */
  etaS: number;
  /** 0..1 along the route. */
  progress: number;
  arrived: boolean;
}

/** src/flight/autopilot.ts: produces the same Controls a player would; never teleports. */
export interface Autopilot {
  readonly target: StopPlacement;
  /** Controls for the next step, given the current flight state. */
  update(state: FlightState, world: WorldQuery): Controls;
  status(): AutopilotStatus;
}

/** Holding orbit used while a briefing is open. */
export interface OrbitController {
  update(state: FlightState, world: WorldQuery): Controls;
}

export interface ProximityUpdate {
  /** Stop the plane is currently within the trigger radius of (with hysteresis). */
  current: StopId | null;
  entered: StopId | null;
  exited: StopId | null;
}

/** src/flight/proximity.ts */
export interface Proximity {
  update(pos: Vec3): ProximityUpdate;
}

/** src/flight/camera.ts */
export interface ChaseCamera {
  readonly camera: PerspectiveCamera;
  /** dt is real seconds; warp lets the spring keep up during time warp. */
  update(dt: number, state: FlightState, world: WorldQuery, warp: number): void;
  /** Snap behind the plane (after spawn/teleport). */
  snap(state: FlightState): void;
  setAspect(aspect: number): void;
  /** How much the view rolls with the bank: 1 is normal, 0 keeps the horizon level (reduced motion). */
  setRollScale(scale: number): void;
}

/** src/flight/plane.ts */
export interface PlaneModel {
  readonly object: Object3D;
  /**
   * Pose the model from the (interpolated) flight state; `time` (seconds, the frame clock) turns the
   * propeller, eases the control surfaces and flashes the lights. Also places the plane's shadow,
   * and removes it when the model is hidden, so call it after setting `object.visible`.
   */
  update(state: FlightState, time: number): void;
}

/* ------------------------------------------------------------------ input */

export type InputAction =
  | 'nav' // Tab / M
  | 'back' // Esc
  | 'briefing' // Space
  | 'interact' // E (Phase 2: land)
  | 'engage' // Enter
  | 'next' // ArrowRight / D in dialogs
  | 'prev' // ArrowLeft / A in dialogs
  | 'help' // H
  | 'nextStop' // N in a briefing: fly on to the next stop not yet seen
  | 'menu' // the pause menu, from anywhere (touch MENU button, gamepad Start); Esc gets there by backing out
  | 'select1'
  | 'select2'
  | 'select3'
  | 'select4'
  | 'select5'
  | 'select6'
  | 'select7'
  | 'select8'
  | 'select9';

/** src/input/index.ts */
export interface InputSystem {
  /** Current flight controls (keyboard + mouse drag + touch joystick, combined). */
  controls(): Controls;
  /** True if the player is touching any flight control right now (cancels autopilot). */
  hasFlightInput(): boolean;
  onAction(cb: (action: InputAction) => void): () => void;
  /** 'flight' lets WASD/arrows steer; 'dialog' turns arrows into next/prev and stops steering; 'chat' only listens for Esc. */
  setMode(mode: 'flight' | 'dialog' | 'chat' | 'off'): void;
  /** Read a connected gamepad. Call once per frame, before controls(). */
  poll(): void;
  setInvertPitch(on: boolean): void;
  dispose(): void;
}

/* ------------------------------------------------------------------ world */

export interface WorldStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  internalWidth: number;
  internalHeight: number;
  pixelScale: number;
}

/** The tier decides what is loaded; WorldDetail is adjustable every frame (src/shared/detail.ts). */
export type { QualityTier, WorldDetail } from '../shared/detail';
import type { QualityTier, WorldDetail } from '../shared/detail';

export interface LoadProgress {
  loadedBytes: number;
  totalBytes: number;
  label: string;
  /**
   * Which part of the load this is: fetching the map files (the bytes above count these), building
   * the city's geometry from them, then compiling its shaders. Absent means fetching.
   */
  stage?: 'fetch' | 'build' | 'compile';
}

/** src/world/index.ts: everything in the 3D scene except the plane and the camera. */
export interface WorldScene {
  readonly meta: MapMeta;
  readonly query: WorldQuery;
  readonly renderer: WebGLRenderer;
  /**
   * The light everything in the world shares (sun or moon, fog, the hour). The plane is drawn with
   * it and writes its own position into it, so the world can draw the plane's shadow.
   */
  readonly lighting: SharedUniforms;
  /** Add an object (the plane) to the scene. */
  add(object: Object3D): void;
  setStops(stops: StopPlacement[]): void;
  /** Highlight the active/selected stop's beacon. */
  setActiveStop(id: StopId | null): void;
  /** Show the Sky Deck interior (and hide the beacons) while visiting it. */
  setInterior(on: boolean): void;
  /** Per-frame animation (water, beacons, lights). */
  update(dt: number, time: number, camera: Camera): void;
  render(camera: Camera): void;
  /** Call on window resize; returns the internal (low-res) size. */
  resize(cssWidth: number, cssHeight: number): { width: number; height: number };
  /**
   * Hide beacon icons left of this x (clip space, -1 = left edge of the view, 1 = right), or show
   * them all with null. Used behind the title card, where an icon would sit on top of the text.
   */
  setIconClip(left: number | null): void;
  /** Sky, light, fog and water colours for the time of day (src/shared/timeOfDay.ts). */
  setLook(look: Look): void;
  /** Change draw distance and render resolution on the fly (the frame-rate governor, or a pinned setting). */
  setDetail(d: WorldDetail): void;
  /** The browser took the WebGL context away (true) or gave it back (false). Rendering pauses in between. */
  onContextChange(cb: (lost: boolean) => void): void;
  stats(): WorldStats;
  dispose(): void;
}

export interface LoadWorldOptions {
  canvas: HTMLCanvasElement;
  /** '/map/' or '/map-fake/' (with trailing slash). */
  baseUrl: string;
  quality: QualityTier;
  onProgress?: (p: LoadProgress) => void;
}

/** Signature of src/world/index.ts `loadWorld`. */
export type LoadWorld = (opts: LoadWorldOptions) => Promise<WorldScene>;

/* --------------------------------------------------------------------- UI */

export interface TargetInfo {
  id: StopId;
  label: string;
  distanceM: number;
  /** True bearing to the target, degrees 0..360. */
  bearingDeg: number;
  /** Target bearing relative to the nose, degrees -180..180 (positive = right). */
  relativeDeg: number;
  /** Whether the beacon is on screen (for the off-screen arrow). */
  onScreen: boolean;
  /** Screen position of the beacon in CSS px, when on screen. */
  screen?: { x: number; y: number };
}

export interface Telemetry {
  speedKmh: number;
  altitudeAsl: number;
  heightAboveGround: number;
  /** True heading, degrees 0..360. */
  headingDeg: number;
  boost: number;
  boosting: boolean;
  pullUp: boolean;
  /** Nearest suburb/place name, e.g. "PONSONBY". */
  place: string | null;
  target: TargetInfo | null;
  warp: number;
  autopilot: AutopilotStatus | null;
  /** For the radar and nav map. */
  plane: { x: number; z: number; headingRad: number };
}

export interface PromptAction {
  action: InputAction;
  key: string;
  label: string;
}

export interface PromptInfo {
  stop: StopId;
  label: string;
  place: string;
  actions: PromptAction[];
}

/** src/ui/index.ts `createUi` returns this. The UI renders from state; it never mutates app state. */
export interface UiApi {
  /** Show/hide title, loading, nav, briefing, warp, pause and error views for this state. */
  sync(state: AppState): void;
  setLoading(p: LoadProgress): void;
  /** The world could not be loaded: the title's loader says so instead of sitting part-way for ever. */
  setLoadFailed(): void;
  /** Throttle internally; called every frame. */
  updateTelemetry(t: Telemetry): void;
  toast(text: string, kind?: 'info' | 'warn'): void;
  /** A message that stays up in every view until cleared with null (e.g. while the 3D view recovers). */
  setNotice(text: string | null): void;
  setPrompt(p: PromptInfo | null): void;
  /** What the walker in a room is facing, for the "use" prompt (null hides it). */
  setRoomSpot(s: { id: string; action: string } | null): void;
  /** Screen area (CSS px) the open briefing or chat covers: docked right, or a bottom sheet. */
  obstruction(): { right: number; bottom: number } | null;
  /** Return keyboard focus to the scene after a dialog closes. */
  focusScene(): void;
  /** Called once the map has loaded: enables the minimap, radar and nav overlay. */
  setWorld(world: UiWorld): void;
  /**
   * The live city has been drawn at least once: let the boot scene give way to it. Resolves when
   * the hand-over is finished. Until this is called the boot scene covers the 3D view.
   */
  reveal(): Promise<void>;
  /** The line beside the place name on the title screen: the time in Auckland and the part of the day, or null. */
  setClock(text: string | null): void;
  /** Which stops have been seen: ticks on the title and map, and the "next stop" button. */
  setProgress(p: ProgressView): void;
  /** Cut through black (a jump to another stop without flying there). */
  flash(): void;
  /** Right edge (CSS px) of the title screen's text block while it is showing, else null. */
  titleRight(): number | null;
  /** Where "Read it as a page" on the error screen leads, e.g. /page/#projects-wie-academy for a link to that page. */
  setPageHref(href: string): void;
}

export interface UiWorld {
  meta: MapMeta;
  stops: StopPlacement[];
  /** URL of minimap.webp (covers meta.bounds exactly, north up). */
  minimapUrl: string;
}

/** The UI exists from first paint (title screen), before the map has loaded. */
export interface CreateUiOptions {
  root: HTMLElement;
  content: SiteContent;
  dispatch: (e: AppEvent) => void;
  /** Visitor settings, shown in the pause menu. Optional so harnesses can leave it out. */
  settings?: SettingsStore;
}

export type CreateUi = (opts: CreateUiOptions) => UiApi;
