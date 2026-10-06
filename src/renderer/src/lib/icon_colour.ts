/**
 * The colour a block reads as, from its icon.
 *
 * The distribution map paints each cell in the colour of the block it would
 * get, so the picture looks like the fill rather than like a chart. The icons
 * are already drawn -- `block_icons.svelte.ts` meshes them through the same
 * pipeline as the viewport -- so the colour is their average, which is what a
 * block looks like from far enough away to be one pixel.
 *
 * `averageColour` is the arithmetic and is tested; `iconColour` is the part
 * that needs a canvas, and the harness has none.
 */

export type Rgb = readonly [number, number, number];

/**
 * The average of the pixels, weighted by how opaque each is, so the
 * transparent margin round an icon counts for nothing. `null` for an icon
 * with nothing in it.
 */
export function averageColour(rgba: ArrayLike<number>): Rgb | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let weight = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const a = rgba[i + 3];
    if (a === 0) continue;
    r += rgba[i] * a;
    g += rgba[i + 1] * a;
    b += rgba[i + 2] * a;
    weight += a;
  }
  if (weight === 0) return null;
  return [Math.round(r / weight), Math.round(g / weight), Math.round(b / weight)];
}

const colours = new Map<string, Promise<Rgb | null>>();

/** The average colour of the icon at `url`, worked out once per icon. */
export function iconColour(url: string): Promise<Rgb | null> {
  const held = colours.get(url);
  if (held !== undefined) return held;
  const found = new Promise<Rgb | null>((resolve) => {
    const image = new Image();
    image.onload = () => {
      const width = image.naturalWidth || 1;
      const height = image.naturalHeight || 1;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (context === null) {
        resolve(null);
        return;
      }
      context.drawImage(image, 0, 0);
      resolve(averageColour(context.getImageData(0, 0, width, height).data));
    };
    image.onerror = () => resolve(null);
    image.src = url;
  });
  colours.set(url, found);
  return found;
}
