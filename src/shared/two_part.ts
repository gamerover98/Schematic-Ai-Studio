/**
 * Blocks that are two cells in the file and one thing to a person.
 *
 * A bed is a foot and a head; a door is a lower half and an upper; a sunflower
 * is a stalk and a flower. Three places ask about them and they are not the
 * same question:
 *
 * - **placing** one places both halves (`twoPartPlacement` in
 *   `services/session.ts`), and opening a door opens both;
 * - **counting** one counts it once -- the materials list said a bed was two
 *   beds, which is true of the file and false of the build;
 * - **drawing** one draws both -- an icon of a bed's foot alone is half a bed,
 *   and it looked like a broken model.
 *
 * In `shared/` because the second and third are asked by the icons and the
 * materials list as well as by the placement, and the table was a private
 * constant of the session.
 *
 * The extended piston is in the counting and the drawing and **not** in the
 * placement. Its head is a block with a different name, `piston_head`, which
 * the game puts there when the piston fires; placing a piston places a
 * retracted one, in the game and here, so there is no "whole" to place.
 */

import { legalValuesFor } from "./block_states.js";

/** A block as these rules read it: a name and its block states. */
export interface BlockState {
  readonly namespacedName: string;
  readonly properties: Readonly<Record<string, string>>;
}

type Step = readonly [number, number, number];

export interface TwoPartFamily {
  readonly matches: (name: string) => boolean;
  readonly property: string;
  readonly near: string;
  readonly far: string;
  /**
   * One cell from the near half to the far one, or `null` for the family
   * whose second cell is decided by `facing`, which is the bed: its head goes
   * one cell the way you were looking when you laid it. A door's is always
   * the cell above, whichever way it faces.
   */
  readonly step: Step | null;
}

/**
 * The families that are one block to place and two blocks in the file.
 *
 * Both are states the game cannot hold on their own -- a lone bed foot drops
 * as an item the moment anything updates it, and a lone door half is a door
 * you can walk through -- and both were being written as one block, so the
 * schematic looked right here and came apart when it was pasted.
 *
 * A request that already names the far half -- `part=head`, `half=upper` -- is
 * somebody placing one half on purpose: the inspector, a paste, an agent tool.
 * Those are left alone. Only an absent value, or the near one, means "place the
 * whole thing", and the same reading decides what an icon draws.
 */
export const TWO_PART: readonly TwoPartFamily[] = [
  { matches: (name) => name.endsWith("_bed"), property: "part", near: "foot", far: "head", step: null },
  // `_trapdoor` does not end in `_door`, which is why this needs no guard --
  // `tests/session.ts` says so, because it is the kind of thing that reads as
  // true and would be relied on without ever being checked.
  { matches: (name) => name.endsWith("_door"), property: "half", near: "lower", far: "upper", step: [0, 1, 0] },
  /*
   * The double plants: tall grass, large fern, the four tall flowers, tall
   * seagrass, the small dripleaf and the pitcher plant. Vanilla's
   * `DoublePlantBlock` places both halves, and a lone lower half is a tuft cut
   * off at the top. Asked of the registry rather than listed: a `half` whose
   * legal values are `lower` and `upper` is exactly that family (a stair's
   * or a slab's is `top`/`bottom`). The pitcher *crop* has the property and
   * is not one of them: it is planted as a seed and grows its upper half from
   * stage 3, so placing it is one cell.
   *
   * The pre-Flattening era needs nothing of its own: `legacy_blocks.json`
   * maps `175:0..5` and `175:8..13` onto these same six names with
   * `half=lower` and `half=upper`, so a 1.8.8 to 1.12.2 document holds them
   * spelled this way and the MCEdit writer maps both halves back.
   */
  { matches: isDoublePlant, property: "half", near: "lower", far: "upper", step: [0, 1, 0] },
];

function isDoublePlant(name: string): boolean {
  if (name.endsWith("_door") || name === "minecraft:pitcher_crop") return false;
  const values = legalValuesFor(name, "half");
  return values !== null && values.length === 2 && values.includes("lower") && values.includes("upper");
}

export function twoPartFamily(name: string): TwoPartFamily | undefined {
  return TWO_PART.find((candidate) => candidate.matches(name));
}

/** One cell along each horizontal facing, as `[dx, dy, dz]`. */
export const FACING_STEP: Readonly<Record<string, Step>> = {
  north: [0, 0, -1],
  south: [0, 0, 1],
  west: [-1, 0, 0],
  east: [1, 0, 0],
};

/** ...and the two a piston can also point. */
const DIRECTION_STEP: Readonly<Record<string, Step>> = {
  ...FACING_STEP,
  up: [0, 1, 0],
  down: [0, -1, 0],
};

const PISTONS: Readonly<Record<string, "normal" | "sticky">> = {
  "minecraft:piston": "normal",
  "minecraft:sticky_piston": "sticky",
};

const PISTON_HEAD = "minecraft:piston_head";

/** Both halves of one block, and which way the second lies from the first. */
export interface Whole {
  readonly near: BlockState;
  readonly far: BlockState;
  readonly step: Step;
}

/**
 * The whole a block stands for, when it stands for one of two cells.
 *
 * `null` for every other block, for a far half on its own -- a door's upper
 * half typed into the inspector is one cell and means one cell -- and for a
 * facing no placement produces.
 *
 * An absent value is the near half: that is what placing reads it as, and a
 * bare `minecraft:red_bed` in the inventory is a bed, not a foot.
 */
export function wholeOf(block: BlockState): Whole | null {
  const piston = PISTONS[block.namespacedName];
  if (piston !== undefined) {
    if (block.properties.extended !== "true") return null;
    const facing = block.properties.facing ?? "north";
    const step = DIRECTION_STEP[facing];
    if (step === undefined) return null;
    return {
      near: { ...block, properties: { ...block.properties, facing } },
      far: { namespacedName: PISTON_HEAD, properties: { facing, short: "false", type: piston } },
      step,
    };
  }

  const family = twoPartFamily(block.namespacedName);
  if (family === undefined) return null;
  const held = block.properties[family.property];
  if (held !== undefined && held !== family.near) return null;
  /*
   * A bed's facing is written into both halves when it was left out. The
   * step is taken from it, and a shape that read an absent facing its own
   * way would draw the head turned away from the foot it was put beside.
   */
  const facing: Record<string, string> =
    family.step === null ? { facing: block.properties.facing ?? "north" } : {};
  const step = family.step ?? FACING_STEP[facing.facing ?? "north"];
  if (step === undefined) return null;
  return {
    near: { ...block, properties: { ...block.properties, ...facing, [family.property]: family.near } },
    far: { ...block, properties: { ...block.properties, ...facing, [family.property]: family.far } },
    step,
  };
}

/**
 * Where a far half's near half is, and what it has to be to count as one.
 *
 * `step` goes from the far cell back to the near one. `key` is what the near
 * half must answer from `nearKey`: the same name, and for a bed and a piston
 * the same facing as well -- otherwise the step from the near side would not
 * lead back here, and the two are neighbours rather than one block.
 *
 * `null` for anything that is not a far half.
 */
export function nearOf(block: BlockState): { step: Step; key: string } | null {
  if (block.namespacedName === PISTON_HEAD) {
    const facing = block.properties.facing ?? "north";
    const step = DIRECTION_STEP[facing];
    if (step === undefined) return null;
    const base = block.properties.type === "sticky" ? "minecraft:sticky_piston" : "minecraft:piston";
    return { step: back(step), key: `${base}|${facing}` };
  }
  const family = twoPartFamily(block.namespacedName);
  if (family === undefined || block.properties[family.property] !== family.far) return null;
  if (family.step !== null) return { step: back(family.step), key: block.namespacedName };
  const facing = block.properties.facing ?? "north";
  const step = FACING_STEP[facing];
  if (step === undefined) return null;
  return { step: back(step), key: `${block.namespacedName}|${facing}` };
}

/** The key a near half answers with, for `nearOf`; `null` for anything else. */
export function nearKey(block: BlockState): string | null {
  const piston = PISTONS[block.namespacedName];
  if (piston !== undefined) {
    return block.properties.extended === "true"
      ? `${block.namespacedName}|${block.properties.facing ?? "north"}`
      : null;
  }
  const family = twoPartFamily(block.namespacedName);
  if (family === undefined) return null;
  const held = block.properties[family.property];
  // Absent is the near half here too: it is what the block is drawn as, the
  // registry's default being the foot and the lower half.
  if (held !== undefined && held !== family.near) return null;
  return family.step !== null
    ? block.namespacedName
    : `${block.namespacedName}|${block.properties.facing ?? "north"}`;
}

function back(step: Step): Step {
  return [-step[0], -step[1], -step[2]];
}
