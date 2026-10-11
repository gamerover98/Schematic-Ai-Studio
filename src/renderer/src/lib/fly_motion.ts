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
 * **Three rules, and the third is the one the first version got wrong.**
 *
 * 1. *Only stopping is smoothed.* Speeding up is instant, so a key press
 *    answers on its own frame.
 * 2. *Only the horizontal glide exists.* Rising and sinking stop the frame the
 *    key goes up, as they do in the game: a camera that drifts on after Space
 *    is not flying, it is falling upwards.
 * 3. *A key held always wins.* The glide is what is left when **nothing** on
 *    the horizontal plane is being asked for. The moment any of W, A, S or D is
 *    down the camera goes where the keys say, at once -- including the other
 *    way. The first version smoothed each direction on its own, so pressing S
 *    during a forward glide had to bring the forward speed down through zero
 *    first, and the camera could not be steered until the glide had finished.
 *
 * The velocity is in the **world**, not in the camera's frame: turning while
 * gliding does not turn the glide, which is momentum, as it is in the game.
 */

/** The time constant, in seconds, a new install flies with. */
export const DEFAULT_FLY_DECELERATION = 0.25;

/** The longest the setting offers; the reader refuses anything beyond it. */
export const MAX_FLY_DECELERATION = 1;

/**
 * Below this, blocks per second, a gliding camera is stopped.
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

/** The camera's velocity in world axes, in blocks per second. */
export interface FlyVelocity {
  x: number;
  /** World up; never glides. */
  y: number;
  z: number;
}

export const STILL: FlyVelocity = { x: 0, y: 0, z: 0 };

/**
 * One frame of the horizontal glide: the velocity a frame later with nothing
 * asked for.
 *
 * An exponential with `tau` as its time constant, so two frames of `delta / 2`
 * land where one of `delta` does and the glide does not depend on the display's
 * rate. `tau` of zero is no glide at all -- the camera of before, exactly.
 */
export function coast(velocity: number, delta: number, tau: number): number {
  if (tau <= 0) return 0;
  return velocity * Math.exp(-Math.max(0, delta) / tau);
}

/**
 * The velocity one frame on, given what the keys ask for as a `target`.
 *
 * - **Anything asked for horizontally** is the velocity, on this frame: a key
 *   pressed, one let go with another still down, the opposite one, sprint.
 * - **Nothing asked for** glides: the horizontal velocity coasts down and is
 *   zero under `FLY_EPSILON`.
 * - **Vertical is the target always**, so it starts and stops with the key.
 */
export function stepVelocity(
  velocity: FlyVelocity,
  target: FlyVelocity,
  delta: number,
  tau: number,
): FlyVelocity {
  if (target.x !== 0 || target.z !== 0) return { x: target.x, y: target.y, z: target.z };
  const x = coast(velocity.x, delta, tau);
  const z = coast(velocity.z, delta, tau);
  // Together, or a glide would lose one axis before the other and bend at the
  // very end of its run.
  if (Math.hypot(x, z) < FLY_EPSILON) return { x: 0, y: target.y, z: 0 };
  return { x, y: target.y, z };
}

/** Whether there is nothing left to move. */
export function isStill(velocity: FlyVelocity): boolean {
  return velocity.x === 0 && velocity.y === 0 && velocity.z === 0;
}
