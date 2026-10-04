/**
 * Terrain as a height for every column, from a noise and nothing else.
 *
 * A terrain is a surface: for each column `(x, z)` the height of its top
 * block, `top(x, z)`. Everything below the top is ground, in three layers --
 * one block of surface, a few of subsoil, then rock -- and everything above it
 * is empty space. `main/domain/terrain.ts` writes it; the panel and the brush's
 * ghost draw it from this file, so a ghost and an edit cannot disagree.
 *
 * ## The surface is a function of where the column is
 *
 * The height is read from the noise at the column's own coordinates, the way
 * a mix's distribution is (`cellValues`, at the centre of the cell, with y
 * fixed). So the same settings over two areas side by side are one landscape
 * across the seam, and a brush that paints terrain in touch by touch reveals
 * one surface rather than piling hills on each other: a touch where the
 * terrain already is changes nothing.
 *
 * ## Base and relief, not a scale nobody can picture
 *
 * The noise's raw values have a range that depends on its kind and its
 * parameters -- a fractal sum of three octaves rarely leaves [-0.5, 0.5], a
 * Voronoi patch is anywhere in [0, 1) -- so `base + amplitude * noise` would
 * mean a different height for every setting. Each noise is therefore
 * **calibrated** once: sampled on a wide lattice in its own units, and its
 * half-percentile and its 99.5th taken as the bottom and the top. The surface
 * then runs from `base` up to `base + amplitude`, which is the sentence the
 * panel can say.
 *
 * The lattice is spaced in the noise's own units (a frequency's reciprocal, a
 * Voronoi cell's size), so the calibration depends on the settings and never
 * on the area being written: an area-relative stretch would put a seam
 * between two touches of the brush.
 *
 * In `shared/` because both processes read it: main writes the terrain, the
 * renderer draws its heights before anything is written.
 */

import {
  cellValues,
  DISTRIBUTION_PARAMS,
  formatDistribution,
  MixSyntaxError,
  normalizeDistribution,
  type Distribution,
  type ParamValue,
} from "./block_mix.js";
import type { Box } from "./regions.js";

export class TerrainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TerrainError";
  }
}

/**
 * The noises a terrain can be made of.
 *
 * The coherent ones only. `random` is a bed of nails -- every column on its
 * own -- and `gradient`'s value is a position in blocks, which calibrates to
 * nothing: there is no bottom and top to a coordinate.
 */
export const TERRAIN_NOISES = ["perlin", "simplex", "ridged", "voronoi"] as const;
export type TerrainNoise = (typeof TERRAIN_NOISES)[number];

/**
 * How a terrain meets what is already there.
 *
 * - `set`: the column becomes the terrain -- ground up to the surface, empty
 *   space above it. Raising and digging at once.
 * - `raise`: only empty cells under the surface are filled. Nothing is taken
 *   away, so a hill can be added round a build without touching it.
 * - `dig`: only what stands above the surface is taken away. Nothing is added.
 */
export const TERRAIN_MODES = ["set", "raise", "dig"] as const;
export type TerrainMode = (typeof TERRAIN_MODES)[number];

/** Where the surface may start, in blocks. A schematic's floor is 0. */
export const TERRAIN_BASE = { min: -256, max: 1024 } as const;
/** How far it may rise above that. Zero is a flat ground at the base. */
export const TERRAIN_AMPLITUDE = { min: 0, max: 256 } as const;
/** How many blocks of subsoil lie under the surface block. */
export const SUBSOIL_DEPTH = { min: 0, max: 32 } as const;

export interface HeightField {
  /** One of `TERRAIN_NOISES`, with its seed and parameters. */
  readonly noise: Distribution;
  /** The lowest the surface goes: its top block's y. */
  readonly base: number;
  /** How much higher the highest part of it is. */
  readonly amplitude: number;
}

/**
 * Rolling ground: Perlin noise, four octaves, a hill every thirty blocks or
 * so, a dozen blocks of relief a little above the floor.
 *
 * The frequency is lower than a mix's default (0.08), which is a pattern of
 * patches a dozen blocks across -- right for moss on a wall, and a field of
 * molehills as a landscape.
 */
export const DEFAULT_HEIGHT_FIELD: HeightField = {
  noise: { kind: "perlin", seed: 1, params: { frequency: 0.03, octaves: 4 } },
  base: 4,
  amplitude: 12,
};

function isTerrainNoise(kind: string): kind is TerrainNoise {
  return (TERRAIN_NOISES as readonly string[]).includes(kind);
}

function wholeIn(raw: unknown, range: { readonly min: number; readonly max: number }, what: string): number {
  const value = Number(raw);
  if (typeof raw === "boolean" || raw === null || raw === "" || !Number.isFinite(value)) {
    throw new TerrainError(`${what} has to be a number, not ${String(raw)}.`);
  }
  return Math.min(range.max, Math.max(range.min, Math.round(value)));
}

/**
 * A height field as it arrives -- off the wire, out of a model, out of a
 * settings file -- checked: a noise this build has and a terrain can use,
 * whole numbers for the base and the relief, clamped into range.
 */
export function normalizeHeightField(raw: {
  noise: { kind: string; seed?: unknown; params?: Readonly<Record<string, ParamValue>> };
  base?: unknown;
  amplitude?: unknown;
}): HeightField {
  const kind = String(raw.noise?.kind ?? "").toLowerCase();
  if (!isTerrainNoise(kind)) {
    throw new TerrainError(`#${String(raw.noise?.kind)} is not a noise a terrain can be made of. The ones there are: ${TERRAIN_NOISES.join(", ")}.`);
  }
  let noise: Distribution;
  try {
    noise = normalizeDistribution({ ...raw.noise, kind });
  } catch (err) {
    if (err instanceof MixSyntaxError) throw new TerrainError(err.message);
    throw err;
  }
  return {
    noise,
    base: wholeIn(raw.base ?? DEFAULT_HEIGHT_FIELD.base, TERRAIN_BASE, "The base"),
    amplitude: wholeIn(raw.amplitude ?? DEFAULT_HEIGHT_FIELD.amplitude, TERRAIN_AMPLITUDE, "The amplitude"),
  };
}

/** Samples per side of the calibration lattice: 2304 values, once per noise. */
const CALIBRATION_SIDE = 48;
/**
 * The lattice's spacing in the noise's own units. Not a whole number, so the
 * samples do not keep landing on the same phase of the lattice the noise is
 * built on, and wide enough that neighbouring samples are nearly independent.
 */
const CALIBRATION_STEP = 1.618;
/** The share of columns, at each end, that a calibrated surface clips flat. */
const CALIBRATION_TAIL = 0.005;

const calibrations = new Map<string, { lo: number; hi: number }>();

/** How many blocks one unit of the noise's own lattice is. */
function noiseUnit(noise: Distribution): number {
  const read = (key: string): number => {
    const spec = DISTRIBUTION_PARAMS[noise.kind].find((candidate) => candidate.key === key);
    const value = noise.params?.[key] ?? (spec?.type === "number" ? spec.default : 1);
    return Number(value);
  };
  if (noise.kind === "voronoi") return read("size");
  return 1 / read("frequency");
}

/**
 * The bottom and the top of a noise's values, as the surface reads them.
 *
 * Exported for the tests, which hold a surface between its two ends.
 */
export function calibrate(noise: Distribution): { lo: number; hi: number } {
  const key = formatDistribution(noise) || `#${noise.kind}`;
  const held = calibrations.get(key);
  if (held !== undefined) return held;
  const values = cellValues(noise);
  const spacing = noiseUnit(noise) * CALIBRATION_STEP;
  const sample = new Float64Array(CALIBRATION_SIDE * CALIBRATION_SIDE);
  let at = 0;
  for (let i = 0; i < CALIBRATION_SIDE; i += 1) {
    for (let j = 0; j < CALIBRATION_SIDE; j += 1) {
      sample[at++] = values(Math.floor(i * spacing), 0, Math.floor(j * spacing));
    }
  }
  sample.sort();
  const lo = sample[Math.floor(CALIBRATION_TAIL * sample.length)];
  const hi = sample[Math.ceil((1 - CALIBRATION_TAIL) * sample.length) - 1];
  const made = { lo, hi };
  // A handful of noises are live at once; a map that only grows is a leak.
  if (calibrations.size >= 64) calibrations.clear();
  calibrations.set(key, made);
  return made;
}

/**
 * The surface: for a column, the y of its top block.
 *
 * Between `base` and `base + amplitude`, both included. The noise is read at
 * y = 0 -- a terrain is a two-dimensional answer to a three-dimensional
 * noise, and any fixed plane is as good as another.
 *
 * `frame` is the document's `DocumentState.frame`, and the noise is read at
 * the column's place in the *content* (`x - frame[0]`), not in the grid. A
 * touch of the brush past the low edge grows the schematic and moves every
 * block in it; read in the grid, the landscape would stay where it was while
 * the ground already painted moved, and the next touch would meet it with a
 * cliff the size of the growth.
 */
export function heightField(
  field: HeightField,
  frame: readonly [number, number, number] = [0, 0, 0],
): (x: number, z: number) => number {
  const values = cellValues(field.noise);
  const { lo, hi } = calibrate(field.noise);
  const span = hi - lo;
  const { base, amplitude } = field;
  const [fx, , fz] = frame;
  return (x, z) => {
    if (amplitude === 0 || !(span > 0)) return base;
    const t = (values(x - fx, 0, z - fz) - lo) / span;
    return base + Math.round(amplitude * (t < 0 ? 0 : t > 1 ? 1 : t));
  };
}

export type TerrainLayer = "above" | "surface" | "subsoil" | "rock";

/**
 * Which layer a cell of a column belongs to, given the column's top.
 *
 * The top block is the surface, the `subsoilDepth` under it are subsoil, the
 * rest is rock. What a fill of grass, dirt and stone looks like when you cut
 * through a hill.
 */
export function terrainLayer(y: number, top: number, subsoilDepth: number): TerrainLayer {
  const depth = top - y;
  if (depth < 0) return "above";
  if (depth === 0) return "surface";
  return depth <= subsoilDepth ? "subsoil" : "rock";
}

/**
 * What a brush covers seen from above: a disc, or a square.
 *
 * The disc is WorldEdit's cylinder (`//cyl`): a column is in when
 * `(dx / (r + 0.5))^2 + (dz / (r + 0.5))^2 <= 1`, which is the cylinder
 * `shapes.ts` inscribes in the square `2r + 1` across. Radius 0 is one column.
 */
export const FOOTPRINTS = ["disc", "square"] as const;
export type Footprint = (typeof FOOTPRINTS)[number];

/**
 * How far a terrain brush reaches from the cell aimed at, in blocks: 64 is a
 * square 129 across. The creative tools offer up to `BRUSH_RADIUS`; this is
 * what the wire accepts, from a client that may ask for more.
 */
export const TOOL_REACH = { min: 0, max: 64 } as const;

export function inFootprint(footprint: Footprint, dx: number, dz: number, radius: number): boolean {
  if (Math.abs(dx) > radius || Math.abs(dz) > radius) return false;
  if (footprint === "square") return true;
  const r = radius + 0.5;
  return (dx * dx + dz * dz) / (r * r) <= 1;
}

/** The surface's heights over a frame seen from above, for a picture. */
export interface HeightMap {
  readonly width: number;
  readonly height: number;
  /** The top block's y at each pixel, row by row from the north. */
  readonly tops: Int32Array;
  readonly lowest: number;
  readonly highest: number;
}

/**
 * The surface over a frame's footprint, at most `maxSize` pixels a side.
 *
 * A frame wider than that is sampled, every pixel a column, with the spacing
 * `distribution_map.ts` uses, so a picture of a large area is the same
 * landscape at a coarser grain rather than a smaller one.
 */
export function heightMap(
  field: HeightField,
  frame: Box,
  maxSize = 128,
  origin: readonly [number, number, number] = [0, 0, 0],
): HeightMap {
  const axis = (min: number, max: number): number[] => {
    const span = max - min + 1;
    const count = Math.max(1, Math.min(maxSize, span));
    return Array.from({ length: count }, (_unused, i) => min + Math.floor(((i + 0.5) * span) / count));
  };
  const xs = axis(Math.min(frame.minX, frame.maxX), Math.max(frame.minX, frame.maxX));
  const zs = axis(Math.min(frame.minZ, frame.maxZ), Math.max(frame.minZ, frame.maxZ));
  const top = heightField(field, origin);
  const tops = new Int32Array(xs.length * zs.length);
  let lowest = Infinity;
  let highest = -Infinity;
  zs.forEach((z, row) => {
    xs.forEach((x, column) => {
      const value = top(x, z);
      tops[row * xs.length + column] = value;
      if (value < lowest) lowest = value;
      if (value > highest) highest = value;
    });
  });
  return { width: xs.length, height: zs.length, tops, lowest, highest };
}
