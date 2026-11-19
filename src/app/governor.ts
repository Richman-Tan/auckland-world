/**
 * The frame-rate governor: watches how long frames take and picks a detail level, so a slow phone or
 * an integrated GPU drops to a shorter draw distance and chunkier pixels instead of stuttering.
 * Pure: feed it frame times, read back a level (0 = full detail). What a level means is up to the
 * caller (app.ts maps it to fog distance and pixel scale).
 *
 * Three rules keep it from being a nuisance:
 *  - it waits for a sustained problem (seconds, not one slow frame) before lowering detail;
 *  - it raises detail again only after a long clean run, and if that just brings the stutter back
 *    it settles on the lower level for good;
 *  - if lowering detail all the way does not make frames any faster, the rate is being capped by
 *    something else (a 30 Hz low-power mode, a busy main thread), so it gives the detail back.
 */
export interface GovernorOptions {
  /** Number of detail levels, including level 0. */
  levels: number;
  /** Below this smoothed frame rate for `downAfterS`, lower the detail. */
  lowFps?: number;
  /** Above this for `upAfterS`, try raising it again. */
  highFps?: number;
  downAfterS?: number;
  upAfterS?: number;
  /** Seconds to ignore after any change, while the new level's frame times settle. */
  settleS?: number;
}

export interface Governor {
  /** Current detail level: 0 is full detail, levels - 1 the lowest. */
  readonly level: number;
  /** Smoothed frames per second, for the debug readout. */
  readonly fps: number;
  /** Feed one frame's duration in seconds. Returns the level to use from now on. */
  sample(dt: number): number;
  /** Start again from full detail (a manual graphics setting was released back to auto). */
  reset(): void;
}

/** A frame this long is a hitch (tab switch, shader compile, GC), not a frame rate. */
const HITCH_S = 0.25;
/** Stepping down again this soon after stepping up means the higher level does not hold. */
const RELAPSE_S = 30;
/** Lowest detail must buy at least this much speed-up over full detail, or the rate is capped elsewhere. */
const MIN_GAIN = 1.15;

export function createGovernor(opts: GovernorOptions): Governor {
  const max = Math.max(0, Math.floor(opts.levels) - 1);
  const lowFps = opts.lowFps ?? 45;
  const highFps = opts.highFps ?? 57;
  const downAfter = opts.downAfterS ?? 3;
  const upAfter = opts.upAfterS ?? 12;
  const settle = opts.settleS ?? 2;

  let level = 0;
  /** Never raise detail above this level again (it relapsed). */
  let floor = 0;
  let fps = 60;
  let slowFor = 0;
  let fastFor = 0;
  let settling = 0;
  let sinceUp = Infinity;
  /** Smoothed fps just before the first step down from full detail. */
  let fpsAtFull = 0;
  /** Lowering detail did not help: stay at full detail and stop adjusting. */
  let capped = false;

  function change(to: number) {
    level = to;
    slowFor = 0;
    fastFor = 0;
    settling = settle;
  }

  function reset() {
    level = 0;
    floor = 0;
    fps = 60;
    slowFor = 0;
    fastFor = 0;
    settling = 0;
    sinceUp = Infinity;
    fpsAtFull = 0;
    capped = false;
  }

  return {
    get level() {
      return level;
    },
    get fps() {
      return fps;
    },
    reset,
    sample(dt) {
      if (!(dt > 0) || capped || max === 0) return level;
      if (dt > HITCH_S) {
        // Not evidence either way; do not let it count towards a run.
        slowFor = 0;
        fastFor = 0;
        return level;
      }
      sinceUp += dt;
      // Exponential average over about a second.
      fps += (1 / dt - fps) * (1 - Math.exp(-dt));
      if (settling > 0) {
        settling -= dt;
        return level;
      }
      slowFor = fps < lowFps ? slowFor + dt : 0;
      fastFor = fps > highFps ? fastFor + dt : 0;

      if (slowFor >= downAfter) {
        if (level < max) {
          if (level === 0 && fpsAtFull === 0) fpsAtFull = fps;
          if (sinceUp < RELAPSE_S) floor = level + 1;
          change(level + 1);
        } else if (fpsAtFull > 0 && fps < fpsAtFull * MIN_GAIN) {
          // Bottom of the ladder and no faster than at the top: detail was never the problem.
          capped = true;
          change(0);
        } else {
          slowFor = 0;
        }
      } else if (fastFor >= upAfter && level > floor) {
        sinceUp = 0;
        change(level - 1);
      }
      return level;
    },
  };
}
