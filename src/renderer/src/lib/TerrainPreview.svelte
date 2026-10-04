<script lang="ts">
  /**
   * The terrain's surface over an area, seen from above, before anything is
   * written.
   *
   * Every pixel is a column and its shade is the height `heightField` gives
   * it -- the function the edit itself asks, so the picture is the landscape
   * and not an estimate of it. Lit from the north-west by the slope to the
   * neighbouring column, which is what makes a field of greys read as hills.
   * North is at the top, as on `DistributionPreview`'s `xz` plane.
   */
  import type { Box } from "../../../shared/regions.js";
  import { heightMap, type HeightField } from "../../../shared/terrain.js";
  import { t } from "./i18n.svelte.js";

  interface Props {
    field: HeightField;
    /** What to draw: the selection, or the schematic. Only its footprint is read. */
    frame: Box;
    /** `DocumentState.frame`: where the noise is read. */
    origin: readonly [number, number, number];
  }

  const { field, frame, origin }: Props = $props();

  /** Pixels a side at most: a thumbnail, so wider areas are sampled. */
  const SIDE = 96;

  let canvas = $state<HTMLCanvasElement | null>(null);

  const map = $derived(heightMap(field, frame, SIDE, origin));

  $effect(() => {
    const target = canvas;
    if (target === null) return;
    const { width, height, tops } = map;
    target.width = width;
    target.height = height;
    const context = target.getContext("2d");
    if (context === null) return;
    const image = context.createImageData(width, height);
    // The shade spans the relief the settings allow, not the part of it this
    // area happens to reach: a flat corner of a hilly landscape is dark and
    // flat, not stretched into hills of its own.
    const low = field.base;
    const span = Math.max(1, field.amplitude);
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        const i = row * width + column;
        const here = tops[i];
        const west = column > 0 ? tops[i - 1] : here;
        const north = row > 0 ? tops[i - width] : here;
        const light = Math.max(-40, Math.min(40, (here - west + here - north) * 10));
        const level = 40 + 170 * ((here - low) / span) + light;
        const value = Math.max(0, Math.min(255, Math.round(level)));
        image.data[i * 4] = value;
        image.data[i * 4 + 1] = value;
        image.data[i * 4 + 2] = value;
        image.data[i * 4 + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
  });
</script>

<figure class="terrain-map">
  <canvas bind:this={canvas} aria-label={t("terrain.previewLabel")}></canvas>
  <figcaption>
    {t("terrain.previewRange", { low: map.lowest, high: map.highest })}
  </figcaption>
</figure>

<style>
  .terrain-map {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    margin: 0;
  }

  canvas {
    width: 100%;
    max-width: 192px;
    aspect-ratio: auto;
    image-rendering: pixelated;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-input);
  }

  figcaption {
    font-size: 11px;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }
</style>
