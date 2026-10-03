<script lang="ts">
  /**
   * The distribution, drawn: one plane of the field, and the block each cell of
   * it would get.
   *
   * Closed, it is a thumbnail of the blocks beside the shares, so a mix shows
   * what it will do before anybody opens its parameters. Open, beside the
   * parameters, it is the field in grey and the blocks side by side, with the
   * plane and where it cuts -- which is what makes a frequency or a cell size
   * something you can see rather than a number you guess at.
   *
   * The map is `shared/distribution_map.ts`, the same answer `pickAt` gives,
   * over the frame a fill would cover. Each block is painted in its own colour,
   * the average of its icon; similar blocks then look alike, which is the
   * point of the picture and also why "distinct colours" exists.
   */
  import { DEFAULT_FRAME, effectiveShares, type BlockMix } from "../../../shared/block_mix.js";
  import {
    categoryColour,
    distributionMap,
    entryPixels,
    levelRange,
    MAP_PLANES,
    valuePixels,
    type MapPlane,
  } from "../../../shared/distribution_map.js";
  import type { Box } from "../../../shared/regions.js";
  import { blockIcons } from "./block_icons.svelte.js";
  import { shortName } from "./block_spelling.js";
  import { t } from "./i18n.svelte.js";
  import { iconColour, type Rgb } from "./icon_colour.js";

  interface Props {
    mix: BlockMix;
    /** What a fill would cover; `null` for the hand's own default. */
    frame: Box | null;
    /** The field and the plane's controls as well as the blocks. */
    expanded: boolean;
  }

  const { mix, frame, expanded }: Props = $props();

  const box = $derived(frame ?? DEFAULT_FRAME);
  let plane = $state<MapPlane>("xz");
  /** Where the plane cuts, once somebody has moved it; the middle until then. */
  let chosen = $state<number | null>(null);
  const range = $derived(levelRange(box, plane));
  const level = $derived(
    chosen === null ? Math.floor((range.min + range.max) / 2) : Math.min(range.max, Math.max(range.min, chosen)),
  );
  const map = $derived(distributionMap({ mix, frame: box, plane, level }));
  const shares = $derived(effectiveShares(mix.entries));
  const pixels = $derived(map.width * map.height);

  /** Each block's own colour, filled in as its icon is read. */
  const icons = $derived(blockIcons());
  let colours = $state<Record<string, Rgb>>({});
  let distinct = $state(false);

  $effect(() => {
    for (const entry of mix.entries) {
      const url = icons.get(entry.block);
      if (url === undefined || colours[entry.block] !== undefined) continue;
      const block = entry.block;
      void iconColour(url).then((rgb) => {
        if (rgb !== null) colours = { ...colours, [block]: rgb };
      });
    }
  });

  function colourOf(index: number): Rgb {
    if (distinct) return categoryColour(index);
    const block = mix.entries[index]?.block;
    return (block !== undefined ? colours[block] : undefined) ?? categoryColour(index);
  }

  const css = (rgb: Rgb): string => `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;

  let blocksCanvas = $state<HTMLCanvasElement | null>(null);
  let noiseCanvas = $state<HTMLCanvasElement | null>(null);

  function paint(canvas: HTMLCanvasElement | null, data: Uint8ClampedArray, width: number, height: number): void {
    if (canvas === null) return;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context === null) return;
    const image = context.createImageData(width, height);
    image.data.set(data);
    context.putImageData(image, 0, 0);
  }

  $effect(() => {
    paint(blocksCanvas, entryPixels(map, colourOf), map.width, map.height);
  });
  $effect(() => {
    paint(noiseCanvas, valuePixels(map), map.width, map.height);
  });

  const size = $derived(
    `${box.maxX - box.minX + 1}×${box.maxY - box.minY + 1}×${box.maxZ - box.minZ + 1}`,
  );
</script>

<div class="mix-map" class:expanded>
  {#if expanded}
    <div class="controls">
      <div class="planes" role="group" aria-label={t("mix.map.plane")}>
        {#each MAP_PLANES as option (option)}
          <button
            type="button"
            class:on={plane === option}
            aria-pressed={plane === option}
            title={t(`mix.map.planeHint.${option}`)}
            onclick={() => {
              plane = option;
              chosen = null;
            }}
          >
            {t(`mix.map.plane.${option}`)}
          </button>
        {/each}
      </div>
      {#if range.max > range.min}
        <label class="level" title={t("mix.map.level", { axis: range.axis })}>
          <span class="axis">{range.axis} = {level}</span>
          <input
            type="range"
            min={range.min}
            max={range.max}
            step="1"
            value={level}
            aria-label={t("mix.map.level", { axis: range.axis })}
            oninput={(event) => (chosen = Number(event.currentTarget.value))}
          />
        </label>
      {/if}
    </div>
  {/if}

  <div class="maps">
    {#if expanded}
      <figure>
        <canvas bind:this={noiseCanvas} title={t("mix.map.noiseHint")}></canvas>
        <figcaption>{t("mix.map.noise")}</figcaption>
      </figure>
    {/if}
    <figure>
      <canvas bind:this={blocksCanvas} title={t("mix.map.blocksHint", { size })}></canvas>
      {#if expanded}
        <figcaption>{t("mix.map.blocks")}</figcaption>
      {/if}
    </figure>
    {#if !expanded}
      <ul class="legend">
        {#each mix.entries as entry, index (`${index}:${entry.block}`)}
          <li title={t("mix.map.share", { here: Math.round((100 * (map.counts[index] ?? 0)) / pixels), asked: Math.round(100 * shares[index]) })}>
            <span class="swatch" style:background={css(colourOf(index))}></span>
            <span class="name">{shortName(entry.block)}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  {#if expanded}
    <ul class="legend wide">
      {#each mix.entries as entry, index (`${index}:${entry.block}`)}
        <li>
          <span class="swatch" style:background={css(colourOf(index))}></span>
          <span class="name">{shortName(entry.block)}</span>
          <span class="share">
            {t("mix.map.share", { here: Math.round((100 * (map.counts[index] ?? 0)) / pixels), asked: Math.round(100 * shares[index]) })}
          </span>
        </li>
      {/each}
    </ul>
    <label class="distinct" title={t("mix.map.distinctHint")}>
      <input type="checkbox" bind:checked={distinct} />
      {t("mix.map.distinct")}
    </label>
  {/if}
</div>

<style>
  .mix-map {
    margin-top: 4px;
    font-size: 10px;
    color: var(--text-dim);
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    margin-bottom: 4px;
  }

  .planes {
    display: flex;
  }

  .planes button {
    padding: 1px 6px;
    font-size: 10px;
    border-radius: 0;
  }

  .planes button:first-child {
    border-radius: 4px 0 0 4px;
  }

  .planes button:last-child {
    border-radius: 0 4px 4px 0;
  }

  .planes button + button {
    margin-left: -1px;
  }

  .planes button.on {
    border-color: var(--accent);
    color: var(--accent);
    position: relative;
  }

  .level {
    flex: 1 1 100px;
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 0;
    min-width: 0;
  }

  .level input {
    flex: 1 1 auto;
    min-width: 0;
  }

  .axis {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .maps {
    display: flex;
    align-items: flex-start;
    gap: 6px;
  }

  figure {
    margin: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }

  .expanded figure {
    flex: 1 1 0;
    min-width: 0;
  }

  canvas {
    display: block;
    width: 56px;
    height: auto;
    max-height: 56px;
    object-fit: contain;
    image-rendering: pixelated;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg-input);
  }

  .expanded canvas {
    width: 100%;
    max-height: 160px;
  }

  .legend {
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .legend li {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }

  .legend.wide {
    margin-top: 4px;
  }

  .swatch {
    flex: none;
    width: 9px;
    height: 9px;
    border-radius: 2px;
    border: 1px solid var(--border);
  }

  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
  }

  .share {
    margin-left: auto;
    flex: none;
    font-variant-numeric: tabular-nums;
  }

  .distinct {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 4px 0 0;
  }

  .distinct input {
    margin: 0;
  }
</style>
