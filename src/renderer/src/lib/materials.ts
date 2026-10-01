/**
 * The materials inventory's rules, apart from the component that draws it.
 *
 * A plain module for `selection_drag.ts`'s reason: a rule written inside a
 * click handler can only be grepped for, and both of these have edges worth
 * stating -- where a count changes unit, and what a click on air means.
 */

import type { PaletteCount } from "../../../shared/ipc.js";

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

/**
 * The whole document's materials, for when nothing is selected.
 *
 * `DocumentState.palette` leaves air out, so the air is what the volume has
 * left over. Every cell holds exactly one entry, and the palette names every
 * entry that is not air, so that is exact rather than an estimate.
 */
export function documentMaterials(
  palette: readonly PaletteCount[],
  size: readonly [number, number, number],
): { palette: readonly PaletteCount[]; air: number; outside: number; cells: number } {
  const cells = size[0] * size[1] * size[2];
  const blocks = palette.reduce((sum, entry) => sum + entry.count, 0);
  return { palette, air: Math.max(0, cells - blocks), outside: 0, cells };
}
