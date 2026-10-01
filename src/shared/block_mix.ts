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

/** Every cell decided on its own, from a hash of where it is. */
export interface RandomDistribution {
  readonly kind: "random";
  readonly seed: number;
}

export type Distribution = RandomDistribution;

export interface BlockMix {
  readonly entries: readonly MixEntry[];
  readonly distribution: Distribution;
}

export const DEFAULT_DISTRIBUTION: Distribution = { kind: "random", seed: 0 };

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
  const params = new Map<string, string>();
  for (const pair of body.split(",")) {
    const trimmed = pair.trim();
    if (trimmed === "") continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) throw new MixSyntaxError(`${trimmed} in #${kind}{...} has no value; write it as name=value.`);
    params.set(trimmed.slice(0, eq).trim().toLowerCase(), trimmed.slice(eq + 1).trim());
  }
  const seedText = params.get("seed");
  const seed = seedText === undefined ? 0 : Number(seedText);
  if (!Number.isInteger(seed)) throw new MixSyntaxError(`The seed has to be a whole number, not ${seedText}.`);
  switch (kind.toLowerCase()) {
    case "random":
      return { kind: "random", seed: seed | 0 };
    default:
      throw new MixSyntaxError(`#${kind} is not a distribution. The one this build knows is #random.`);
  }
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
  const prefix =
    mix.distribution.kind === "random" && mix.distribution.seed === 0
      ? ""
      : `#${mix.distribution.kind}{seed=${mix.distribution.seed}}`;
  return prefix + mix.entries.map((entry) => `${formatWeight(entry.weight)}%${entry.block}`).join(",");
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

/**
 * A number in [0, 1) that depends only on the cell and the seed.
 *
 * MurmurHash3's finaliser over the three coordinates and the seed, each
 * multiplied by a different odd constant first so that swapping two axes is a
 * different cell. Integer arithmetic throughout, so main and the renderer get
 * the same bits.
 */
export function cellHash01(x: number, y: number, z: number, seed: number): number {
  let h =
    Math.imul(x | 0, 0x8da6b343) ^
    Math.imul(y | 0, 0xd8163841) ^
    Math.imul(z | 0, 0xcb1ab31f) ^
    Math.imul(seed | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** The value a distribution gives one cell, before it is turned into a block. */
export function distributionValue(distribution: Distribution, x: number, y: number, z: number): number {
  return cellHash01(x, y, z, distribution.seed);
}

/**
 * Which entry one cell gets, deciding it alone.
 *
 * For a block placed by hand, where there is no set of cells to share out --
 * so the shares are met on average rather than exactly. A fill uses
 * `main/domain/mix.ts`, which counts.
 */
export function pickAt(mix: BlockMix, x: number, y: number, z: number): MixEntry {
  if (mix.entries.length === 1) return mix.entries[0];
  const shares = effectiveShares(mix.entries);
  const value = distributionValue(mix.distribution, x, y, z);
  let cumulative = 0;
  for (let i = 0; i < shares.length; i += 1) {
    cumulative += shares[i];
    if (value < cumulative) return mix.entries[i];
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

/** `70% stone, 30% andesite`, for a tooltip. */
export function describeMix(mix: BlockMix): string {
  const shares = effectiveShares(mix.entries);
  return mix.entries
    .map((entry, index) => {
      const name = entry.block.replace(/^minecraft:/, "");
      return mix.entries.length === 1 ? name : `${Math.round(shares[index] * 100)}% ${name}`;
    })
    .join(", ");
}
