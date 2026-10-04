/**
 * The creative tools, and what each of them keeps between sessions.
 *
 * In flight the right button used to mean one thing: place the block in your
 * hand. These are the other things it can mean, chosen on a bar over the
 * hotbar (`CreativeToolBar.svelte`) and cycled with B:
 *
 * - **place**, the block in your hand, exactly as before;
 * - **brush**, a sphere, a disc or a cube of the held block wherever the
 *   crosshair goes while the right button is held, and of empty space while
 *   the left one is -- one undo step a stroke;
 * - **shape**, a sphere, cylinder, pyramid or box between two corners clicked
 *   one after the other;
 * - **walls**, the same two clicks, and the four sides of the box between;
 * - **terrain**, a landscape from a noise painted in under the crosshair, the
 *   columns of a disc or a square at a time (`shared/terrain.ts`).
 *
 * The first four write through `EditRequest.shape`, so the geometry is
 * `shapes.ts`' -- WorldEdit's -- and the renderer's ghost is the same cells
 * the edit writes. Terrain writes through `EditRequest.terrain`, and its
 * ghost is the surface `heightField` gives, which is what the edit lays.
 *
 * Here rather than in `settings.ts` because main coerces it and the renderer
 * reasons about it, and neither of those wants the other's half.
 */

import type { ShapeAxis, ShapeMode } from "./shapes.js";
import { DEFAULT_HEIGHT_FIELD, type Footprint, type HeightField, type TerrainMode } from "./terrain.js";

export const CREATIVE_TOOLS = ["place", "brush", "shape", "walls", "terrain"] as const;
export type CreativeTool = (typeof CREATIVE_TOOLS)[number];

/**
 * What a brush is shaped like. A disc is one block tall, which is what paints
 * a floor; the other two are as tall as they are wide.
 */
export const BRUSH_SHAPES = ["sphere", "disc", "cube"] as const;
export type BrushShape = (typeof BRUSH_SHAPES)[number];

/** What the shape tool draws between its two corners. Walls are a tool of their own. */
export const CORNER_SHAPES = ["sphere", "cylinder", "pyramid", "box"] as const;
export type CornerShape = (typeof CORNER_SHAPES)[number];

/**
 * How big a brush may be: a radius, so 32 is 65 blocks across. Zero is one
 * block, which is a brush that paints a cell at a time.
 */
export const BRUSH_RADIUS = { min: 0, max: 32 } as const;

/**
 * How tall a shape or a wall is when its two corners are on one level. As a
 * floor, because the corners can still be on two levels and then decide it.
 */
export const TOOL_HEIGHT = { min: 1, max: 256 } as const;

/** A shell's thickness, as the tools offer it. `shapes.ts` allows up to 64. */
export const TOOL_THICKNESS = { min: 1, max: 16 } as const;

export interface BrushSettings {
  shape: BrushShape;
  radius: number;
  /**
   * Which cells a touch writes. The rubber -- the left button -- always
   * writes only over blocks, whatever this says: rubbing out empty space
   * would be filling it.
   */
  mode: ShapeMode;
}

export interface ShapeToolSettings {
  kind: CornerShape;
  /** A cylinder's own axis; the other kinds ignore it. */
  axis: ShapeAxis;
  hollow: boolean;
  thickness: number;
  height: number;
  mode: ShapeMode;
}

export interface WallToolSettings {
  height: number;
  thickness: number;
  mode: ShapeMode;
}

/**
 * The terrain, and the brush that paints it in.
 *
 * One terrain for the brush and for the selection's own Terrain button: the
 * settings are a landscape, and painting it in under the crosshair or laying
 * it over a box are two ways of putting the same one down.
 *
 * The three layers are mix spellings, the way a hotbar slot keeps one. The
 * hand is not what terrain is made of -- grass on top of dirt on top of stone
 * is three blocks, and the hand holds one.
 */
export interface TerrainToolSettings {
  radius: number;
  footprint: Footprint;
  /** What the right button does; the left one digs whatever this says. */
  mode: TerrainMode;
  field: HeightField;
  surface: string;
  subsoil: string;
  subsoilDepth: number;
  rock: string;
}

export interface CreativeSettings {
  /** The tool the right button is. Kept, so flight comes back holding it. */
  tool: CreativeTool;
  brush: BrushSettings;
  shape: ShapeToolSettings;
  walls: WallToolSettings;
  terrain: TerrainToolSettings;
}

export const DEFAULT_CREATIVE_SETTINGS: CreativeSettings = {
  tool: "place",
  brush: { shape: "sphere", radius: 2, mode: "all" },
  shape: { kind: "sphere", axis: "y", hollow: false, thickness: 1, height: 5, mode: "all" },
  // Four, which is a wall somebody can see over the top of from the ground and
  // not walk over: the plan's number, and a room's.
  walls: { height: 4, thickness: 1, mode: "all" },
  // Three blocks of dirt under the grass, which is about what the game's own
  // plains have before the stone starts.
  terrain: {
    radius: 6,
    footprint: "disc",
    mode: "set",
    field: DEFAULT_HEIGHT_FIELD,
    surface: "minecraft:grass_block",
    subsoil: "minecraft:dirt",
    subsoilDepth: 3,
    rock: "minecraft:stone",
  },
};
