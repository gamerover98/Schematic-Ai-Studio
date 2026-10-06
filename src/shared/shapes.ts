/**
 * Which cells a shape covers: a sphere, a cylinder, a pyramid, a box, walls.
 *
 * WorldEdit's shapes, because that is what anybody who builds in Minecraft
 * already knows the look of -- `//sphere`, `//cyl`, `//pyramid`, `//faces`,
 * `//walls`. `.claude/skills/mc-building-tools` holds where each rule came from
 * and the counts the suites hold this module to.
 *
 * ## A shape is inscribed in a box
 *
 * WorldEdit names a shape by a centre block and a radius, so every shape is an
 * odd number of blocks across: radius 3 is seven. That is one way to say it,
 * and it cannot say six. Here a shape is the one inscribed in a box, inclusive
 * on both corners, and WorldEdit's are the boxes `centre ± radius`:
 *
 * - a **sphere** keeps the cells whose centre lies inside the ellipsoid that
 *   touches the box's faces. Measured from the box's middle in units of half
 *   its size, which for a box `2r + 1` across is WorldEdit's own
 *   `(x / (r + 0.5))^2 + ... <= 1` exactly, inclusive;
 * - a **cylinder** is that rule over the two axes across its own, the whole
 *   length of the box along it;
 * - a **pyramid** steps in one block on every side per layer going up, from
 *   the box's floor, until nothing is left or the box ends. WorldEdit's
 *   `//pyramid s` is the box `2s - 1` across and `s` tall. A footprint that is
 *   not square comes out as a hipped roof, and a box shorter than the pyramid
 *   cuts it flat, which is what a 45 degree slope of stairs looks like;
 * - a **box** is every cell, and **walls** are its four sides.
 *
 * ## Hollow
 *
 * A cell is in the shell when a cell `thickness` steps away along one of the
 * shape's hollow axes is outside the shape. Every shape here is convex, so
 * that one look stands for every step in between. Which axes count is
 * WorldEdit's answer for each command, and they differ:
 *
 * - a sphere and a box are closed (`//hsphere`, `//faces`);
 * - a cylinder is an open tube, no caps (`//hcyl`);
 * - a pyramid has no floor (`//hpyramid`);
 * - walls have neither floor nor ceiling (`//walls`), which is why they are a
 *   box hollowed across x and z and nothing else.
 *
 * At thickness 1 this is WorldEdit's own test -- the next cell outwards on
 * each axis -- and `tests/session.ts` holds every shape to a port of
 * `EditSession` cell for cell.
 *
 * ## The window
 *
 * The cells are found inside a window, which is the box cut to whatever can
 * hold them: a shape reaching past the schematic is still that shape, cut by
 * the edge, rather than a smaller shape squeezed inside it. A look past the
 * window asks the shape's rule directly, so a shell is a shell at the cut too.
 * The window is what bounds the memory: a byte per cell of it, and it never
 * spans more than the document does.
 */

import { intersectBox, orderBox, type Box } from "./regions.js";

export const SHAPE_KINDS = ["sphere", "cylinder", "pyramid", "box", "walls"] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

export const SHAPE_AXES = ["x", "y", "z"] as const;
export type ShapeAxis = (typeof SHAPE_AXES)[number];

/**
 * Which cells of a shape an edit writes.
 *
 * `empty` writes only where there is nothing -- air, or the document's own
 * empty space block -- so a shape drawn through a build fills round it.
 * `filled` writes only over something, which is how a shape recolours what is
 * already there. `all` writes every cell.
 */
export const SHAPE_MODES = ["all", "empty", "filled"] as const;
export type ShapeMode = (typeof SHAPE_MODES)[number];

/** How thick a shell may be asked for. Past half the box it is solid anyway. */
export const MAX_SHAPE_THICKNESS = 64;

export interface ShapeSpec {
  kind: ShapeKind;
  /** The box the shape is inscribed in, inclusive. Any two opposite corners. */
  box: Box;
  /** The cylinder's own axis. Default `y`, standing up. Only a cylinder reads it. */
  axis?: ShapeAxis;
  /** Only the shell. Walls are always hollow. */
  hollow?: boolean;
  /** How many blocks thick the shell is. Default 1. */
  thickness?: number;
}

/** A shape with every field decided and its box in order. */
export interface Shape {
  kind: ShapeKind;
  box: Box;
  axis: ShapeAxis;
  hollow: boolean;
  thickness: number;
}

export class ShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShapeError";
  }
}

/**
 * A spec as it arrives -- off the wire or out of a model -- checked and filled
 * in. A kind or an axis that does not exist is refused by name; the box may be
 * given by any two opposite corners.
 */
export function normalizeShape(spec: ShapeSpec): Shape {
  if (!(SHAPE_KINDS as readonly string[]).includes(spec.kind)) {
    throw new ShapeError(`"${String(spec.kind)}" is not a shape. The shapes are ${SHAPE_KINDS.join(", ")}.`);
  }
  const axis = spec.axis ?? "y";
  if (!(SHAPE_AXES as readonly string[]).includes(axis)) {
    throw new ShapeError(`"${String(axis)}" is not an axis. A cylinder stands along x, y or z.`);
  }
  const corners = [spec.box.minX, spec.box.minY, spec.box.minZ, spec.box.maxX, spec.box.maxY, spec.box.maxZ];
  if (!corners.every((value) => Number.isInteger(value))) {
    throw new ShapeError("A shape's box is given in whole blocks.");
  }
  const thickness = spec.thickness ?? 1;
  if (!Number.isInteger(thickness) || thickness < 1 || thickness > MAX_SHAPE_THICKNESS) {
    throw new ShapeError(`A shell is a whole number of blocks thick, from 1 to ${MAX_SHAPE_THICKNESS}.`);
  }
  return {
    kind: spec.kind,
    box: orderBox(spec.box),
    axis,
    hollow: spec.kind === "walls" || spec.hollow === true,
    thickness,
  };
}

/** The axes a shell is measured across. See the header for why they differ. */
export function hollowAxes(shape: Shape): readonly ShapeAxis[] {
  switch (shape.kind) {
    case "sphere":
    case "box":
      return SHAPE_AXES;
    case "cylinder":
      return SHAPE_AXES.filter((axis) => axis !== shape.axis);
    case "pyramid":
    case "walls":
      return ["x", "z"];
  }
}

/**
 * Whether a cell is in the solid shape. Any cell, inside the box or not.
 *
 * The sphere and the cylinder measure from the box's middle in units of half
 * its size: `(2 * (p - min) - (n - 1)) / n` runs from just over -1 to just
 * under 1 across the box, and is WorldEdit's `x / (r + 0.5)` when `n` is
 * `2r + 1`. No cell of an odd box lands exactly on the surface -- the squares
 * it sums are odd over odd -- so inclusive or not decides nothing there.
 */
export function shapeContains(shape: Shape): (x: number, y: number, z: number) => boolean {
  const { minX, minY, minZ, maxX, maxY, maxZ } = shape.box;
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const l = maxZ - minZ + 1;
  const inBox = (x: number, y: number, z: number): boolean =>
    x >= minX && x <= maxX && y >= minY && y <= maxY && z >= minZ && z <= maxZ;
  const across = (p: number, min: number, n: number): number => {
    const u = (2 * (p - min) - (n - 1)) / n;
    return u * u;
  };
  switch (shape.kind) {
    case "box":
    case "walls":
      return inBox;
    case "sphere":
      return (x, y, z) => inBox(x, y, z) && across(x, minX, w) + across(y, minY, h) + across(z, minZ, l) <= 1;
    case "cylinder":
      if (shape.axis === "x") return (x, y, z) => inBox(x, y, z) && across(y, minY, h) + across(z, minZ, l) <= 1;
      if (shape.axis === "z") return (x, y, z) => inBox(x, y, z) && across(x, minX, w) + across(y, minY, h) <= 1;
      return (x, y, z) => inBox(x, y, z) && across(x, minX, w) + across(z, minZ, l) <= 1;
    case "pyramid":
      return (x, y, z) => {
        if (!inBox(x, y, z)) return false;
        const layer = y - minY;
        return Math.min(x - minX, maxX - x) >= layer && Math.min(z - minZ, maxZ - z) >= layer;
      };
  }
}

/** The cells of a shape inside a window, as a mask over the window. */
export interface ShapeCells {
  /** The part of the box the mask covers, or `null` when the two share nothing. */
  window: Box | null;
  /** One byte per cell of the window, x then y then z; 1 is in the shape. */
  mask: Uint8Array;
  count: number;
}

/**
 * The cells of `spec`, inside `window` when one is given.
 *
 * Three passes over one buffer: the solid, then the shell marked as 2 -- a
 * look at a neighbour reads anything non-zero as solid, so marking in place
 * does not disturb the passes still to come -- then the shell kept.
 */
export function shapeCells(spec: ShapeSpec | Shape, window: Box | null = null): ShapeCells {
  const shape = normalizeShape(spec);
  const win = window === null ? shape.box : intersectBox(shape.box, orderBox(window));
  if (win === null) return { window: null, mask: new Uint8Array(0), count: 0 };

  const w = win.maxX - win.minX + 1;
  const h = win.maxY - win.minY + 1;
  const l = win.maxZ - win.minZ + 1;
  const plane = h * l;
  const mask = new Uint8Array(w * plane);
  const contains = shapeContains(shape);

  let count = 0;
  for (let x = 0; x < w; x += 1) {
    for (let y = 0; y < h; y += 1) {
      const row = x * plane + y * l;
      for (let z = 0; z < l; z += 1) {
        if (contains(win.minX + x, win.minY + y, win.minZ + z)) {
          mask[row + z] = 1;
          count += 1;
        }
      }
    }
  }
  if (!shape.hollow) return { window: win, mask, count };

  const solidAt = (x: number, y: number, z: number): boolean => {
    const ix = x - win.minX;
    const iy = y - win.minY;
    const iz = z - win.minZ;
    if (ix < 0 || iy < 0 || iz < 0 || ix >= w || iy >= h || iz >= l) return contains(x, y, z);
    return mask[ix * plane + iy * l + iz] !== 0;
  };
  const t = shape.thickness;
  const steps = hollowAxes(shape).flatMap((axis): [number, number, number][] =>
    axis === "x"
      ? [[t, 0, 0], [-t, 0, 0]]
      : axis === "y"
        ? [[0, t, 0], [0, -t, 0]]
        : [[0, 0, t], [0, 0, -t]],
  );
  for (let x = 0; x < w; x += 1) {
    for (let y = 0; y < h; y += 1) {
      const row = x * plane + y * l;
      for (let z = 0; z < l; z += 1) {
        if (mask[row + z] === 0) continue;
        const cx = win.minX + x;
        const cy = win.minY + y;
        const cz = win.minZ + z;
        for (const [dx, dy, dz] of steps) {
          if (!solidAt(cx + dx, cy + dy, cz + dz)) {
            mask[row + z] = 2;
            break;
          }
        }
      }
    }
  }
  count = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i] === 2) {
      mask[i] = 1;
      count += 1;
    } else {
      mask[i] = 0;
    }
  }
  return { window: win, mask, count };
}

/** Every cell of a `ShapeCells`, in its fixed order: x, then y, then z. */
export function forEachShapeCell(cells: ShapeCells, visit: (x: number, y: number, z: number) => void): void {
  const win = cells.window;
  if (win === null) return;
  const h = win.maxY - win.minY + 1;
  const l = win.maxZ - win.minZ + 1;
  let i = 0;
  for (let x = win.minX; x <= win.maxX; x += 1) {
    for (let y = win.minY; y < win.minY + h; y += 1) {
      for (let z = win.minZ; z < win.minZ + l; z += 1) {
        if (cells.mask[i] === 1) visit(x, y, z);
        i += 1;
      }
    }
  }
}

/** What an undo label calls a shape. */
export function shapeLabel(shape: Shape): string {
  if (shape.kind === "walls") return "walls";
  const name = shape.kind === "sphere" && !isCubic(shape.box) ? "ellipsoid" : shape.kind;
  return shape.hollow ? `hollow ${name}` : name;
}

function isCubic(box: Box): boolean {
  const w = box.maxX - box.minX;
  return w === box.maxY - box.minY && w === box.maxZ - box.minZ;
}
