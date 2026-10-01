/**
 * Several blocks, each with a weight, and a rule for which goes where.
 *
 * WorldEdit's random pattern, `70%stone,30%andesite`, is the spelling, and it
 * is the one spelling: the selection's block fields write it, a hotbar slot
 * stores it, and a model may hand it to `fill_region`. A single block is a mix
 * of one and is written as the bare block, so every block string the app had
 * before this module is a mix already and nothing stored has to change.
 *
 * ## Weights, not percentages
 *
 * The number before `%` is a **weight**, normalised against the others, which
 * is what WorldEdit does with it too: `2%stone,1%dirt` is two thirds stone.
 * Demanding a sum of a hundred would make adding a third block an exercise in
 * arithmetic. The panel shows the share each weight comes to.
 *
 * ## The distribution
 *
 * Which cell gets which block is decided by the distribution, from the cell's
 * position in the document and a seed -- never by `Math.random` at the moment
 * of writing. So the same mix over the same cells is the same picture, and two
 * areas filled one after the other meet without a seam.
 *
 * In `shared/` because both processes read the spelling: the renderer to draw
 * the chips, main to fill.
 */

import { topLevel } from "./block_input.js";
import { cellHash01, fbm, noiseSeed, perlin3, ridged, simplex3, worley } from "./noise.js";
import type { Box } from "./regions.js";

export class MixSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MixSyntaxError";
  }
}

/** More than this is a palette, not a mix -- and a chip field nobody can read. */
export const MAX_MIX_ENTRIES = 32;

export interface MixEntry {
  /** The block as written: a name, states, a banner's patterns, `35:14`. */
  readonly block: string;
  /** Relative to the other entries' weights. Never negative. */
  readonly weight: number;
}

/**
 * How the cells are shared out.
 *
 * - `random`: every cell on its own, from a hash of where it is. Salt and
 *   pepper.
 * - `perlin`, `simplex`: fractal gradient noise, so a block comes in patches
 *   that run into each other -- moss on a wall, ore in stone.
 * - `ridged`: the same noise folded into ridges, which reads as veins and
 *   cracks.
 * - `voronoi`: cells around scattered points -- cobbles, crazy paving, or
 *   rings round the points, or the seams between them.
 * - `gradient`: along one axis, with a ragged edge, so the first block is at
 *   one end and the last at the other -- a wall weathering towards the top.
 */
export type DistributionKind = "random" | "perlin" | "simplex" | "ridged" | "voronoi" | "gradient";

export const DISTRIBUTION_KINDS: readonly DistributionKind[] = [
  "random",
  "perlin",
  "simplex",
  "ridged",
  "voronoi",
  "gradient",
];

export type ParamValue = number | string | boolean;

export interface Distribution {
  readonly kind: DistributionKind;
  readonly seed: number;
  /**
   * Only what was set: a parameter left out takes its default when the
   * distribution is evaluated, so a spelling carries no more than somebody
   * wrote and reads back as itself. `random` has none.
   */
  readonly params?: Readonly<Record<string, ParamValue>>;
}

export interface BlockMix {
  readonly entries: readonly MixEntry[];
  readonly distribution: Distribution;
}

export const DEFAULT_DISTRIBUTION: Distribution = { kind: "random", seed: 0 };

export type ParamSpec =
  | {
      readonly type: "number";
      readonly key: string;
      readonly default: number;
      readonly min: number;
      readonly max: number;
      readonly step: number;
      readonly integer?: boolean;
    }
  | { readonly type: "choice"; readonly key: string; readonly default: string; readonly options: readonly string[] }
  | { readonly type: "boolean"; readonly key: string; readonly default: boolean };

const FREQUENCY = (value: number): ParamSpec => ({
  type: "number",
  key: "frequency",
  default: value,
  min: 0.001,
  max: 1,
  step: 0.005,
});
const OCTAVES = (value: number): ParamSpec => ({ type: "number", key: "octaves", default: value, min: 1, max: 8, step: 1, integer: true });
const PERSISTENCE: ParamSpec = { type: "number", key: "persistence", default: 0.5, min: 0, max: 1, step: 0.05 };
const LACUNARITY: ParamSpec = { type: "number", key: "lacunarity", default: 2, min: 1, max: 4, step: 0.1 };
const GRAIN: ParamSpec = { type: "number", key: "grain", default: 0, min: 0, max: 1, step: 0.05 };

/**
 * What each distribution takes, with its default and its range.
 *
 * **There is no amplitude**, and that is the arithmetic rather than an
 * omission: the shares are met exactly by ranking the values, and a ranking
 * does not change when every value is multiplied by the same number. What an
 * amplitude does inside a fractal sum -- how much each finer octave counts
 * against the one before -- is `persistence`, and the spelling accepts
 * `amplitude` as another name for it.
 *
 * `grain` mixes white noise into the field, which roughens the edges between
 * blocks without moving the patches.
 */
export const DISTRIBUTION_PARAMS: Readonly<Record<DistributionKind, readonly ParamSpec[]>> = {
  random: [],
  perlin: [FREQUENCY(0.08), OCTAVES(3), PERSISTENCE, LACUNARITY, GRAIN],
  simplex: [FREQUENCY(0.08), OCTAVES(3), PERSISTENCE, LACUNARITY, GRAIN],
  ridged: [
    FREQUENCY(0.05),
    OCTAVES(4),
    PERSISTENCE,
    LACUNARITY,
    { type: "number", key: "gain", default: 2, min: 0, max: 4, step: 0.1 },
    { type: "number", key: "offset", default: 1, min: 0, max: 2, step: 0.05 },
    GRAIN,
  ],
  voronoi: [
    { type: "number", key: "size", default: 8, min: 1, max: 128, step: 1 },
    { type: "number", key: "jitter", default: 1, min: 0, max: 1, step: 0.05 },
    { type: "choice", key: "mode", default: "patches", options: ["patches", "distance", "edges"] },
    GRAIN,
  ],
  gradient: [
    { type: "choice", key: "axis", default: "y", options: ["x", "y", "z"] },
    { type: "boolean", key: "reverse", default: false },
    { type: "number", key: "edge", default: 2, min: 0, max: 32, step: 0.5 },
    FREQUENCY(0.1),
    { type: "number", key: "grain", default: 0, min: 0, max: 16, step: 0.5 },
  ],
};

/** Other names a parameter is written under. */
const PARAM_ALIASES: Readonly<Record<string, string>> = { amplitude: "persistence" };

function isKind(kind: string): kind is DistributionKind {
  return (DISTRIBUTION_KINDS as readonly string[]).includes(kind);
}

/**
 * One parameter's value as written, checked against its spec.
 *
 * A number out of range is **clamped**, not refused -- `fpsCap`'s rule, and
 * the field's own min and max say the same thing. What is not a number at all,
 * or not one of a choice's options, is refused by name: there is no nearest
 * answer to "frequency=fast".
 */
function readParam(kind: DistributionKind, spec: ParamSpec, raw: ParamValue): ParamValue {
  switch (spec.type) {
    case "number": {
      const value = typeof raw === "number" ? raw : Number(raw);
      if (typeof raw === "boolean" || !Number.isFinite(value)) {
        throw new MixSyntaxError(`#${kind}'s ${spec.key} has to be a number, not ${String(raw)}.`);
      }
      const clamped = Math.min(spec.max, Math.max(spec.min, value));
      return spec.integer ? Math.round(clamped) : clamped;
    }
    case "choice": {
      const value = String(raw).trim().toLowerCase();
      if (!spec.options.includes(value)) {
        throw new MixSyntaxError(`#${kind}'s ${spec.key} is one of ${spec.options.join(", ")}, not ${String(raw)}.`);
      }
      return value;
    }
    case "boolean": {
      if (typeof raw === "boolean") return raw;
      const value = String(raw).trim().toLowerCase();
      if (["true", "yes", "1"].includes(value)) return true;
      if (["false", "no", "0"].includes(value)) return false;
      throw new MixSyntaxError(`#${kind}'s ${spec.key} is true or false, not ${String(raw)}.`);
    }
  }
}

/**
 * A distribution checked and cleaned: a kind this build knows, a whole seed,
 * parameters it takes, each in range.
 *
 * Both halves ask. `parseMix` reads a spelling through it, and main runs every
 * distribution the wire brings through it too -- an `EditRequest` is a
 * structured object that never went near the parser, and a renderer or a
 * client is not trusted to have sent a kind that exists.
 */
export function normalizeDistribution(distribution: {
  kind: string;
  seed?: unknown;
  params?: Readonly<Record<string, ParamValue>>;
}): Distribution {
  const kind = String(distribution.kind).toLowerCase();
  if (!isKind(kind)) {
    throw new MixSyntaxError(`#${distribution.kind} is not a distribution. The ones there are: #${DISTRIBUTION_KINDS.join(", #")}.`);
  }
  const seed = distribution.seed === undefined ? 0 : Number(distribution.seed);
  if (!Number.isInteger(seed)) throw new MixSyntaxError(`The seed has to be a whole number, not ${String(distribution.seed)}.`);
  const specs = DISTRIBUTION_PARAMS[kind];
  const params: Record<string, ParamValue> = {};
  for (const [written, raw] of Object.entries(distribution.params ?? {})) {
    const key = PARAM_ALIASES[written.toLowerCase()] ?? written.toLowerCase();
    const spec = specs.find((candidate) => candidate.key === key);
    if (spec === undefined) {
      throw new MixSyntaxError(
        specs.length === 0
          ? `#${kind} takes no parameters besides the seed.`
          : `#${kind} takes ${specs.map((candidate) => candidate.key).join(", ")} and seed, not ${written}.`,
      );
    }
    params[key] = readParam(kind, spec, raw);
  }
  return Object.keys(params).length === 0 ? { kind, seed: seed | 0 } : { kind, seed: seed | 0, params };
}

/** Every parameter of a distribution, the ones left out at their defaults. */
export function resolveParams(distribution: Distribution): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const spec of DISTRIBUTION_PARAMS[distribution.kind]) {
    out[spec.key] = distribution.params?.[spec.key] ?? spec.default;
  }
  return out;
}

/** A mix of one block, which is what every plain block string is. */
export function singleBlockMix(block: string): BlockMix {
  return { entries: [{ block, weight: 1 }], distribution: DEFAULT_DISTRIBUTION };
}

/** A weight as the spelling writes it: at most two decimals, no trailing zeros. */
function formatWeight(weight: number): string {
  return String(Number(weight.toFixed(2)));
}

const WEIGHTED = /^(\d+(?:\.\d+)?|\.\d+)\s*%\s*(.+)$/s;
const PREFIX = /^#\s*([a-z_]+)\s*\{([^}]*)\}\s*/i;

function readDistribution(kind: string, body: string): Distribution {
  const params: Record<string, string> = {};
  let seed: string | undefined;
  for (const pair of body.split(",")) {
    const trimmed = pair.trim();
    if (trimmed === "") continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) throw new MixSyntaxError(`${trimmed} in #${kind}{...} has no value; write it as name=value.`);
    const key = trimmed.slice(0, eq).trim().toLowerCase();
    const value = trimmed.slice(eq + 1).trim();
    if (key === "seed") seed = value;
    else params[key] = value;
  }
  return normalizeDistribution({ kind, seed, params });
}

/** `0.08`, not `0.08000000000000002`: a parameter as the spelling writes it. */
function formatParam(value: ParamValue): string {
  return typeof value === "number" ? String(Number(value.toFixed(4))) : String(value);
}

/** `#perlin{seed=7,frequency=0.1}`, or nothing for the plain unseeded random. */
export function formatDistribution(distribution: Distribution): string {
  const params = DISTRIBUTION_PARAMS[distribution.kind]
    .filter((spec) => distribution.params?.[spec.key] !== undefined)
    .map((spec) => `${spec.key}=${formatParam(distribution.params![spec.key])}`);
  if (distribution.kind === "random" && distribution.seed === 0 && params.length === 0) return "";
  return `#${distribution.kind}{${[`seed=${distribution.seed}`, ...params].join(",")}}`;
}

/**
 * A mix as written.
 *
 * Throws `MixSyntaxError` with a sentence about what it could not read; a
 * caller showing it to a person shows the message.
 */
export function parseMix(text: string): BlockMix {
  let rest = text.trim();
  let distribution: Distribution = DEFAULT_DISTRIBUTION;
  const prefix = PREFIX.exec(rest);
  if (prefix !== null) {
    distribution = readDistribution(prefix[1], prefix[2]);
    rest = rest.slice(prefix[0].length);
  }
  const pieces = topLevel(rest, ",");
  if (pieces.length === 0) throw new MixSyntaxError("Name at least one block.");
  if (pieces.length > MAX_MIX_ENTRIES) {
    throw new MixSyntaxError(`A mix holds at most ${MAX_MIX_ENTRIES} blocks; this one names ${pieces.length}.`);
  }
  const entries = pieces.map((piece): MixEntry => {
    const weighted = WEIGHTED.exec(piece);
    if (weighted === null) return { block: piece, weight: 1 };
    const block = weighted[2].trim();
    if (block === "") throw new MixSyntaxError(`${piece} has a weight and no block.`);
    return { block, weight: Number(weighted[1]) };
  });
  if (entries.every((entry) => entry.weight === 0)) {
    throw new MixSyntaxError("Every weight in the mix is zero, so it would place nothing.");
  }
  return { entries, distribution };
}

/** `parseMix`, or `null` where it would throw. For callers that only label. */
export function tryParseMix(text: string): BlockMix | null {
  try {
    return parseMix(text);
  } catch {
    return null;
  }
}

/**
 * The spelling of a mix. One block comes back as itself, with no weight and no
 * distribution, so a plain block round-trips to exactly what was typed.
 */
export function formatMix(mix: BlockMix): string {
  if (mix.entries.length === 1) return mix.entries[0].block;
  return (
    formatDistribution(mix.distribution) +
    mix.entries.map((entry) => `${formatWeight(entry.weight)}%${entry.block}`).join(",")
  );
}

/** Whether the text names more than one block, which is what draws a badge. */
export function isMixText(text: string): boolean {
  return (tryParseMix(text)?.entries.length ?? 1) > 1;
}

/** Each entry's share of the whole, summing to 1. */
export function effectiveShares(entries: readonly { readonly weight: number }[]): number[] {
  const total = entries.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
  if (total <= 0) return entries.map(() => 1 / Math.max(1, entries.length));
  return entries.map((entry) => Math.max(0, entry.weight) / total);
}

/**
 * How many of `cells` each entry gets, summing to exactly `cells`.
 *
 * Largest remainder: everyone gets the floor of their share, and the cells
 * left over go to the largest fractions, ties to the earlier entry. So 70/30
 * over a thousand cells is 700 and 300, not 699 and 300 and a cell nobody got.
 */
export function quotas(shares: readonly number[], cells: number): number[] {
  const raw = shares.map((share) => share * cells);
  const counts = raw.map((value) => Math.floor(value));
  let left = cells - counts.reduce((sum, count) => sum + count, 0);
  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let i = 0; left > 0 && order.length > 0; i = (i + 1) % order.length) {
    counts[order[i].index] += 1;
    left -= 1;
  }
  return counts;
}

export { cellHash01 };

/** The value a distribution gives a cell, before it is turned into a block. */
export type CellValue = (x: number, y: number, z: number) => number;

/** Salt for the grain, so it is not the same hash as `random`'s. */
const GRAIN_SALT = 0x7f4a7c15;

/**
 * The distribution as a function of the cell, its parameters read once.
 *
 * Every field is sampled at the **centre** of the cell and in the document's
 * own coordinates, so two areas filled one after the other with the same mix
 * are one continuous pattern across the seam.
 *
 * Only the *order* of the values matters to a fill, which is why the ranges
 * differ by kind and nothing is rescaled: a gradient's value is a position in
 * blocks, a Voronoi patch's is a hash.
 */
export function cellValues(distribution: Distribution): CellValue {
  const seed = distribution.seed | 0;
  const p = resolveParams(distribution);
  const number = (key: string): number => Number(p[key]);
  const grain = number("grain") || 0;
  const roughen: CellValue =
    grain > 0 ? (x, y, z) => grain * (cellHash01(x, y, z, seed ^ GRAIN_SALT) - 0.5) : () => 0;

  switch (distribution.kind) {
    case "random":
      return (x, y, z) => cellHash01(x, y, z, seed);
    case "perlin":
    case "simplex": {
      const { perm, ox, oy, oz } = noiseSeed(seed);
      const basis = distribution.kind === "perlin" ? perlin3 : simplex3;
      const f = number("frequency");
      const octaves = number("octaves");
      const persistence = number("persistence");
      const lacunarity = number("lacunarity");
      return (x, y, z) =>
        fbm(basis, perm, (x + 0.5) * f + ox, (y + 0.5) * f + oy, (z + 0.5) * f + oz, octaves, persistence, lacunarity) +
        roughen(x, y, z);
    }
    case "ridged": {
      const { perm, ox, oy, oz } = noiseSeed(seed);
      const f = number("frequency");
      const octaves = number("octaves");
      const persistence = number("persistence");
      const lacunarity = number("lacunarity");
      const gain = number("gain");
      const offset = number("offset");
      return (x, y, z) =>
        ridged(perm, (x + 0.5) * f + ox, (y + 0.5) * f + oy, (z + 0.5) * f + oz, octaves, persistence, lacunarity, gain, offset) +
        roughen(x, y, z);
    }
    case "voronoi": {
      const size = number("size");
      const jitter = number("jitter");
      const mode = String(p.mode);
      return (x, y, z) => {
        const s = worley(seed, x + 0.5, y + 0.5, z + 0.5, size, jitter);
        /*
         * A patch is one value -- its point's hash -- plus a hair of distance,
         * so the one patch a share's cut falls inside is split from its centre
         * outwards rather than along the order the cells were walked in, which
         * would be a straight line through it.
         */
        const base = mode === "distance" ? s.f1 : mode === "edges" ? s.f2 - s.f1 : s.id + 1e-4 * s.f1;
        return base + roughen(x, y, z);
      };
    }
    case "gradient": {
      const { perm, ox, oy, oz } = noiseSeed(seed);
      const axis = String(p.axis);
      const sign = p.reverse === true ? -1 : 1;
      const edge = number("edge");
      const f = number("frequency");
      return (x, y, z) => {
        const along = (axis === "x" ? x : axis === "z" ? z : y) + 0.5;
        // About `edge` blocks of wobble either way: a normalised fractal sum
        // rarely leaves [-0.5, 0.5].
        const wobble =
          edge === 0
            ? 0
            : 2 * edge * fbm(simplex3, perm, (x + 0.5) * f + ox, (y + 0.5) * f + oy, (z + 0.5) * f + oz, 3, 0.5, 2);
        return sign * along + wobble + roughen(x, y, z);
      };
    }
  }
}

let lastDistribution: Distribution | null = null;
let lastValues: CellValue | null = null;

/** The value a distribution gives one cell. `cellValues` for a loop. */
export function distributionValue(distribution: Distribution, x: number, y: number, z: number): number {
  if (distribution !== lastDistribution || lastValues === null) {
    lastDistribution = distribution;
    lastValues = cellValues(distribution);
  }
  return lastValues(x, y, z);
}

/**
 * Where a block placed by hand finds its frame when nobody gave one: a 64-block
 * cube at the origin, which is the size of an ordinary build.
 */
const DEFAULT_FRAME: Box = { minX: 0, minY: 0, minZ: 0, maxX: 63, maxY: 63, maxZ: 63 };

/** Samples per axis for the thresholds: 32^3 values, once per mix and frame. */
const FRAME_SAMPLES = 32;

const cutCache = new Map<string, number[]>();

/**
 * The values at which one entry gives way to the next, for a block decided on
 * its own.
 *
 * A fill ranks every cell it writes and cuts the ranking exactly. A block
 * placed by hand has no ranking to be cut, so the cuts are taken from a sample
 * of the same field over `frame` -- the values below which 70% of that sample
 * falls, and so on. For `random` the field is uniform and the cuts are the
 * shares themselves; for a noise they are wherever the noise puts them, which
 * for a gradient is a height in the frame.
 */
function cutsFor(distribution: Distribution, shares: readonly number[], frame: Box): number[] {
  const cumulative: number[] = [];
  let running = 0;
  for (const share of shares.slice(0, -1)) {
    running += share;
    cumulative.push(running);
  }
  if (distribution.kind === "random") return cumulative;

  const key = `${formatDistribution(distribution)}|${shares.join(",")}|${frame.minX},${frame.minY},${frame.minZ},${frame.maxX},${frame.maxY},${frame.maxZ}`;
  const held = cutCache.get(key);
  if (held !== undefined) return held;

  const values = cellValues(distribution);
  const axis = (min: number, max: number): number[] => {
    const span = max - min + 1;
    const count = Math.min(FRAME_SAMPLES, span);
    return Array.from({ length: count }, (_unused, i) => min + Math.floor(((i + 0.5) * span) / count));
  };
  const xs = axis(frame.minX, frame.maxX);
  const ys = axis(frame.minY, frame.maxY);
  const zs = axis(frame.minZ, frame.maxZ);
  const sample = new Float64Array(xs.length * ys.length * zs.length);
  let at = 0;
  for (const x of xs) for (const y of ys) for (const z of zs) sample[at++] = values(x, y, z);
  sample.sort();
  const cuts = cumulative.map((share) => sample[Math.min(sample.length - 1, Math.round(share * sample.length))]);
  if (cutCache.size >= 64) cutCache.clear();
  cutCache.set(key, cuts);
  return cuts;
}

/**
 * Which entry one cell gets, deciding it alone.
 *
 * For a block placed by hand, where there is no set of cells to share out --
 * so the shares are met on average rather than exactly. It reads the same
 * field a fill would, so a block placed beside a filled area continues its
 * pattern. `frame` is what the shares are taken over, the document's box for
 * the hand; see `cutsFor`.
 */
export function pickAt(mix: BlockMix, x: number, y: number, z: number, frame: Box = DEFAULT_FRAME): MixEntry {
  if (mix.entries.length === 1) return mix.entries[0];
  const cuts = cutsFor(mix.distribution, effectiveShares(mix.entries), frame);
  const value = distributionValue(mix.distribution, x, y, z);
  for (let i = 0; i < cuts.length; i += 1) {
    if (value < cuts[i]) return mix.entries[i];
  }
  return mix.entries[mix.entries.length - 1];
}

/** A new seed, for the dice. Never 0, which is what an unseeded mix means. */
export function freshSeed(): number {
  return 1 + Math.floor(Math.random() * 0x7ffffffe);
}

/**
 * The mix with one more block, on an equal footing with the others.
 *
 * Its weight is the average of the ones already there, so it takes `1/(n+1)`
 * of the whole and the rest keep their proportions to each other. A block
 * already in the mix is not added twice.
 */
export function addToMix(mix: BlockMix, block: string): BlockMix {
  if (mix.entries.some((entry) => entry.block === block)) return mix;
  if (mix.entries.length >= MAX_MIX_ENTRIES) return mix;
  const average =
    mix.entries.length === 0
      ? 1
      : mix.entries.reduce((sum, entry) => sum + entry.weight, 0) / mix.entries.length;
  return { ...mix, entries: [...mix.entries, { block, weight: Number(average.toFixed(2)) || 1 }] };
}

/** The `index`-th block replaced, keeping its weight. */
export function replaceInMix(mix: BlockMix, index: number, block: string): BlockMix {
  return {
    ...mix,
    entries: mix.entries.map((entry, at) => (at === index ? { ...entry, block } : entry)),
  };
}

export function removeFromMix(mix: BlockMix, index: number): BlockMix {
  return { ...mix, entries: mix.entries.filter((_entry, at) => at !== index) };
}

export function reweightMix(mix: BlockMix, index: number, weight: number): BlockMix {
  const clean = Number.isFinite(weight) ? Math.max(0, weight) : 0;
  return {
    ...mix,
    entries: mix.entries.map((entry, at) => (at === index ? { ...entry, weight: clean } : entry)),
  };
}

/** `70% stone, 30% andesite`, and `(perlin)` after it when it is not random. */
export function describeMix(mix: BlockMix): string {
  const shares = effectiveShares(mix.entries);
  const blocks = mix.entries
    .map((entry, index) => {
      const name = entry.block.replace(/^minecraft:/, "");
      return mix.entries.length === 1 ? name : `${Math.round(shares[index] * 100)}% ${name}`;
    })
    .join(", ");
  return mix.entries.length > 1 && mix.distribution.kind !== "random" ? `${blocks} (${mix.distribution.kind})` : blocks;
}
