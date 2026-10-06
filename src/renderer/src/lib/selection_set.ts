/**
 * A selection of several areas, and the gestures that change which.
 *
 * The app keeps `selection` as the **active** area -- the one with face plates,
 * the one the inspector and the anchor follow -- and the rest beside it. That
 * arrangement is what let a second area arrive without rewriting the dozens of
 * places that already read `selection`: they go on meaning the box being
 * worked on, and only the verbs that act on the whole selection (fill, copy,
 * the gizmo) ask for every area.
 *
 * `slot` is where the active area sits among the others, so the panel lists
 * them in an order that does not reshuffle when a different one is made
 * active: activating the third area leaves it third.
 *
 * Plain functions over plain values, for `selection_drag.ts`'s reason: the
 * gestures run from a viewport this project's harness cannot drive, and the
 * rules are worth stating where they can be tested.
 */

import { boxContains, boxVolume, unionBounds, unionVolume, MAX_BOXES } from "../../../shared/regions.js";
import type { Region } from "./selection_drag.js";

export interface AreaSet {
  /** The area being worked on, or `null` for no selection at all. */
  active: Region | null;
  /** Every other area, in the order the panel lists them. */
  others: Region[];
  /** Where `active` goes among `others` in that order. */
  slot: number;
}

export const NO_AREAS: AreaSet = { active: null, others: [], slot: 0 };

/** One area and nothing else -- what a plain selection gesture leaves. */
export function single(area: Region): AreaSet {
  return { active: { ...area }, others: [], slot: 0 };
}

/** Every area, in the panel's order. Empty with nothing selected. */
export function areaList(set: AreaSet): Region[] {
  if (set.active === null) return [];
  const slot = Math.max(0, Math.min(set.slot, set.others.length));
  return [...set.others.slice(0, slot), set.active, ...set.others.slice(slot)];
}

/** Which of `areaList` is active, or -1 with nothing selected. */
export function activeIndex(set: AreaSet): number {
  return set.active === null ? -1 : Math.max(0, Math.min(set.slot, set.others.length));
}

/** The set with the area at `index` of `list` active. */
function split(list: readonly Region[], index: number): AreaSet {
  if (list.length === 0) return NO_AREAS;
  const at = Math.max(0, Math.min(index, list.length - 1));
  return {
    active: { ...list[at] },
    others: list.filter((_area, i) => i !== at).map((area) => ({ ...area })),
    slot: at,
  };
}

/**
 * Adds an area and makes it the active one.
 *
 * At the end of the list, because it is the newest. Past `MAX_BOXES` it
 * replaces the newest instead: main refuses an edit naming more, and a gesture
 * that silently built a selection nothing would accept is worse than one that
 * stops growing.
 */
export function withArea(set: AreaSet, area: Region): AreaSet {
  const list = areaList(set);
  if (list.length >= MAX_BOXES) list.pop();
  list.push(area);
  return split(list, list.length - 1);
}

/**
 * The area under a cell: the smallest one holding it, or -1.
 *
 * The smallest, because areas may nest, and the one somebody clicks inside a
 * large area is almost always the small one drawn on top of it -- the large
 * one has plenty of other places to be clicked.
 */
export function areaAt(set: AreaSet, cell: { x: number; y: number; z: number }): number {
  let best = -1;
  let bestVolume = Infinity;
  areaList(set).forEach((area, index) => {
    if (!boxContains(area, cell.x, cell.y, cell.z)) return;
    const volume = boxVolume(area);
    if (volume < bestVolume) {
      best = index;
      bestVolume = volume;
    }
  });
  return best;
}

/** Makes the area at `index` of `areaList` the active one. */
export function activated(set: AreaSet, index: number): AreaSet {
  const list = areaList(set);
  if (index < 0 || index >= list.length) return set;
  return split(list, index);
}

/**
 * Takes the area at `index` away.
 *
 * Removing the active one hands the role to the area listed just before it --
 * the nearest thing to "where you were" -- and removing the last area leaves
 * no selection at all, which is the same state Escape leaves.
 */
export function withoutArea(set: AreaSet, index: number): AreaSet {
  const list = areaList(set);
  if (index < 0 || index >= list.length) return set;
  const current = activeIndex(set);
  list.splice(index, 1);
  if (list.length === 0) return NO_AREAS;
  const next = index === current ? Math.max(0, index - 1) : current > index ? current - 1 : current;
  return split(list, next);
}

/** Every area through `map`, the active one staying active. */
export function mapAreas(set: AreaSet, map: (area: Region) => Region): AreaSet {
  if (set.active === null) return set;
  return { active: map(set.active), others: set.others.map(map), slot: set.slot };
}

/** The box around every area -- what the gizmo, the pivot and a paste go by. */
export function areaBounds(set: AreaSet): Region | null {
  return unionBounds(areaList(set));
}

/** How many cells the areas cover together, a cell in two counted once. */
export function areaCells(set: AreaSet): number {
  return unionVolume(areaList(set));
}
