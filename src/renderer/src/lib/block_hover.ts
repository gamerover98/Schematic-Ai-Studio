/**
 * Where the block outline takes its ray from, if anywhere.
 *
 * The outline itself is older than this module and was flight's alone: in
 * flight the crosshair is the pointer, so "what am I about to click" answers
 * itself. In orbit there was no answer at all — you clicked a block to inspect
 * it, or Shift-clicked to select it, and nothing on screen said which block the
 * ray was on until after the click had already happened. The pick was being
 * computed either way; it simply was not drawn.
 *
 * This is a plain module rather than a branch inside `updateBlockHighlight` for
 * the standing reason `selection_drag.ts` and `floating.ts` are: the outline is
 * refreshed from the render loop, `requestAnimationFrame` callbacks belong to
 * the rendering steps, and the Browser pane here is frequently not compositing
 * — so a rule left inside the component is a rule that cannot be defended.
 * Only the trigger stays unobservable; the decision is `tests/ui.ts`'s.
 */

import type { Face } from "../../../shared/block_orientation.js";

/** Where to cast from, or that there is nothing to draw. */
export type HoverSource =
  | { readonly kind: "none" }
  | { readonly kind: "crosshair" }
  | { readonly kind: "pointer"; readonly x: number; readonly y: number };

const NONE: HoverSource = { kind: "none" };

export interface HoverState {
  readonly cameraMode: "orbit" | "fly";
  /** Whether the canvas holds the pointer lock. Flight's crosshair is real only then. */
  readonly flying: boolean;
  /** Whether there is a mesh to raycast at all. */
  readonly loaded: boolean;
  /** Latest pointer position over the canvas, or `null` once it has left. */
  readonly pointer: { readonly x: number; readonly y: number } | null;
  /**
   * Whether the pointer is over one of the selection's six face handles.
   *
   * The cursor has already become `ns-resize`/`ew-resize` there, and the press
   * will drag the face rather than touch the block underneath — so outlining
   * that block would promise something the click does not do.
   */
  readonly overHandle: boolean;
  /**
   * Whether the pointer is over one of the transform gizmo's handles.
   *
   * The same sentence as the one above, about a different thing drawn for the
   * same purpose. It is a field of its own rather than folded into
   * `overHandle` because the two come from different raycasts and a failure
   * should name which one was forgotten.
   */
  readonly overGizmo: boolean;
  /** Whether a drag is in flight. The outline must not chase it. */
  readonly dragging: boolean;
}

/**
 * Whether the pointer is promising a handle rather than what is behind it.
 *
 * Two consumers, which is why it is a function rather than a condition inside
 * `hoverSource`: the block outline, which must not draw around a block the
 * click will not touch, and the build grid's patch, which must not draw a
 * target on the floor behind an arrow. The second was missing -- hovering a
 * gizmo arrow over open ground lit a cell at y=0 that the press had nothing to
 * do with, which reads as the editor being about to place something there.
 */
export function pointerOnHandle(state: {
  readonly overHandle: boolean;
  readonly overGizmo: boolean;
  readonly dragging: boolean;
}): boolean {
  return state.overHandle || state.overGizmo || state.dragging;
}

export function hoverSource(state: HoverState): HoverSource {
  // Nothing to hit. Also the empty-document case, where the build grid is the
  // only thing under the pointer and it is not a block.
  if (!state.loaded) return NONE;

  if (state.cameraMode === "fly") {
    // Before the lock the click means "capture the pointer", not "build here",
    // and the crosshair is not yet where the ray goes.
    return state.flying ? { kind: "crosshair" } : NONE;
  }

  if (pointerOnHandle(state) || state.pointer === null) return NONE;
  return { kind: "pointer", x: state.pointer.x, y: state.pointer.y };
}

/**
 * The centre of a cell, which is where a 1x1x1 outline sits.
 *
 * A cell spans `[x, x+1]`, so its centre is half a block along each axis.
 * Written down rather than inlined because getting it wrong draws the outline
 * over the block's corner, which reads as a rendering glitch rather than as
 * arithmetic.
 */
export function outlineCentre(cell: {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}): { x: number; y: number; z: number } {
  return { x: cell.x + 0.5, y: cell.y + 0.5, z: cell.z + 0.5 };
}

/**
 * The hit normal, turned to face the ray that found it.
 *
 * `pickBlockAt` steps a hair *inwards* from the surface along `-normal`, and
 * that is right only for a face the ray struck from the front. It was written
 * when the block material was `DoubleSide`, where a ray could perfectly well
 * arrive at a face's back and `-normal` then pointed back out along the line
 * of sight instead of into the block.
 *
 * That material is `FrontSide` now, and `Mesh.raycast` honours it, so the
 * hit this repairs can no longer be produced by the opaque layer. It stays,
 * because the two layers that are still double-sided -- the water and the
 * block standing in for empty space -- are raycast by nothing today and that
 * is a fact about the call sites rather than about this rule. It costs one
 * dot product and cannot change an answer that was already right.
 *
 * The azalea is where that shows. Vanilla's `template_azalea` states its lid as
 * a zero-thickness element at `y = 16` carrying **both** an `up` and a `down`
 * face, so the block's top surface sits exactly on the boundary with the cell
 * above and half of it points the wrong way. Whichever of the two the raycaster
 * returned decided the answer: on the `down` one the pick landed one cell up,
 * and since that cell is air the outline drew around nothing, breaking it
 * changed nothing, and placing went a cell too high. The report was "placing an
 * azalea puts an air block above it that cannot be removed", which is exactly
 * what that looks like from the outside.
 *
 * Turning the normal costs nothing and cannot change a front-face answer: there
 * the dot product is already negative and the vector is returned as it came.
 */
export function facingNormal(
  normal: readonly [number, number, number],
  direction: readonly [number, number, number],
): readonly [number, number, number] {
  const towardsRay =
    normal[0] * direction[0] + normal[1] * direction[1] + normal[2] * direction[2] > 0;
  return towardsRay ? [-normal[0], -normal[1], -normal[2]] : normal;
}

/**
 * Whether a normal picks out an axis at all.
 *
 * `pickBlockAt` turns a hit normal into a face of the cell by taking its
 * dominant component. That is right whenever there *is* one, and for a great
 * many shapes it is exact -- a slab's top, a stair's riser, a torch's side are
 * all axis-aligned, and the lectern's desk, tilted 22.5 degrees, still has a
 * clear winner at 0.924 against 0.383.
 *
 * A **cross** does not. Its planes are turned 45 degrees about y, so the
 * normal is `(+-0.7071, 0, +-0.7071)`: the two horizontal terms are exactly
 * equal and the winner is decided by which way a `>=` happens to lean, while
 * the vertical term is zero and can never win. Every chain, flower, sapling,
 * amethyst bud and fire in the game is one of these.
 *
 * That is what made a column of chains impossible to build. A chain's two
 * planes span the full height of the cell, so `boxFaces` drops their `up` and
 * `down` faces as having no area -- there is no end of a chain to click. Aim
 * at one from below and the ray struck a plane's side, the tie was broken
 * sideways, and the next chain went in the cell *beside* the one clicked,
 * carrying the axis of that sideways face. Reported exactly that way: placed
 * laterally, and with a different `axis`.
 *
 * The epsilon is not a tuning knob. A tie means the existing answer is a coin
 * toss, and this returns `false` only then; anything with a real winner keeps
 * the answer it always had.
 */
export function hasDominantAxis(normal: readonly [number, number, number]): boolean {
  const sorted = [Math.abs(normal[0]), Math.abs(normal[1]), Math.abs(normal[2])].sort(
    (a, b) => b - a,
  );
  return sorted[0] > 1e-6 && sorted[0] - sorted[1] > 1e-6;
}

/**
 * The face of a cell that a ray entered through.
 *
 * This is the answer a **collision box** would give, and this app has none:
 * the viewport raycasts one fused mesh with no per-block identity, so a
 * block's interaction volume is exactly the geometry that is drawn. Vanilla
 * keeps the two apart, which is why a chain there has a bottom face to click
 * -- its box is a full-height 3x3 column -- while the model it draws does not.
 *
 * Used only where `hasDominantAxis` says the normal names no face, so it
 * stands in for a full-cell box and nothing narrower. That is the right
 * approximation for the shapes that reach it: a cross fills the cell corner
 * to corner in plan, and its planes run the whole way up.
 *
 * Slab method on the unit cube `[cell, cell + 1]` on each axis, taking the
 * **largest** of the three entry distances -- the last slab entered is the one
 * whose face the ray actually crossed. A component of zero is parallel to that
 * pair of planes and contributes no entry at all, which is what the guard is
 * for rather than a division producing an infinity that then wins.
 *
 * The face is named from the side the ray came *from*, so it is the face a
 * neighbour would share: entering through the bottom gives `down`, and a
 * placement one cell along `down` lands under the block that was clicked.
 */
export function entryFace(
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
  cell: { readonly x: number; readonly y: number; readonly z: number },
): Face {
  const low = [cell.x, cell.y, cell.z];
  const faces: readonly [Face, Face][] = [
    ["west", "east"],
    ["down", "up"],
    ["north", "south"],
  ];

  let best = -Infinity;
  let face: Face = "up";
  for (let axis = 0; axis < 3; axis += 1) {
    const d = direction[axis];
    if (Math.abs(d) < 1e-9) continue;
    // The near plane of this slab is the one the ray meets first, which is the
    // low side when travelling in the positive direction.
    const plane = d > 0 ? low[axis] : low[axis] + 1;
    const t = (plane - origin[axis]) / d;
    if (t > best) {
      best = t;
      face = d > 0 ? faces[axis][0] : faces[axis][1];
    }
  }
  return face;
}
