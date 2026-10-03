/**
 * The materials inventory's rules, apart from the component that draws it.
 *
 * A plain module for `selection_drag.ts`'s reason: a rule written inside a
 * click handler can only be grepped for, and both of these have edges worth
 * stating -- where a count changes unit, and what a click on air means.
 */

import type { PaletteCount } from "../../../shared/ipc.js";
import { blockQuery } from "../../../shared/block_query.js";
import { unifyStates } from "../../../shared/material_list.js";
import type { MaterialsSort } from "../../../shared/settings.js";

/**
 * A count short enough for the corner of a 36px slot.
 *
 * Exact up to 9999, which is four characters and fits; then `12.3k`, `123k`,
 * `1.2M`. **Truncated, never rounded**: rounding sends 99,960 to `100.0k`,
 * which is the wrong unit as well as the wrong number, and a slot that says
 * there is more than there is invites a replace that finds less. The exact
 * figure is in the hover.
 */
export function formatCount(count: number): string {
  const n = Math.max(0, Math.trunc(count));
  if (n < 10_000) return String(n);
  const units: [number, string][] = [
    [1_000_000_000, "G"],
    [1_000_000, "M"],
    [1_000, "k"],
  ];
  for (const [size, suffix] of units) {
    if (n < size) continue;
    const whole = n / size;
    if (whole >= 100) return `${Math.trunc(whole)}${suffix}`;
    const tenths = Math.trunc(whole * 10) / 10;
    return `${Number.isInteger(tenths) ? tenths : tenths.toFixed(1)}${suffix}`;
  }
  return String(n);
}

/** What a click on a slot does. */
export type MaterialAction = "with" | "addWith" | "replace" | "addReplace" | "state" | "none";

/**
 * The click on a slot, read.
 *
 * Plain is With, Ctrl adds to With's mix, Shift is Replace and Ctrl+Shift adds
 * to it, the right button opens the block's states. Cmd counts as Ctrl.
 *
 * **Air cannot be held**, so a plain click on it means Replace: "replace the
 * air in here" is the one thing air is useful for in that panel, and putting
 * it in the hand would be a slot `coerceHotbar` refuses. Ctrl still adds it to
 * With's mix, because a mix with some air in it is a ruin and is legal. It has
 * no states to open.
 */
export function materialAction(
  click: { button: number; ctrl: boolean; shift: boolean },
  air: boolean,
): MaterialAction {
  if (click.button === 2) return air ? "none" : "state";
  if (click.button !== 0) return "none";
  if (click.shift) return click.ctrl ? "addReplace" : "replace";
  if (click.ctrl) return "addWith";
  return air ? "replace" : "with";
}

/** The spelling an air slot stands for. */
export const AIR = "minecraft:air";

/** One slot of the inventory, as drawn. */
export interface MaterialRow {
  /** The exact state, or the bare id when the states are merged. */
  readonly block: string;
  readonly count: number;
  /** The far halves the slot also stands for: a bed's head beside its foot. */
  readonly pair: readonly string[];
  readonly air: boolean;
}

/**
 * The slots, as the bar above them asks: states merged or not, filtered by
 * what was typed, in the order chosen.
 *
 * **Air is last whatever the order**, as it always was: it is what is left
 * over, not a material anybody is looking for by count or by name, and
 * sorting it into the middle of the list would put the one slot that cannot
 * be held where a block is expected.
 *
 * The search reads a query the way the block picker does (`blockQuery`: a
 * space is an underscore, the namespace is stripped) and matches the slot's
 * spelling without its namespace, states included -- so `part=head` finds the
 * heads nobody's foot claimed.
 */
export function materialRows(
  palette: readonly PaletteCount[],
  air: number,
  options: { unify: boolean; sort: MaterialsSort; query: string },
): MaterialRow[] {
  const listed = options.unify ? unifyStates(palette) : palette;
  const query = blockQuery(options.query);
  const matches = (block: string): boolean => query === "" || bare(block).includes(query);
  const rows = listed
    .filter((entry) => matches(entry.block))
    .map((entry) => ({ block: entry.block, count: entry.count, pair: entry.pair ?? [], air: false }));
  rows.sort(orderOf(options.sort));
  if (air > 0 && matches(AIR)) rows.push({ block: AIR, count: air, pair: [], air: true });
  return rows;
}

function bare(block: string): string {
  return block.replace(/^minecraft:/, "");
}

function byName(a: { block: string }, b: { block: string }): number {
  const left = bare(a.block);
  const right = bare(b.block);
  return left < right ? -1 : left > right ? 1 : 0;
}

function orderOf(sort: MaterialsSort): (a: MaterialRow, b: MaterialRow) => number {
  switch (sort) {
    case "countAsc":
      return (a, b) => a.count - b.count || byName(a, b);
    case "nameAsc":
      return byName;
    case "nameDesc":
      return (a, b) => byName(b, a);
    case "countDesc":
      return (a, b) => b.count - a.count || byName(a, b);
  }
}
