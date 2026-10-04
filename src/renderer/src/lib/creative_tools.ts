/**
 * The creative tools' rules, as plain functions.
 *
 * `shared/creative.ts` says what the tools are; this says what they do with
 * the cell under the crosshair. It is a plain module for `selection_drag.ts`'s
 * reason: the gestures run from the viewer's loop and its pointer handlers,
 * which the harness here cannot drive, and every rule below has an edge worth
 * stating where a check can read it.
 *
 * ## The brush is centred on the block aimed at
 *
 * VoxelSniper's convention, and what anyone who has used a ball brush
 * expects: a sphere painted onto a hillside is half in the hill and half out
 * of it. The mode decides what that means -- `all` writes both halves, `empty`
 * only the half in the air, `filled` only the half in the hill. With nothing
 * under the crosshair the brush stands *on* the build grid instead of being
 * centred in it, or every touch on the floor of an empty schematic would
 * reach below the origin and move the whole build up.
 *
 * ## A stroke is touches, and only touches
 *
 * A touch is one shape, written as one `EditRequest.shape`, and every touch
 * of a stroke carries its id so the stroke is one Ctrl+Z (`mergeKey` in
 * `history.ts`). The next touch waits until the crosshair has moved half a
 * radius from the last one, and nothing is drawn *between* two touches: the
 * line between two points on a surface runs through the air or through the
 * ground, so filling it in would build a bridge or dig a tunnel nobody asked
 * for. A fast swing leaves gaps, as it does in the game.
 *
 * ## Two corners
 *
 * The shape and walls tools are two right-clicks: the first fixes a corner,
 * the second builds between it and the cell aimed at. Until the second, a
 * ghost of what it would build follows the crosshair, and Escape -- or
 * anything else that ends flight -- forgets the first.
 */

import {
  BRUSH_RADIUS,
  CREATIVE_TOOLS,
  TOOL_HEIGHT,
  type BrushSettings,
  type CreativeSettings,
  type CreativeTool,
} from "../../../shared/creative.js";
import { orderBox, type Box } from "../../../shared/regions.js";
import {
  normalizeShape,
  shapeContains,
  type ShapeCells,
  type ShapeMode,
  type ShapeSpec,
} from "../../../shared/shapes.js";

export interface Cell {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * What the viewer is told about the tool in hand: everything it needs to
 * draw the ghost and to know what a click means, and nothing it would have
 * to keep in step. The first corner is the app's, because Escape and the
 * end of flight are heard there.
 */
export interface CreativeAim {
  readonly settings: CreativeSettings;
  readonly corner: Cell | null;
}

/**
 * A brush stroke as the viewer reports it: the button went down, a touch was
 * due, the button came up. The shape is already worked out, from the same
 * `brushSpec` the ghost was drawn with.
 */
export type StrokeEvent =
  | { readonly phase: "begin"; readonly erase: boolean }
  | { readonly phase: "touch"; readonly shape: ShapeSpec }
  | { readonly phase: "end" };

/** The tool after this one, round and back to the start: what B does. */
export function nextTool(tool: CreativeTool): CreativeTool {
  const at = CREATIVE_TOOLS.indexOf(tool);
  return CREATIVE_TOOLS[(at + 1) % CREATIVE_TOOLS.length];
}

/** The tools that take two corners rather than a stroke. */
export function takesCorners(tool: CreativeTool): tool is "shape" | "walls" {
  return tool === "shape" || tool === "walls";
}

/**
 * The shape one touch of the brush writes, around `at`.
 *
 * `standing` is the build grid's case: the brush rests on the floor rather
 * than sinking half into it. A disc is one block tall and centred on its own
 * layer, so standing changes nothing for it.
 */
export function brushSpec(brush: BrushSettings, at: Cell, standing: boolean): ShapeSpec {
  const r = brush.radius;
  const flat = brush.shape === "disc";
  const y = standing && !flat ? at.y + r : at.y;
  return {
    kind: brush.shape === "cube" ? "box" : flat ? "cylinder" : "sphere",
    box: {
      minX: at.x - r,
      minY: flat ? y : y - r,
      minZ: at.z - r,
      maxX: at.x + r,
      maxY: flat ? y : y + r,
      maxZ: at.z + r,
    },
    axis: "y",
  };
}

/**
 * How far the crosshair travels, in blocks, before the brush touches again.
 *
 * Half the radius, and never less than one block: a smaller step paints the
 * same cells again for nothing, and every touch is an edit with a round trip.
 */
export function strokeSpacing(radius: number): number {
  return Math.max(1, radius / 2);
}

/** Whether the brush, last down at `last`, touches again at `next`. */
export function shouldTouch(last: Cell | null, next: Cell, radius: number): boolean {
  if (last === null) return true;
  const distance = Math.hypot(next.x - last.x, next.y - last.y, next.z - last.z);
  return distance >= strokeSpacing(radius);
}

/**
 * What one touch reached: its shape, grown by a block on every side.
 *
 * A stroke never touches down inside what it has already reached, and that
 * is the difference between a brush and a drill. The crosshair finds the
 * first block along its ray, and after a touch that block is the touch's own
 * output -- the near side of the sphere just painted, or the floor of the
 * crater just rubbed out -- half a radius nearer or further than the last.
 * Held still, a brush that touched down there would grow a column of spheres
 * towards the camera, or bore a tunnel away from it, twenty times a second.
 * Found by doing it: one second of a held button made a 32-wide schematic 51.
 *
 * Grown by one so the crater's floor counts as well as the sphere's surface:
 * the floor is the first cell *outside* what was rubbed out. The cost is a
 * block of spacing between touches on open ground, where they still overlap.
 */
export function reachOf(spec: ShapeSpec): (x: number, y: number, z: number) => boolean {
  const box = orderBox(spec.box);
  return shapeContains(
    normalizeShape({
      ...spec,
      hollow: false,
      box: {
        minX: box.minX - 1,
        minY: box.minY - 1,
        minZ: box.minZ - 1,
        maxX: box.maxX + 1,
        maxY: box.maxY + 1,
        maxZ: box.maxZ + 1,
      },
    }),
  );
}

/** Whether a stroke has already reached `at`: any of its touches did. */
export function reached(trail: readonly ((x: number, y: number, z: number) => boolean)[], at: Cell): boolean {
  return trail.some((contains) => contains(at.x, at.y, at.z));
}

/**
 * The box between two clicked corners.
 *
 * From the lower corner up to the higher one, or up to the height the tool is
 * set to if that is taller. Two corners on one level are the ordinary case --
 * the ground on both sides -- and the set height is what they mean; a corner
 * clicked high up is somebody saying how tall. Ground that is a block uneven
 * would otherwise turn a four-high wall into a two-high one.
 */
export function cornerBox(a: Cell, b: Cell, height: number): Box {
  const minY = Math.min(a.y, b.y);
  return {
    minX: Math.min(a.x, b.x),
    minY,
    minZ: Math.min(a.z, b.z),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y, minY + height - 1),
    maxZ: Math.max(a.z, b.z),
  };
}

/** What the shape or walls tool builds between two corners. */
export function cornerSpec(tool: "shape" | "walls", settings: CreativeSettings, a: Cell, b: Cell): ShapeSpec {
  if (tool === "walls") {
    const walls = settings.walls;
    return { kind: "walls", box: cornerBox(a, b, walls.height), thickness: walls.thickness };
  }
  const shape = settings.shape;
  return {
    kind: shape.kind,
    box: cornerBox(a, b, shape.height),
    axis: shape.axis,
    hollow: shape.hollow,
    thickness: shape.thickness,
  };
}

/** Which cells a tool's edit writes. */
export function toolMode(tool: CreativeTool, settings: CreativeSettings): ShapeMode {
  if (tool === "walls") return settings.walls.mode;
  if (tool === "shape") return settings.shape.mode;
  return settings.brush.mode;
}

/**
 * A right-click with a tool that takes corners: the first fixes one, the
 * second hands both back to be built and starts over.
 */
export function cornerClick(
  corner: Cell | null,
  at: Cell,
): { corner: Cell | null; build: readonly [Cell, Cell] | null } {
  return corner === null ? { corner: at, build: null } : { corner: null, build: [corner, at] };
}

export type CreativeKey = "cycle" | "smaller" | "bigger";

/**
 * The keys the tools answer, by **physical** key.
 *
 * `[` and `]` are read off `code`, not `key`: on an Italian keyboard they are
 * AltGr+è and AltGr++, and AltGr arrives as Ctrl+Alt -- so read by character
 * they would need a chord, and the chord would carry a Ctrl that flight gives
 * to the camera. The key in that position works on every layout, with or
 * without AltGr.
 *
 * B is not Z, and not Tab: in flight Shift is the descend key, so a letter
 * pressed while descending arrives with Shift on, and Shift+Z reflects the
 * selection; Tab moves the focus. B means nothing anywhere else here. Ctrl+B
 * is the sidebar's while the keyboard is not flying, and B while flying even
 * with Ctrl down, which is sprinting.
 */
export function creativeKey(
  event: { readonly code: string; readonly ctrlKey: boolean; readonly altKey: boolean; readonly metaKey: boolean },
  flying: boolean,
): CreativeKey | null {
  if (event.metaKey) return null;
  if (event.code === "BracketLeft") return "smaller";
  if (event.code === "BracketRight") return "bigger";
  if (event.code === "KeyB" && !event.altKey && (flying || !event.ctrlKey)) return "cycle";
  return null;
}

/**
 * The tool made a step smaller or bigger: the brush's radius, or how tall a
 * shape or a wall stands when its corners are on one level. The block in
 * your hand has no size.
 */
export function resized(settings: CreativeSettings, tool: CreativeTool, by: number): CreativeSettings {
  const clamp = (value: number, range: { readonly min: number; readonly max: number }): number =>
    Math.min(range.max, Math.max(range.min, value));
  switch (tool) {
    case "brush":
      return { ...settings, brush: { ...settings.brush, radius: clamp(settings.brush.radius + by, BRUSH_RADIUS) } };
    case "shape":
      return { ...settings, shape: { ...settings.shape, height: clamp(settings.shape.height + by, TOOL_HEIGHT) } };
    case "walls":
      return { ...settings, walls: { ...settings.walls, height: clamp(settings.walls.height + by, TOOL_HEIGHT) } };
    case "place":
      return settings;
  }
}

/**
 * Past this many cells in its box, a ghost is drawn as the box alone.
 *
 * The ghost is rebuilt as the crosshair moves, and finding a shape's cells is
 * a pass over its whole box. A million is a few milliseconds; a wall round a
 * whole city is not, and its outline says what it is going to do just as well.
 */
export const MAX_GHOST_CELLS = 1_000_000;

/**
 * The four corners of each face of a unit cell, wound anticlockwise seen from
 * outside, so the face's front is the side the ghost is looked at from.
 * Offsets from the cell's own corner. `tests/ui.ts` checks every normal.
 */
const FACES: readonly { readonly step: readonly [number, number, number]; readonly quad: readonly (readonly [number, number, number])[] }[] = [
  { step: [1, 0, 0], quad: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { step: [-1, 0, 0], quad: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { step: [0, 1, 0], quad: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { step: [0, -1, 0], quad: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { step: [0, 0, 1], quad: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { step: [0, 0, -1], quad: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
];

/**
 * The outside of a set of cells, as triangles: every face of a cell whose
 * neighbour across it is not in the set. Positions are relative to the
 * window's corner, so one geometry serves a shape wherever it stands.
 */
export function ghostFaces(cells: ShapeCells): Float32Array {
  const win = cells.window;
  if (win === null) return new Float32Array(0);
  const w = win.maxX - win.minX + 1;
  const h = win.maxY - win.minY + 1;
  const l = win.maxZ - win.minZ + 1;
  const plane = h * l;
  const inside = (x: number, y: number, z: number): boolean =>
    x >= 0 && y >= 0 && z >= 0 && x < w && y < h && z < l && cells.mask[x * plane + y * l + z] === 1;

  const out: number[] = [];
  for (let x = 0; x < w; x += 1) {
    for (let y = 0; y < h; y += 1) {
      for (let z = 0; z < l; z += 1) {
        if (cells.mask[x * plane + y * l + z] !== 1) continue;
        for (const face of FACES) {
          if (inside(x + face.step[0], y + face.step[1], z + face.step[2])) continue;
          const [a, b, c, d] = face.quad;
          for (const corner of [a, b, c, a, c, d]) out.push(x + corner[0], y + corner[1], z + corner[2]);
        }
      }
    }
  }
  return new Float32Array(out);
}
