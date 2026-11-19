/**
 * Sound, synthesised with the Web Audio API: an engine note and wind that follow the airspeed, a
 * quiet room tone on the Sky Deck, and a few short cues. No audio files, so nothing to download or
 * license. This module is only loaded the first time sound is switched on (it is off by default).
 */

/** What the visitor is doing, as far as sound goes. */
export type SoundScene = 'flight' | 'hold' | 'room' | 'silent';

export type Cue = 'arrive' | 'select' | 'page' | 'bump' | 'land';

export interface EngineVoice {
  /** Engine note, Hz. */
  freq: number;
  /** Engine loudness, 0..1 before the master volume. */
  gain: number;
  /** Low-pass cutoff on the engine, Hz: brighter as it works harder. */
  cutoff: number;
  /** Wind loudness, 0..1. */
  wind: number;
}

const MIN_SPEED = 35;
const MAX_SPEED = 130;

/** The engine and wind for an airspeed (m/s). Pure, so it can be tested without an audio device. */
export function engineVoice(speed: number, boosting: boolean): EngineVoice {
  const t = Math.min(Math.max((speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED), 0), 1);
  return {
    freq: 62 + 70 * t + (boosting ? 12 : 0),
    gain: 0.1 + 0.08 * t,
    cutoff: 500 + 1900 * t + (boosting ? 600 : 0),
    wind: 0.02 + 0.12 * t * t,
  };
}

/** How loud each layer is in each scene: [engine, wind]. Holding over a stop, the engine drops back. */
export const SCENE_MIX: Record<SoundScene, readonly [engine: number, wind: number]> = {
  flight: [1, 1],
  hold: [0.4, 0.5],
  room: [0, 1],
  silent: [0, 0],
};

export interface Sound {
  /** Call every frame with the current scene and airspeed. */
  update(scene: SoundScene, speed: number, boosting: boolean): void;
  cue(kind: Cue): void;
  /** Suspend or resume the audio clock (tab hidden and shown again). */
  setActive(on: boolean): void;
  dispose(): void;
}

const MASTER = 0.55;
/** Loudness of the Sky Deck's background hum. */
const ROOM_TONE = 0.05;
/** Seconds for a parameter to ease most of the way to a new value: no zipper noise, no lag you can hear. */
const EASE = 0.09;

/** Returns null where Web Audio is missing; the site is then simply silent. */
export function createSound(): Sound | null {
  const Ctor = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  let ctx: AudioContext;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }

  const master = ctx.createGain();
  master.gain.value = MASTER;
  master.connect(ctx.destination);

  // Engine: two detuned saws and a square an octave down, through a low-pass, with a propeller chop.
  const engineGain = ctx.createGain();
  engineGain.gain.value = 0;
  const engineFilter = ctx.createBiquadFilter();
  engineFilter.type = 'lowpass';
  engineFilter.frequency.value = 600;
  engineFilter.connect(engineGain).connect(master);
  const voices: OscillatorNode[] = [];
  const voice = (type: OscillatorType, ratio: number, level: number) => {
    const o = ctx.createOscillator();
    o.type = type;
    const g = ctx.createGain();
    g.gain.value = level;
    o.connect(g).connect(engineFilter);
    o.start();
    voices.push(o);
    return { o, ratio };
  };
  const parts = [voice('sawtooth', 1, 0.5), voice('sawtooth', 1.012, 0.35), voice('square', 0.5, 0.3)];
  const chop = ctx.createOscillator();
  chop.type = 'sine';
  chop.frequency.value = 24;
  const chopDepth = ctx.createGain();
  chopDepth.gain.value = 0;
  chop.connect(chopDepth).connect(engineGain.gain);
  chop.start();

  // Wind (and the room's air conditioning): looped white noise through a band-pass.
  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const wind = ctx.createBufferSource();
  wind.buffer = noise;
  wind.loop = true;
  const windFilter = ctx.createBiquadFilter();
  windFilter.type = 'bandpass';
  windFilter.Q.value = 0.6;
  const windGain = ctx.createGain();
  windGain.gain.value = 0;
  wind.connect(windFilter).connect(windGain).connect(master);
  wind.start();

  const ease = (p: AudioParam, v: number) => p.setTargetAtTime(v, ctx.currentTime, EASE);

  /** One short note: frequency glide from f0 to f1 over `dur` seconds, starting `at` seconds from now. */
  function note(type: OscillatorType, f0: number, f1: number, dur: number, level: number, at = 0) {
    const t0 = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(level, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  let disposed = false;

  return {
    update(scene, speed, boosting) {
      if (disposed) return;
      const v = engineVoice(speed, boosting);
      const [e, w] = SCENE_MIX[scene];
      for (const p of parts) ease(p.o.frequency, v.freq * p.ratio);
      ease(engineFilter.frequency, v.cutoff);
      ease(engineGain.gain, v.gain * e);
      ease(chopDepth.gain, v.gain * e * 0.25);
      ease(chop.frequency, 18 + v.freq * 0.12);
      // In a room the same noise, filtered low and quiet, is the building's hum.
      ease(windFilter.frequency, scene === 'room' ? 180 : 500 + 900 * (v.wind / 0.14));
      ease(windGain.gain, (scene === 'room' ? ROOM_TONE : v.wind) * w);
    },
    cue(kind) {
      if (disposed || ctx.state !== 'running') return;
      switch (kind) {
        case 'arrive':
          note('sine', 660, 660, 0.12, 0.14);
          note('sine', 880, 880, 0.22, 0.14, 0.11);
          break;
        case 'land':
          note('sine', 520, 520, 0.12, 0.13);
          note('sine', 390, 390, 0.24, 0.13, 0.11);
          break;
        case 'select':
          note('triangle', 520, 560, 0.06, 0.1);
          break;
        case 'page':
          note('triangle', 380, 400, 0.05, 0.08);
          break;
        case 'bump':
          note('sine', 140, 48, 0.2, 0.3);
          note('square', 90, 40, 0.09, 0.08);
          break;
      }
    },
    setActive(on) {
      if (disposed) return;
      // Both return promises that reject if the context is already closing; nothing to do about that.
      if (on) void ctx.resume().catch(() => {});
      else void ctx.suspend().catch(() => {});
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const o of [...voices, chop]) o.stop();
      wind.stop();
      void ctx.close().catch(() => {});
    },
  };
}
