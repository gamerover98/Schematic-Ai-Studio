/**
 * The loading bar's arithmetic: where on the bar a phase sits, and the rule
 * that it never goes back.
 *
 * Plain for `selection_drag.ts`'s reason: the overlay is drawn from it, and a
 * rule written inside an effect can only be grepped for.
 */

import type { DocProgressPhase } from "../../../shared/ipc.js";

/** The window's own phase: the mesh has arrived and is being put on screen. */
export type LoadPhase = DocProgressPhase | "drawing";

/**
 * Each phase's share of the bar, `[start, end)`, in the order they happen.
 *
 * Weighted by where the time goes rather than split evenly: meshing is
 * fourteen of fifteen seconds on a large terrain, and a bar that spent a fifth
 * of itself on reading would sit at a fifth for the whole of it.
 */
export const PHASE_SPAN: Record<LoadPhase, readonly [number, number]> = {
  reading: [0, 0.08],
  decoding: [0.08, 0.12],
  lighting: [0.12, 0.16],
  meshing: [0.16, 0.9],
  sending: [0.9, 0.95],
  drawing: [0.95, 1],
};

/**
 * How long work runs before the bar is drawn, counted from when the window
 * first heard of it. Main is already quiet for its first 150 ms, so a bar
 * appears only for work past about a third of a second -- an ordinary edit
 * never shows one, and a small schematic opens without a flash.
 */
export const SHOW_AFTER_MS = 300;

/** Where on the bar `done` of `total` within `phase` is, from 0 to 1. */
export function phaseFraction(phase: LoadPhase, done: number, total: number): number {
  const [start, end] = PHASE_SPAN[phase];
  const within = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
  return start + (end - start) * within;
}

export interface LoadState {
  phase: LoadPhase;
  /** 0 to 1, never less than it was. */
  fraction: number;
  /** When the window first heard of this piece of work, `performance.now()`. */
  since: number;
}

/**
 * The bar after one more report.
 *
 * Never backwards: opening a file is two operations in main -- reading it,
 * then meshing it -- and the second starts its own count. The phase still
 * follows what was said, so the label is always the work under way.
 */
export function advance(
  state: LoadState | null,
  phase: LoadPhase,
  done: number,
  total: number,
  now: number,
): LoadState {
  const fraction = phaseFraction(phase, done, total);
  if (state === null) return { phase, fraction, since: now };
  return { phase, fraction: Math.max(state.fraction, fraction), since: state.since };
}

/** Whether the bar is drawn yet. */
export function loadVisible(state: LoadState | null, now: number): boolean {
  return state !== null && now - state.since >= SHOW_AFTER_MS;
}
