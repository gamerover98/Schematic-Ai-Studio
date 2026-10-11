/**
 * How the flight camera slows down, as numbers.
 *
 * `updateFlight` used to move the camera by `held keys * speed * delta`, which
 * has no velocity in it at all -- so letting go of a key stopped the camera on
 * that very frame. In the game's creative flight the camera carries on and
 * slows; this is that, with one number for how long it takes.
 *
 * Plain, for `selection_drag.ts`'s reason: `requestAnimationFrame` belongs to
 * the rendering steps, which the harness here often does not run, so the
 * decision is kept where it can be tested and only the trigger is the viewer's.
 *
 * **Speeding up stays instant and only slowing down is smoothed.** That is what
 * was asked for, and it keeps a key press answering on its own frame: a camera
 * that also took time to get going would feel heavy rather than inert.
 */

/** The time constant, in seconds, a new install flies with. */
export const DEFAULT_FLY_DECELERATION = 0.25;

/** The longest the setting offers; the reader refuses anything beyond it. */
export const MAX_FLY_DECELERATION = 1;

/**
 * Below this, blocks per second, a slowing camera is stopped.
 *
 * An exponential never reaches zero, and the viewport draws on demand by
 * *comparing* the camera between refreshes: left to creep, a camera moving a
 * thousandth of a block a second would keep the loop drawing for as long as
 * the float kept changing.
 */
export const FLY_EPSILON = 0.01;

/**
 * The longest a frame is allowed to be, in seconds, when it is integrated.
 *
 * `clock.getDelta()` is not clamped, and a refresh that was held back -- a
 * window behind another, a paused tab -- arrives with seconds on it. With a
 * velocity that is a glide of seconds in one frame rather than a step.
 */
export const MAX_FLY_DELTA = 0.25;

/**
 * The deceleration for a stored value.
 *
 * Total, for `fpsCap`'s reason: `coerceSettings` spreads `preview` over the
 * defaults without checking it, and that is safe only while a junk value reads
 * exactly like an absent one. Past the range it is clamped rather than
 * refused, because a number that is merely too big is still somebody asking for
 * "a lot".
 */
export function decelerationOf(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_FLY_DECELERATION;
  return Math.min(MAX_FLY_DECELERATION, Math.max(0, value));
}

/**
 * One component of the velocity, one frame on.
 *
 * - `tau` of zero is the target itself: the camera of before, exactly.
 * - The target further out in the direction already going, or the camera at
 *   rest, is taken at once.
 * - Anything else -- a key let go, sprint let go, the other way pressed -- is
 *   an exponential approach with `tau` as its time constant. Two frames of
 *   `delta / 2` land where one of `delta` does, so the glide does not depend on
 *   the display's rate.
 */
export function smoothVelocity(velocity: number, target: number, delta: number, tau: number): number {
  if (tau <= 0) return target;
  if (Math.abs(target) >= Math.abs(velocity) && target * velocity >= 0) return target;
  const next = target + (velocity - target) * Math.exp(-Math.max(0, delta) / tau);
  return target === 0 && Math.abs(next) < FLY_EPSILON ? 0 : next;
}

/** The three components of a flying camera's velocity, in blocks per second. */
export interface FlyVelocity {
  /** Along the way the camera looks, flattened to the ground. */
  forward: number;
  /** Across it. */
  right: number;
  /** World up. */
  up: number;
}

export const STILL: FlyVelocity = { forward: 0, right: 0, up: 0 };

/** `smoothVelocity` over all three. */
export function stepVelocity(
  velocity: FlyVelocity,
  target: FlyVelocity,
  delta: number,
  tau: number,
): FlyVelocity {
  return {
    forward: smoothVelocity(velocity.forward, target.forward, delta, tau),
    right: smoothVelocity(velocity.right, target.right, delta, tau),
    up: smoothVelocity(velocity.up, target.up, delta, tau),
  };
}

/** Whether there is nothing left to move. */
export function isStill(velocity: FlyVelocity): boolean {
  return velocity.forward === 0 && velocity.right === 0 && velocity.up === 0;
}
