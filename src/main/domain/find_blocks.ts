/**
 * Where a set of blocks is, as the shell the viewport glows.
 *
 * A material clicked in the list lights up every cell holding it, through
 * walls, the way the game's Glowing effect outlines a mob behind a hill. The
 * viewport has no blocks -- it holds geometry with no per-block identity in it
 * -- so the cells are found here and handed over as **faces**: one per side of
 * a matching cell that does not touch another matching cell. A wall of stone
 * is then a slab's skin rather than every face of every block in it, which is
 * what keeps a highlight of the commonest block in a build a few hundred
 * thousand quads rather than millions.
 *
 * ## Faces, not cells
 *
 * Each face is four integers: the cell and the side. That is the smallest
 * thing the viewport can draw a quad from, and it crosses the process boundary
 * as one `Int32Array` -- a million and a half faces sent as vertex positions
 * would be about a hundred megabytes of structured clone.
 *
 * ## Content coordinates
 *
 * The cell is written minus `doc.frame`, the chunks' own frame (see
 * `SchematicDocument.frame`), so the viewport places the shell exactly where
 * it places the chunks. A growth below the origin moves the frame and not the
 * content, so a shell drawn before the growth stays on its blocks until the
 * next answer arrives.
 *
 * ## The set of cells
 *
 * Patterns are `matchesBlockPattern`'s, the rule a replace uses: a bare id is
 * the block in any state, a stated one exactly that state. The match is
 * decided once per palette entry and read per cell. A cell outside the
 * counted union is not part of the set, so a highlight of a selection ends at
 * its edge with a face, even where the block carries on past it.
 */

import { boxContains, forEachUnionCell, type Box } from "../../shared/regions.js";
import { matchesBlockPattern, type PaletteEntry } from "../pipeline/types.js";
import type { SchematicDocument } from "./document.js";

/**
 * The six sides, in the order the viewport's shader reads `dir`: east, west,
 * up, down, south, north. A face of side `d` lies on the cell's boundary in
 * that direction.
 */
export const FACE_STEPS: readonly (readonly [number, number, number])[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/**
 * How many faces one answer may carry.
 *
 * Sixteen bytes each, so 4.8 MB at the cap, which is what one structured
 * clone may reasonably cost. Past it the shell is drawn in coarser cells
 * (`scale`) rather than cut off, and the cells are still counted.
 */
export const MAX_GLOW_FACES = 300_000;

export interface FoundBlocks {
  /** How many cells match, inside the cells asked about. */
  total: number;
  /** The smallest box holding every match, in document coordinates. */
  bounds: Box | null;
  /**
   * Four integers a face: the corner of its cell in content coordinates,
   * then the side. A cell is `scale` blocks a side.
   */
  faces: Int32Array;
  /**
   * How many blocks a side the shell's cells are: 1, or 2, 4... up to
   * `MAX_GLOW_SCALE` when one block at a time came to more than `maxFaces`.
   */
  scale: number;
  /** Faces were left out even at `MAX_GLOW_SCALE`; `total` still counts every cell. */
  capped: boolean;
  /** The first matching cells, in document coordinates, in walk order. */
  positions: [number, number, number][];
}

export interface FindOptions {
  /** Build the shell; `false` only counts. */
  faces?: boolean;
  maxFaces?: number;
  /** How many positions to report. */
  positions?: number;
}

/**
 * Finds `patterns` in the union of `boxes` -- each already cut to the
 * document -- or in the whole document when `boxes` is `null`.
 */
export function findBlocks(
  doc: SchematicDocument,
  boxes: readonly Box[] | null,
  patterns: readonly PaletteEntry[],
  options: FindOptions = {},
): FoundBlocks {
  const wantFaces = options.faces !== false;
  const maxFaces = options.maxFaces ?? MAX_GLOW_FACES;
  const maxPositions = options.positions ?? 0;
  const empty: FoundBlocks = { total: 0, bounds: null, faces: new Int32Array(0), scale: 1, capped: false, positions: [] };

  const entries = doc.palette;
  const match = new Uint8Array(entries.length);
  let present = false;
  entries.forEach((entry, index) => {
    if (!patterns.some((pattern) => matchesBlockPattern(entry, pattern))) return;
    match[index] = 1;
    if ((doc.counts[index] ?? 0) > 0) present = true;
  });
  // The ordinary answer for a block the document does not hold: no walk.
  if (!present) return empty;

  const { width, height, length, voxels } = doc;
  const plane = height * length;
  const [fx, fy, fz] = doc.frame;
  const inUnion =
    boxes === null
      ? null
      : (x: number, y: number, z: number): boolean => {
          for (let b = 0; b < boxes.length; b += 1) if (boxContains(boxes[b], x, y, z)) return true;
          return false;
        };

  const shell = new FaceBuffer(wantFaces ? maxFaces : 0);
  let total = 0;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  const positions: [number, number, number][] = [];

  const visit = (x: number, y: number, z: number, at: number): void => {
    if (match[voxels[at]] !== 1) return;
    total += 1;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
    if (positions.length < maxPositions) positions.push([x, y, z]);
    if (!wantFaces || shell.full) return;
    for (let side = 0; side < 6; side += 1) {
      const step = FACE_STEPS[side];
      const nx = x + step[0];
      const ny = y + step[1];
      const nz = z + step[2];
      const inside = nx >= 0 && ny >= 0 && nz >= 0 && nx < width && ny < height && nz < length;
      // A face is drawn where the set ends: past the document, at a cell that
      // does not match, or at the edge of the cells asked about.
      if (inside && match[voxels[nx * plane + ny * length + nz]] === 1 && (inUnion === null || inUnion(nx, ny, nz))) {
        continue;
      }
      if (!shell.push(x - fx, y - fy, z - fz, side)) return;
    }
  };

  /** Every cell asked about, in the walk the fill takes. */
  const walk = (each: (x: number, y: number, z: number, at: number) => void): void => {
    if (boxes === null) {
      for (let x = 0; x < width; x += 1) {
        for (let y = 0; y < height; y += 1) {
          const row = x * plane + y * length;
          for (let z = 0; z < length; z += 1) each(x, y, z, row + z);
        }
      }
    } else {
      forEachUnionCell(boxes, (x, y, z) => each(x, y, z, x * plane + y * length + z));
    }
  };
  walk(visit);

  const found = {
    total,
    bounds: total === 0 ? null : { minX, minY, minZ, maxX, maxY, maxZ },
    positions,
  };
  if (!shell.full) return { ...found, faces: shell.take(), scale: 1, capped: false };

  /*
   * Too many faces to outline one block at a time -- the ground of a big
   * terrain, a field of scattered ore. Cut off at the cap, the glow lit the
   * first part of the walk and left the rest dark, which reads as a fault
   * rather than a limit. So the set is drawn again in cells of two blocks,
   * then four, until it fits: a coarser outline of all of it, which is what a
   * glow over that much is for anyway.
   *
   * A coarse cell holds the set when any block in it does, and the cells
   * asked about are left to the fine walk: at two blocks and up the edge of a
   * selection is approximate.
   */
  let scale = 2;
  let gw = Math.ceil(width / scale);
  let gh = Math.ceil(height / scale);
  let gl = Math.ceil(length / scale);
  let grid = new Uint8Array(gw * gh * gl);
  walk((x, y, z, at) => {
    if (match[voxels[at]] === 1) grid[(x >> 1) * gh * gl + (y >> 1) * gl + (z >> 1)] = 1;
  });
  for (;;) {
    const coarse = gridShell(grid, gw, gh, gl, scale, doc.frame, maxFaces);
    if (!coarse.full || scale >= MAX_GLOW_SCALE) {
      return { ...found, faces: coarse.take(), scale, capped: coarse.full };
    }
    const next = { w: Math.ceil(gw / 2), h: Math.ceil(gh / 2), l: Math.ceil(gl / 2) };
    const halved = new Uint8Array(next.w * next.h * next.l);
    for (let x = 0; x < gw; x += 1) {
      for (let y = 0; y < gh; y += 1) {
        for (let z = 0; z < gl; z += 1) {
          if (grid[x * gh * gl + y * gl + z] === 1) halved[(x >> 1) * next.h * next.l + (y >> 1) * next.l + (z >> 1)] = 1;
        }
      }
    }
    grid = halved;
    gw = next.w;
    gh = next.h;
    gl = next.l;
    scale *= 2;
  }
}

/** The coarsest cell the glow is drawn in: past it the outline means nothing. */
export const MAX_GLOW_SCALE = 16;

/** The shell of a grid of coarse cells, each `scale` blocks a side. */
function gridShell(
  grid: Uint8Array,
  gw: number,
  gh: number,
  gl: number,
  scale: number,
  frame: readonly [number, number, number],
  maxFaces: number,
): FaceBuffer {
  const shell = new FaceBuffer(maxFaces);
  const plane = gh * gl;
  for (let x = 0; x < gw; x += 1) {
    for (let y = 0; y < gh; y += 1) {
      for (let z = 0; z < gl; z += 1) {
        if (grid[x * plane + y * gl + z] !== 1) continue;
        for (let side = 0; side < 6; side += 1) {
          const step = FACE_STEPS[side];
          const nx = x + step[0];
          const ny = y + step[1];
          const nz = z + step[2];
          const inside = nx >= 0 && ny >= 0 && nz >= 0 && nx < gw && ny < gh && nz < gl;
          if (inside && grid[nx * plane + ny * gl + nz] === 1) continue;
          if (!shell.push(x * scale - frame[0], y * scale - frame[1], z * scale - frame[2], side)) return shell;
        }
      }
    }
  }
  return shell;
}

/**
 * Faces, four integers each, in a buffer that grows by doubling up to a cap.
 * `full` once a push was refused: the shell is then incomplete.
 */
class FaceBuffer {
  private data: Int32Array;
  private count = 0;
  full = false;

  constructor(private readonly cap: number) {
    this.data = new Int32Array(Math.min(cap, 4096) * 4);
  }

  push(x: number, y: number, z: number, side: number): boolean {
    if (this.count >= this.cap) {
      this.full = true;
      return false;
    }
    if ((this.count + 1) * 4 > this.data.length) {
      const grown = new Int32Array(Math.min(this.cap * 4, this.data.length * 2));
      grown.set(this.data);
      this.data = grown;
    }
    const o = this.count * 4;
    this.data[o] = x;
    this.data[o + 1] = y;
    this.data[o + 2] = z;
    this.data[o + 3] = side;
    this.count += 1;
    return true;
  }

  take(): Int32Array {
    return this.data.slice(0, this.count * 4);
  }
}
