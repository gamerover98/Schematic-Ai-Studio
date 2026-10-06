/**
 * A picture of a distribution: the field it reads, and the blocks it gives.
 *
 * The parameters beside a mix -- frequency, octaves, persistence, a Voronoi
 * cell's size -- are numbers nobody can picture, and the only way to see what
 * one did was to fill and look. This draws one plane of the field over a box,
 * and which block each cell of that plane would get.
 *
 * ## The same answer the hand gets
 *
 * Each pixel is a cell, sampled where `cellValues` samples it, and its block is
 * decided by `cutsFor` over the same frame -- which is what `pickAt` does for a
 * block placed by hand. A fill meets the shares exactly by ranking every cell
 * it writes; the cuts are a sample of that ranking, so the map's shares come
 * within a few percent of the fill's and the pattern is the fill's, cell for
 * cell, wherever no cut falls between two neighbours.
 *
 * ## The planes
 *
 * Named by the two axes they show, across and then down: `xz` from above with
 * north at the top, `xy` from the south, `zy` from the west. Up is up in both
 * side views, so their rows run from the top of the frame down.
 *
 * In `shared/` because both processes draw one: the panel beside the mix, and
 * `preview_distribution` over MCP.
 */

import { cellValues, cutsFor, effectiveShares, type BlockMix } from "./block_mix.js";
import type { Box } from "./regions.js";

export type MapPlane = "xz" | "xy" | "zy";

export const MAP_PLANES: readonly MapPlane[] = ["xz", "xy", "zy"];

/** Pixels per side at most. A frame wider than this is sampled, not shrunk. */
export const MAP_MAX_SIZE = 128;

type Axis = "x" | "y" | "z";

/** Across, down, and the axis the plane cuts. */
const PLANE_AXES: Readonly<Record<MapPlane, readonly [Axis, Axis, Axis]>> = {
  xz: ["x", "z", "y"],
  xy: ["x", "y", "z"],
  zy: ["z", "y", "x"],
};

export interface MapRequest {
  readonly mix: BlockMix;
  /** What the map shows, and what the shares are taken over. */
  readonly frame: Box;
  readonly plane: MapPlane;
  /** Where the plane cuts the frame, along its third axis. Clamped into it. */
  readonly level: number;
  /** Pixels per side at most; `MAP_MAX_SIZE` when left out. */
  readonly maxSize?: number;
}

export interface DistributionMap {
  readonly width: number;
  readonly height: number;
  /** The field's value at each pixel, row by row from the top. */
  readonly values: Float32Array;
  readonly min: number;
  readonly max: number;
  /** Which entry of the mix each pixel gets. */
  readonly entries: Uint8Array;
  /** How many pixels each entry got. */
  readonly counts: readonly number[];
  /** The coordinate each column stands for, along `across`. */
  readonly columns: readonly number[];
  /** The coordinate each row stands for, along `down`. */
  readonly rows: readonly number[];
  readonly across: Axis;
  readonly down: Axis;
  /** The axis the plane cuts, and where, after clamping. */
  readonly cut: Axis;
  readonly level: number;
}

function low(frame: Box, axis: Axis): number {
  return axis === "x" ? frame.minX : axis === "y" ? frame.minY : frame.minZ;
}

function high(frame: Box, axis: Axis): number {
  return axis === "x" ? frame.maxX : axis === "y" ? frame.maxY : frame.maxZ;
}

/** The axis a plane cuts, and the range of levels it can cut at. */
export function levelRange(frame: Box, plane: MapPlane): { axis: Axis; min: number; max: number } {
  const axis = PLANE_AXES[plane][2];
  return { axis, min: low(frame, axis), max: high(frame, axis) };
}

/**
 * The cells a side of `count` pixels stands for, spread evenly over the span.
 * `cutsFor`'s own spacing, so a frame narrower than the limit is every cell.
 */
function sampleAxis(min: number, max: number, limit: number): number[] {
  const span = max - min + 1;
  const count = Math.max(1, Math.min(limit, span));
  return Array.from({ length: count }, (_unused, i) => min + Math.floor(((i + 0.5) * span) / count));
}

export function distributionMap(request: MapRequest): DistributionMap {
  const { mix, frame, plane } = request;
  const limit = Math.max(1, Math.floor(request.maxSize ?? MAP_MAX_SIZE));
  const [across, down, cut] = PLANE_AXES[plane];
  const range = levelRange(frame, plane);
  const level = Math.min(range.max, Math.max(range.min, Math.round(request.level)));

  const columns = sampleAxis(low(frame, across), high(frame, across), limit);
  const ascending = sampleAxis(low(frame, down), high(frame, down), limit);
  // Up is up: a side view's top row is the top of the frame.
  const rows = down === "y" ? ascending.reverse() : ascending;

  const value = cellValues(mix.distribution);
  const cuts = mix.entries.length > 1 ? cutsFor(mix.distribution, effectiveShares(mix.entries), frame) : [];
  const width = columns.length;
  const height = rows.length;
  const values = new Float32Array(width * height);
  const entries = new Uint8Array(width * height);
  const counts = mix.entries.map(() => 0);
  let min = Infinity;
  let max = -Infinity;
  const cell = { x: 0, y: 0, z: 0 };
  cell[cut] = level;

  for (let row = 0; row < height; row += 1) {
    cell[down] = rows[row];
    for (let column = 0; column < width; column += 1) {
      cell[across] = columns[column];
      const v = value(cell.x, cell.y, cell.z);
      // `pickAt`'s loop exactly: the first cut the value is under, else the last.
      let entry = cuts.length;
      for (let i = 0; i < cuts.length; i += 1) {
        if (v < cuts[i]) {
          entry = i;
          break;
        }
      }
      const at = row * width + column;
      values[at] = v;
      entries[at] = entry;
      if (counts.length > 0) counts[entry] += 1;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return { width, height, values, min, max, entries, counts, columns, rows, across, down, cut, level };
}

/**
 * A colour per entry for when the blocks' own are not to hand -- the MCP
 * picture, and a block whose icon has not been drawn yet.
 *
 * Tableau 10, because it was made for exactly this: ten categories told apart
 * at a glance, including by most people with a colour deficiency. A mix of
 * more than ten cycles.
 */
export const CATEGORY_COLOURS: readonly (readonly [number, number, number])[] = [
  [78, 121, 167],
  [242, 142, 43],
  [225, 87, 89],
  [118, 183, 178],
  [89, 161, 79],
  [237, 201, 72],
  [176, 122, 161],
  [255, 157, 167],
  [156, 117, 95],
  [186, 176, 172],
];

export function categoryColour(index: number): readonly [number, number, number] {
  return CATEGORY_COLOURS[index % CATEGORY_COLOURS.length];
}

/** The field in grey, darkest at its lowest value. Opaque RGBA, row by row. */
export function valuePixels(map: DistributionMap): Uint8ClampedArray {
  const out = new Uint8ClampedArray(map.width * map.height * 4);
  const span = map.max - map.min;
  for (let i = 0; i < map.values.length; i += 1) {
    const grey = span > 0 ? Math.round((255 * (map.values[i] - map.min)) / span) : 128;
    out[i * 4] = grey;
    out[i * 4 + 1] = grey;
    out[i * 4 + 2] = grey;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * The field and the blocks side by side, for a reader who gets one picture:
 * each cell `scale` pixels square, the two `scale` pixels apart on a dark
 * ground. Opaque RGBA, row by row.
 */
export function mapPicture(
  map: DistributionMap,
  colour: (index: number) => readonly [number, number, number],
  scale: number,
): { width: number; height: number; data: Uint8ClampedArray } {
  const s = Math.max(1, Math.floor(scale));
  const gap = s;
  const width = map.width * s * 2 + gap;
  const height = map.height * s;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = 32;
    data[i * 4 + 1] = 32;
    data[i * 4 + 2] = 32;
    data[i * 4 + 3] = 255;
  }
  const halves: readonly [Uint8ClampedArray, number][] = [
    [valuePixels(map), 0],
    [entryPixels(map, colour), map.width * s + gap],
  ];
  for (const [pixels, left] of halves) {
    for (let y = 0; y < height; y += 1) {
      const row = Math.floor(y / s);
      for (let x = 0; x < map.width * s; x += 1) {
        const from = (row * map.width + Math.floor(x / s)) * 4;
        const to = (y * width + left + x) * 4;
        data[to] = pixels[from];
        data[to + 1] = pixels[from + 1];
        data[to + 2] = pixels[from + 2];
      }
    }
  }
  return { width, height, data };
}

/** Each pixel in its entry's colour. Opaque RGBA, row by row. */
export function entryPixels(
  map: DistributionMap,
  colour: (index: number) => readonly [number, number, number],
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(map.width * map.height * 4);
  const palette = map.counts.map((_count, index) => colour(index));
  for (let i = 0; i < map.entries.length; i += 1) {
    const [r, g, b] = palette[map.entries[i]] ?? categoryColour(map.entries[i]);
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  }
  return out;
}
