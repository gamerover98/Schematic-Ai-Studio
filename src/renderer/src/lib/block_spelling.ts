/**
 * One block's spelling taken apart and put back together, for the chips.
 *
 * A chip holds `minecraft:oak_stairs[facing=east]` or a patterned banner as
 * text, and the state editor has to change one property of it without
 * touching the rest -- least of all the banner's design, whose list is full of
 * the commas a naive split cuts on. `splitBlockInput` takes the design out
 * first, which is the one scanner the app has for it.
 *
 * Plain, so `tests/ui.ts` can state the round trip.
 */

import { splitBlockInput } from "../../../shared/block_input.js";
import { addToMix, formatMix, freshSeed, tryParseMix } from "../../../shared/block_mix.js";
import { resolveBlockInput, type LegacyIndex } from "../../../shared/legacy_ids.js";

export interface BlockSpelling {
  /** Namespaced: `minecraft:oak_stairs`. */
  readonly name: string;
  readonly properties: Readonly<Record<string, string>>;
  /** A banner's design as written, or `null`. */
  readonly bannerPatterns: string | null;
}

/** `null` for text that is not a block yet -- half a command, an open bracket. */
export function readSpelling(text: string): BlockSpelling | null {
  let input;
  try {
    input = splitBlockInput(text);
  } catch {
    return null;
  }
  const trimmed = input.block.trim();
  if (trimmed === "") return null;
  const bracket = trimmed.indexOf("[");
  const bare = bracket === -1 ? trimmed : trimmed.slice(0, bracket);
  const name = bare.includes(":") ? bare : `minecraft:${bare}`;
  const properties: Record<string, string> = {};
  if (bracket !== -1) {
    for (const part of trimmed.slice(bracket + 1).replace(/\]$/, "").split(",")) {
      const eq = part.indexOf("=");
      if (eq > 0) properties[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    }
  }
  return { name, properties, bannerPatterns: input.bannerPatterns };
}

/**
 * The spelling back, states sorted by name so the same block is always the
 * same string -- which is what the icon cache and the mix's duplicate check
 * key on.
 */
export function writeSpelling(spelling: BlockSpelling): string {
  const pairs = Object.keys(spelling.properties)
    .sort()
    .map((key) => `${key}=${spelling.properties[key]}`);
  if (spelling.bannerPatterns !== null) pairs.push(`banner_patterns=${spelling.bannerPatterns}`);
  return pairs.length === 0 ? spelling.name : `${spelling.name}[${pairs.join(",")}]`;
}

/**
 * What a chip should hold for text somebody committed: `35:14` resolved on a
 * legacy document, a missing namespace added, the states in a fixed order.
 * Text that is not a block yet is kept as typed, so a typo stays visible
 * rather than vanishing.
 */
export function canonicalBlock(text: string, legacy: LegacyIndex | null): string {
  const resolved = resolveBlockInput(text.trim(), legacy);
  const spelling = readSpelling(resolved);
  return spelling === null ? resolved : writeSpelling(spelling);
}

/**
 * Whether a chip holds air, which has no icon to draw: there is nothing to
 * mesh. Its two-letter stand-in would read "AI", which in this app is the
 * wrong thing entirely, so the chips draw it as an empty slot instead.
 */
export function isAirBlock(text: string): boolean {
  return readSpelling(text)?.name === "minecraft:air";
}

/** `oak stairs`, for a caption under an icon. */
export function shortName(text: string): string {
  const spelling = readSpelling(text);
  const name = spelling?.name ?? text;
  return name.replace(/^minecraft:/, "").replace(/_/g, " ");
}

/**
 * A field's text with one more block in it, on an equal footing with the
 * others -- what the block list and the materials inventory do when asked to
 * add to a field that may hold several. An empty field, or text that is not a
 * mix yet, becomes that block alone.
 *
 * The mix gets a seed of its own the moment it becomes one, for
 * `BlockMixField.add`'s reason: seed 0 everywhere would make every mix anybody
 * builds the same pattern.
 */
export function withBlockAdded(text: string, block: string, legacy: LegacyIndex | null): string {
  const canonical = canonicalBlock(block, legacy);
  if (text.trim() === "") return canonical;
  const mix = tryParseMix(text);
  if (mix === null) return canonical;
  const next = addToMix(mix, canonical);
  return formatMix(
    next.entries.length === 2 && next.distribution.seed === 0
      ? { ...next, distribution: { ...next.distribution, seed: freshSeed() } }
      : next,
  );
}

/**
 * `withBlockAdded` for several blocks at once: the materials inventory's way
 * of naming a whole bed, whose slot stands for a foot and a head.
 */
export function withBlocksAdded(text: string, blocks: readonly string[], legacy: LegacyIndex | null): string {
  return blocks.reduce((next, block) => withBlockAdded(next, block, legacy), text);
}
