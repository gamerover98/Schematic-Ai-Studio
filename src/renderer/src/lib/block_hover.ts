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

import { FACE_VECTOR, type Face, type PlacementLook } from "../../../shared/block_orientation.js";
import { hasProperty, legalValuesFor } from "../../../shared/block_states.js";

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

/**
 * Where the next block of a column goes when the one clicked has no ends.
 *
 * `entryFace` gives the face of the cell the ray came in through, which is
 * what a full-cell collision box would give and is the game's own answer. It
 * is also, measured, a narrow gesture: the ray has to cross the cell's floor
 * *inside its footprint*, so aiming at the middle of a chain needs a look
 * steeper than 45 degrees, and at three blocks' range a shallower one gives
 * a side face -- the next link goes beside the one clicked, carrying that
 * side's axis. Which is what the game does too, and it was reported twice as
 * a column being unbuildable.
 *
 * So this is a **deliberate deviation**, and the argument is the one that
 * already lets an iron door open here: faithful and useless is worse than
 * useful. The half of the block you clicked decides which end the next one
 * goes on -- the low half means below, the high half above -- which is the
 * same question `placedInUpperHalf` asks of a slab, and the same value
 * (`cursorY`) it asks it of.
 *
 * It is narrow on purpose, and both halves of the guard matter:
 *
 * - **the block hit has no end faces** (`noEnds`), so nothing with a real
 *   face on that side is touched. A fence, a slab, a stair, a full cube:
 *   unchanged;
 * - **the block in hand has an `axis`**, so it is something that runs in a
 *   line. Placing stone, or a torch, by clicking a flower is unchanged --
 *   which matters, because a poppy is a cross like a chain is and is not
 *   replaceable. And it has to be an axis that can *be* vertical, which
 *   is `nether_portal` excluding itself: its `axis` is `x|z` with no `y`,
 *   so continuing a column with one would name a cell above or below and
 *   then write a state the game does not have. That is the orientation
 *   arm's own trap one layer along, and it takes the same answer -- ask
 *   whether the derived value is legal.
 *
 * What it costs is stated rather than hidden: you can no longer put a chain
 * *beside* a chain by clicking the chain. Click the block behind it instead.
 *
 * `against` moves with the cell, because everything downstream reads it --
 * the axis the block is born with, the slab merge, `use`, and the
 * replaceable redirect, which steps back along it to find what was clicked.
 */
/** The two faces at the ends of each axis, in the order the axis runs. */
const ENDS: Readonly<Record<string, readonly [Face, Face]>> = {
  x: ["west", "east"],
  y: ["down", "up"],
  z: ["north", "south"],
};

export function continuedPlacement(
  at: { readonly x: number; readonly y: number; readonly z: number },
  look: Pick<PlacementLook, "against" | "run">,
  holding: string,
): { at: { x: number; y: number; z: number }; against: Face } | null {
  if (look.run === null || look.against === null) return null;
  if (!hasProperty(holding, "axis")) return null;
  /*
   * ...and an `axis` that can take the value this run would give it, which
   * is `nether_portal` excluding itself from a vertical one: its `axis` is
   * `x|z`, so continuing a column with one would name a cell above or below
   * and then write a state the game does not have. The orientation arm's
   * own trap, one layer along, taking the same answer.
   */
  if (legalValuesFor(holding, "axis")?.includes(look.run.axis) !== true) return null;

  // Back to the block that was clicked: `at` is the cell across the face,
  // which is the same step `clickedCell` takes in main.
  const back = FACE_VECTOR[look.against];
  const hit = { x: at.x - back.x, y: at.y - back.y, z: at.z - back.z };

  const [low, high] = ENDS[look.run.axis];
  const against: Face = look.run.at < 0.5 ? low : high;
  const step = FACE_VECTOR[against];
  return {
    at: { x: hit.x + step.x, y: hit.y + step.y, z: hit.z + step.z },
    against,
  };
}

/**
 * How wide a block may be and still be counted unaimable, in model units.
 *
 * A chain's cross is 2.12 of 16 across; a flower's is 11.3, because a cross
 * spans its cell corner to corner and only *looks* thin. So the gap either
 * side of this number is wide and it is not a tuning knob: what is being
 * separated is geometry you cannot hit from geometry you can.
 */
const UNAIMABLE = 6 / 16;

/** A cell the pointer would otherwise pass straight through, and its box. */
export interface ThinBox {
  readonly cell: readonly [number, number, number];
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  /**
   * The one axis it is *not* narrow on -- the line it is strung along.
   *
   * A chain is long on exactly one axis and thin on the other two, which is
   * both what makes it unaimable and what says which way it runs. Carrying
   * it out of here is what lets a run be continued in the direction it
   * already goes rather than always downwards.
   */
  readonly axis: 0 | 1 | 2;
}

/**
 * The cells in a chunk whose geometry is too thin to aim at, with the box
 * that stands in for them.
 *
 * **This is the difference between the model and the collision box, and it is
 * what made a chain unbuildable.** The viewport raycasts the fused mesh, and a
 * chain's mesh is two planes of zero thickness, 3 texels wide, crossed at the
 * middle of its cell. Vanilla gives it a solid 3x16x3 column to click; here
 * there was nothing to click, so the ray went past it and hit whatever stood
 * behind -- and *that* block took the placement.
 *
 * Measured against a real document, a chain hanging from a stone block: from
 * dead underneath, the two planes are edge-on and present no area at all, so
 * the ray reached the stone's `down` face and the placement went into the
 * cell the chain was already in. From above or to one side it reached the
 * stone's *east* face, and the new chain went in beside it, with `axis=x`.
 * Reported three times, and never actually about the placement rules.
 *
 * The classification is the pick's own predicate read once more:
 * `hasDominantAxis` is false exactly for the geometry that has no face on
 * any axis of the cell, which is a plane turned 45 degrees. One idea, two
 * uses -- and it means nothing needs listing by name.
 *
 * The width test is what keeps a *cross* out: a flower is drawn the same way
 * and spans its cell corner to corner, so it is 11.3 units across and is
 * already easy to hit. Giving it a box would make it impossible to click the
 * ground behind it, which is a thing people do.
 *
 * The box is the geometry's **own** extent rather than a transcribed
 * collision shape: a chain comes out 2.12 across, which is its 3 texels
 * turned 45 degrees, against vanilla's 3x16x3. Slightly narrower, and that
 * is the right way to be wrong -- it is derived from what is drawn, so it
 * can never claim a shape the block does not have. Per-shape interaction
 * boxes are the real version of this and are a project of their own.
 *
 * `positions` and `normals` are the chunk's own buffers, four vertices per
 * face in order, which is what `buildMesh` emits: it pushes one face's four
 * positions and four copies of its normal, then the next face's. Reading
 * them in fours is therefore reading faces, and no index walk is needed.
 */
export function thinBoxes(positions: Float32Array, normals: Float32Array): ThinBox[] {
  const found = new Map<string, { min: number[]; max: number[]; cell: number[] }>();
  const faces = Math.floor(positions.length / 12);
  for (let f = 0; f < faces; f += 1) {
    const n = f * 12;
    if (hasDominantAxis([normals[n], normals[n + 1], normals[n + 2]])) continue;

    // The cell is the middle of the quad, which for a plane crossing a cell
    // is inside it however the plane is turned.
    const mid = [0, 1, 2].map(
      (a) => (positions[n + a] + positions[n + 3 + a] + positions[n + 6 + a] + positions[n + 9 + a]) / 4,
    );
    const cell = mid.map(Math.floor);
    const id = `${cell[0]},${cell[1]},${cell[2]}`;
    let box = found.get(id);
    if (box === undefined) {
      box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], cell };
      found.set(id, box);
    }
    for (let v = 0; v < 4; v += 1) {
      for (let a = 0; a < 3; a += 1) {
        const at = positions[n + v * 3 + a];
        if (at < box.min[a]) box.min[a] = at;
        if (at > box.max[a]) box.max[a] = at;
      }
    }
  }

  const out: ThinBox[] = [];
  for (const box of found.values()) {
    /*
     * **Exactly** two of the three, and the third is the answer as well as
     * the test. A chain runs the length of its cell on the one axis it is
     * strung along and is thin on the other two, whichever those are -- so
     * the shape that qualifies is also the shape that says which way it
     * goes. Three narrow axes would be a small blob with no line to
     * continue, and none of the shapes here is one.
     */
    const wide = [0, 1, 2].filter((a) => box.max[a] - box.min[a] > UNAIMABLE);
    if (wide.length !== 1) continue;
    out.push({
      cell: [box.cell[0], box.cell[1], box.cell[2]],
      min: [box.min[0], box.min[1], box.min[2]],
      max: [box.max[0], box.max[1], box.max[2]],
      axis: wide[0] as 0 | 1 | 2,
    });
  }
  return out;
}

/**
 * Where a ray enters a box, and through which face.
 *
 * The slab method, which is what `entryFace` already does on the unit cell --
 * this one answers for an arbitrary box and reports the distance as well, so
 * the caller can decide whether it beat the mesh.
 *
 * A ray that starts **inside** the box is not a hit. That matters: in flight
 * the camera passes through the build, and a box the camera is standing in
 * would otherwise be picked at zero range and win every comparison.
 */
export function rayBox(
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
  min: readonly [number, number, number],
  max: readonly [number, number, number],
): { distance: number; face: Face } | null {
  const faces: readonly [Face, Face][] = [["west", "east"], ["down", "up"], ["north", "south"]];
  let near = -Infinity;
  let far = Infinity;
  let face: Face = "up";
  for (let a = 0; a < 3; a += 1) {
    const d = direction[a];
    if (Math.abs(d) < 1e-9) {
      // Parallel to this pair of planes: a miss unless it is already between
      // them, and never a face the ray could have entered by.
      if (origin[a] < min[a] || origin[a] > max[a]) return null;
      continue;
    }
    const t0 = (min[a] - origin[a]) / d;
    const t1 = (max[a] - origin[a]) / d;
    const enter = Math.min(t0, t1);
    const leave = Math.max(t0, t1);
    if (enter > near) {
      near = enter;
      face = d > 0 ? faces[a][0] : faces[a][1];
    }
    if (leave < far) far = leave;
    if (near > far) return null;
  }
  if (near <= 1e-6 || near > far) return null;
  return { distance: near, face };
}
