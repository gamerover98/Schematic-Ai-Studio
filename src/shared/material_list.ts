/**
 * A materials list with its states merged: one row per block, whatever the
 * block's states.
 *
 * A schematic's palette names every state it holds, so a vine on four walls
 * is four rows, a staircase twelve and a redstone line as many as it has
 * corners and powers. Asked "what is this made of", that is the wrong grain:
 * the answer a person wants is "vines, stairs, redstone".
 *
 * In `shared/` because two readers ask: the inventory's "merge states" box,
 * and `get_palette`'s `unify`. Two copies of the grouping is how one of them
 * comes to drop the pairs.
 *
 * A merged row is the bare id, and a bare id is a pattern that matches the
 * block in any state (`matchesBlockPattern`), so a replace of the row finds
 * exactly the cells the row counted. A pair whose far half is a different
 * block -- an extended piston's `piston_head` -- keeps its exact spellings,
 * because a bare `minecraft:piston_head` would also match the heads of the
 * sticky pistons.
 */

import type { PaletteCount } from "./ipc.js";

/** The id without its states. */
export function baseBlock(block: string): string {
  return block.split("[", 1)[0];
}

/** One row per block id, most common first, then by name. */
export function unifyStates(palette: readonly PaletteCount[]): PaletteCount[] {
  const groups = new Map<string, { count: number; pair: Set<string> }>();
  for (const entry of palette) {
    const block = baseBlock(entry.block);
    let group = groups.get(block);
    if (group === undefined) groups.set(block, (group = { count: 0, pair: new Set() }));
    group.count += entry.count;
    for (const far of entry.pair ?? []) if (baseBlock(far) !== block) group.pair.add(far);
  }
  return [...groups.entries()]
    .sort((a, b) => b[1].count - a[1].count || (a[0] < b[0] ? -1 : 1))
    .map(([block, group]) =>
      group.pair.size === 0 ? { block, count: group.count } : { block, count: group.count, pair: [...group.pair].sort() },
    );
}
