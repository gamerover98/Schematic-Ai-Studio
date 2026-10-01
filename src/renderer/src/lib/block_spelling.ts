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

/** `oak stairs`, for a caption under an icon. */
export function shortName(text: string): string {
  const spelling = readSpelling(text);
  const name = spelling?.name ?? text;
  return name.replace(/^minecraft:/, "").replace(/_/g, " ");
}
