/**
 * Whether the viewport has anything new to draw.
 *
 * The loop used to draw on every display refresh whether or not anything had
 * moved, so a still scene kept the GPU as busy as an orbiting one -- which on
 * a laptop iGPU is the whole budget, spent drawing the same picture. The loop
 * still wakes on every refresh; this decides whether that refresh draws.
 *
 * A plain module for `selection_drag.ts`'s reason: the loop runs from
 * `requestAnimationFrame`, which the harness here often does not deliver, so
 * the decision has to be testable without it.
 *
 * Four things ask for a frame:
 *
 * - **activity**: an input event, a prop that changed, a payload applied.
 *   Each one is an `invalidate`, and a frame is drawn for `SETTLE_MS` after
 *   the last of them. The window is what lets the parts of the loop that
 *   follow the pointer on a throttle (the hover, the block outline, the build
 *   grid answer at most every 50 ms) catch up after the event that moved it,
 *   and what lets a state change made *by* a frame reach the scene through an
 *   effect, a microtask after that frame was drawn.
 * - **the camera**: compared, not announced. OrbitControls keeps the camera
 *   moving after the button is released (damping), flight moves it every
 *   frame a key is held, and a compass flight moves it on its own; every one
 *   of them shows up as a different view.
 * - **an animated texture** that put a new frame into the atlas.
 * - **work left over**, such as an environment map that was due but held
 *   back by its one-second floor.
 */

/** How long after the last activity the loop keeps drawing. */
export const SETTLE_MS = 250;

export interface DemandInput {
  /** Now, in the same clock as `activeAt`. */
  readonly now: number;
  /** The last `invalidate`, or the last frame the camera moved in. */
  readonly activeAt: number;
  /** An animated texture uploaded a new frame this refresh. */
  readonly animated: boolean;
  /** Something is waiting for a later frame to finish. */
  readonly pending: boolean;
  /** The "always draw" diagnostic, which is the old behaviour. */
  readonly always: boolean;
}

export function shouldDraw(input: DemandInput): boolean {
  if (input.always || input.animated || input.pending) return true;
  return input.now - input.activeAt < SETTLE_MS;
}

/**
 * Remembers a view and says when it changed.
 *
 * Handed numbers rather than a camera, so the rule is three-free: the caller
 * passes the position, the orientation, the projection and which camera, and
 * any difference at all is a different picture. No tolerance -- a damped orbit
 * settles by converging, and a frame per tiny step until it stops is exactly
 * what it should get.
 */
export class ViewWatch {
  private last: Float64Array | null = null;

  /** `true` the first time and whenever any number differs from last time. */
  moved(values: ArrayLike<number>): boolean {
    const last = this.last;
    if (last === null || last.length !== values.length) {
      this.last = Float64Array.from(values as ArrayLike<number>);
      return true;
    }
    let changed = false;
    for (let i = 0; i < values.length; i++) {
      if (last[i] !== values[i]) {
        last[i] = values[i];
        changed = true;
      }
    }
    return changed;
  }

  /** Forget the view, so the next comparison counts as a move. */
  reset(): void {
    this.last = null;
  }
}

/**
 * What the frame counter shows once nothing is being drawn.
 *
 * Without it the counter would freeze on the rate of the last burst, or --
 * counted over the idle second -- read 2 fps, which looks like the stutter
 * this exists to remove. A still scene is not a slow one.
 */
export function counterIdle(now: number, lastDrawnAt: number, windowMs: number): boolean {
  return lastDrawnAt > 0 && now - lastDrawnAt >= windowMs;
}
