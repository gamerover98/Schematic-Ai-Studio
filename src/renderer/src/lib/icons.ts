/**
 * The app's icons, as geometry rather than as characters.
 *
 * Every icon here used to be a Unicode glyph -- `⊞`, `×`, `⚙`, `⇅`, `⤓` --
 * typed into a button. That has two faults, and the first was reported:
 *
 * - **A glyph is not centred by anything.** Its box is the font's, not the
 *   drawing's, so `⊞` sits where Segoe UI Symbol puts it and `⧉` where a
 *   fallback font does, each with its own ascent and side bearing. The browse
 *   button beside every block field drew its glyph off to the right, and no
 *   amount of `text-align` fixes a box that does not match the ink inside it.
 * - **It is not the same picture on two machines.** Which font supplies `⤓`
 *   depends on what is installed, and an emoji is drawn by the platform's colour
 *   font in the platform's style.
 *
 * So each icon is drawn on a 24-unit square, stroked in `currentColor`, and
 * centred by the box it sits in. `Icon.svelte` renders this table; nothing else
 * draws an icon. `tests/ui.ts` refuses a button whose label is a glyph, so the
 * old way does not come back one button at a time.
 *
 * Drawn here rather than taken from an icon library: the set is small, the
 * project keeps its dependencies few, and every shape below is a handful of
 * lines and arcs on a grid.
 */

/** A rectangle on the 24-unit grid. `dashed` draws it the way empty space is drawn. */
export interface IconRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly rx?: number;
  readonly dashed?: boolean;
}

export interface IconCircle {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  /** Filled rather than stroked: a dot, not a ring. */
  readonly fill?: boolean;
}

export interface IconShape {
  /** Stroked paths. */
  readonly paths?: readonly string[];
  /** Filled paths, with no stroke. */
  readonly filled?: readonly string[];
  readonly rects?: readonly IconRect[];
  readonly circles?: readonly IconCircle[];
}

/**
 * A cog with eight flat teeth, built rather than written out: thirty-two
 * points alternating in pairs between the tip and the root of a tooth.
 */
function gear(): string {
  const points: string[] = [];
  const count = 32;
  for (let i = 0; i < count; i += 1) {
    const angle = ((i + 0.5) / count) * Math.PI * 2;
    const radius = Math.floor(i / 2) % 2 === 0 ? 9.5 : 7;
    const x = 12 + Math.cos(angle) * radius;
    const y = 12 + Math.sin(angle) * radius;
    points.push(`${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return `M${points.join(" L")} Z`;
}

/** A dot, for the dice and the grip. */
const dot = (cx: number, cy: number, r = 1.5): IconCircle => ({ cx, cy, r, fill: true });

export const ICONS = {
  close: { paths: ["M6 6 L18 18", "M18 6 L6 18"] },
  plus: { paths: ["M12 5 V19", "M5 12 H19"] },
  check: { paths: ["M5 12.5 L10 17.5 L19 7"] },
  chevronLeft: { paths: ["M15 5 L8 12 L15 19"] },
  chevronRight: { paths: ["M9 5 L16 12 L9 19"] },
  chevronDown: { paths: ["M5 9 L12 16 L19 9"] },
  arrowUp: { paths: ["M12 20 V5", "M6 11 L12 5 L18 11"] },
  arrowDown: { paths: ["M12 4 V19", "M6 13 L12 19 L18 13"] },
  /** Exchange two fields stacked one above the other. */
  swapVertical: { paths: ["M8 20 V4", "M4 8 L8 4 L12 8", "M16 4 V20", "M12 16 L16 20 L20 16"] },
  /** A mirror: one side becomes the other. */
  swapHorizontal: { paths: ["M4 8 H20", "M16 4 L20 8 L16 12", "M20 16 H4", "M8 12 L4 16 L8 20"] },
  /** The whole block list: a grid of tiles. */
  browse: {
    rects: [
      { x: 4, y: 4, w: 6.5, h: 6.5, rx: 1.5 },
      { x: 13.5, y: 4, w: 6.5, h: 6.5, rx: 1.5 },
      { x: 4, y: 13.5, w: 6.5, h: 6.5, rx: 1.5 },
      { x: 13.5, y: 13.5, w: 6.5, h: 6.5, rx: 1.5 },
    ],
  },
  /** Empty space: a cell with nothing in it. */
  air: { rects: [{ x: 4.5, y: 4.5, w: 15, h: 15, rx: 1, dashed: true }] },
  gear: { paths: [gear()], circles: [{ cx: 12, cy: 12, r: 3 }] },
  dice: {
    rects: [{ x: 4, y: 4, w: 16, h: 16, rx: 3.5 }],
    circles: [dot(8.5, 8.5), dot(15.5, 8.5), dot(12, 12), dot(8.5, 15.5), dot(15.5, 15.5)],
  },
  copy: {
    rects: [{ x: 9, y: 9, w: 11, h: 11, rx: 2 }],
    paths: ["M15 9 V6 A2 2 0 0 0 13 4 H6 A2 2 0 0 0 4 6 V13 A2 2 0 0 0 6 15 H9"],
  },
  paste: {
    rects: [
      { x: 5, y: 5, w: 14, h: 16, rx: 2 },
      { x: 9, y: 3, w: 6, h: 4, rx: 1 },
    ],
    paths: ["M9 13 L12 16 L15 13", "M12 9.5 V16"],
  },
  move: {
    paths: [
      "M12 3 V21",
      "M3 12 H21",
      "M9 6 L12 3 L15 6",
      "M9 18 L12 21 L15 18",
      "M6 9 L3 12 L6 15",
      "M18 9 L21 12 L18 15",
    ],
  },
  rotate: { paths: ["M20 12 A8 8 0 1 1 17.66 6.34 L20 8.5", "M20 3.5 V8.5 H15"] },
  scale: { paths: ["M5 19 L19 5", "M13 5 H19 V11", "M11 19 H5 V13"] },
  pivot: {
    circles: [{ cx: 12, cy: 12, r: 6 }, dot(12, 12, 1.2)],
    paths: ["M12 2 V6", "M12 18 V22", "M2 12 H6", "M18 12 H22"],
  },
  /** The selection's anchor: a ring with its centre marked. */
  anchor: { circles: [{ cx: 12, cy: 12, r: 8 }, dot(12, 12, 2.5)] },
  send: { paths: ["M4 12 H19", "M13 6 L19 12 L13 18"] },
  /** Stop a run: the square every player has pressed on a media control. */
  stop: { filled: ["M7 7 H17 V17 H7 Z"] },
  attach: {
    paths: ["M17 8.5 L9.5 16 A2.2 2.2 0 0 1 6.4 12.9 L14 5.3 A3.6 3.6 0 0 1 19.1 10.4 L11.3 18.2 A5.2 5.2 0 0 1 3.9 10.8 L10 4.7"],
  },
  eye: {
    paths: ["M2.5 12 C5.5 6.5 18.5 6.5 21.5 12 C18.5 17.5 5.5 17.5 2.5 12 Z"],
    circles: [{ cx: 12, cy: 12, r: 3 }],
  },
  eyeOff: {
    paths: ["M2.5 12 C5.5 6.5 18.5 6.5 21.5 12 C18.5 17.5 5.5 17.5 2.5 12 Z", "M4 4 L20 20"],
    circles: [{ cx: 12, cy: 12, r: 3 }],
  },
  more: { circles: [dot(6, 12), dot(12, 12), dot(18, 12)] },
  grip: { circles: [dot(9, 6), dot(15, 6), dot(9, 12), dot(15, 12), dot(9, 18), dot(15, 18)] },
  dot: { circles: [dot(12, 12, 4)] },
  ring: { circles: [{ cx: 12, cy: 12, r: 4 }] },
  sparkle: { filled: ["M12 3 L13.9 10.1 L21 12 L13.9 13.9 L12 21 L10.1 13.9 L3 12 L10.1 10.1 Z"] },
  /** The block in your hand: one block, seen from a corner. */
  block: { paths: ["M12 3 L20 7.5 V16.5 L12 21 L4 16.5 V7.5 Z", "M4 7.5 L12 12 L20 7.5", "M12 12 V21"] },
  /** The brush: a handle, and the tip that paints. */
  brush: {
    paths: [
      "M20 4 L12.5 11.5",
      "M12.5 11.5 C9.5 10 6.5 12 6.5 15 C6.5 17.5 5.5 19 4 20 C8.5 20.5 13 19 13.5 15 C13.7 13.6 13.3 12.3 12.5 11.5 Z",
    ],
  },
  /** A shape between two corners: a ball and its equator. */
  shape: { circles: [{ cx: 12, cy: 12, r: 8 }], paths: ["M4 12 C4 15.5 20 15.5 20 12"] },
  /** Walls, from above: a square round a square courtyard. */
  walls: {
    rects: [
      { x: 4, y: 4, w: 16, h: 16, rx: 1 },
      { x: 8.5, y: 8.5, w: 7, h: 7, rx: 0.5 },
    ],
  },
  /** Smoothing: a jagged line becoming a wave. */
  smooth: { paths: ["M3 15 L6 10 L8 13 L11 8", "M11 13 C14 9 17 9 21 13"] },
  /** Erosion: a block with its corner worn away, and the grains. */
  erode: {
    paths: ["M4 20 V8 H11 L16 13 V20 Z"],
    circles: [dot(18.5, 9.5, 1.2), dot(20.5, 6, 0.9), dot(16, 6.5, 0.9)],
  },
  /** Terrain: two hills on a line of ground. */
  terrain: {
    paths: ["M2.5 19 H21.5", "M2.5 19 L8.5 9 L12.5 15 L15.5 11 L21.5 19"],
  },
  /** Undo: an arrow turning back on itself; redo is its mirror. */
  undo: { paths: ["M9 13.5 L4.5 9 L9 4.5", "M4.5 9 H14 A5.5 5.5 0 0 1 14 20 H8"] },
  redo: { paths: ["M15 13.5 L19.5 9 L15 4.5", "M19.5 9 H10 A5.5 5.5 0 0 0 10 20 H16"] },
  /** The version history: a clock wound backwards. */
  history: {
    paths: ["M4.2 13 A8 8 0 1 0 6.4 6.3", "M3.5 3.5 V8 H8", "M12 7.5 V12 L15 14"],
  },
  /** A folder: open a file, or show one where it is on disk. */
  folder: { paths: ["M3.5 18.5 V5.5 H9.5 L11.5 7.5 H20.5 V18.5 Z", "M3.5 10.5 H20.5"] },
  /** The chat: a speech bubble, square as everything here is. */
  chat: { paths: ["M4.5 5.5 H19.5 V15.5 H11 L7 19.5 V15.5 H4.5 Z"] },
  /** The docked panels, on the side each one is on. */
  panelLeft: { rects: [{ x: 3.5, y: 4.5, w: 17, h: 15, rx: 1 }], paths: ["M9.5 4.5 V19.5"] },
  panelRight: { rects: [{ x: 3.5, y: 4.5, w: 17, h: 15, rx: 1 }], paths: ["M14.5 4.5 V19.5"] },
} satisfies Record<string, IconShape>;

export type IconName = keyof typeof ICONS;
