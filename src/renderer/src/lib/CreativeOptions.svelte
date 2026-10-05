<script lang="ts">
  /**
   * The options of the creative tool in hand, in a floating window.
   *
   * One panel whose contents follow the tool, rather than a panel per tool:
   * only one tool is ever in hand, and a window that changed size and place
   * with every press of B would be chasing the bar. The block is not here --
   * every tool writes what the hotbar holds, mix and distribution included,
   * which is the one answer to "what am I building with" the app has.
   *
   * Every change goes out whole through `onchange`; the settings are the
   * app's, written behind a short delay so a slider dragged is one write.
   */
  import {
    BRUSH_RADIUS,
    BRUSH_SHAPES,
    CORNER_SHAPES,
    TOOL_HEIGHT,
    TOOL_THICKNESS,
    type CreativeSettings,
  } from "../../../shared/creative.js";
  import { SHAPE_AXES, SHAPE_MODES, type ShapeMode } from "../../../shared/shapes.js";
  import type { LegacyIndex } from "../../../shared/legacy_ids.js";
  import type { Box } from "../../../shared/regions.js";
  import TerrainOptions from "./TerrainOptions.svelte";
  import { EROSION_PRESET_NAMES, FOOTPRINTS, SMOOTH_ITERATIONS, type ErosionPreset } from "../../../shared/terrain.js";
  import { t } from "./i18n.svelte.js";

  interface Props {
    settings: CreativeSettings;
    onchange: (next: CreativeSettings) => void;
    /** For the terrain's layers, which are block fields of their own. */
    blocks?: readonly string[];
    placeable?: ReadonlySet<string> | null;
    legacy?: LegacyIndex | null;
    /** What the terrain's picture shows: the schematic's footprint. */
    frame?: Box;
    /** `DocumentState.frame`, where the terrain's noise is read. */
    origin?: readonly [number, number, number];
  }

  const {
    settings,
    onchange,
    blocks = [],
    placeable = null,
    legacy = null,
    frame = { minX: 0, minY: 0, minZ: 0, maxX: 63, maxY: 63, maxZ: 63 },
    origin = [0, 0, 0],
  }: Props = $props();

  /** A whole number inside a range, or the value it replaces when it is not one. */
  function bounded(raw: string, range: { readonly min: number; readonly max: number }, fallback: number): number {
    const value = Math.round(Number(raw));
    return Number.isFinite(value) ? Math.min(range.max, Math.max(range.min, value)) : fallback;
  }

  function brush(patch: Partial<CreativeSettings["brush"]>): void {
    onchange({ ...settings, brush: { ...settings.brush, ...patch } });
  }

  function shape(patch: Partial<CreativeSettings["shape"]>): void {
    onchange({ ...settings, shape: { ...settings.shape, ...patch } });
  }

  function walls(patch: Partial<CreativeSettings["walls"]>): void {
    onchange({ ...settings, walls: { ...settings.walls, ...patch } });
  }

  function smooth(patch: Partial<CreativeSettings["smooth"]>): void {
    onchange({ ...settings, smooth: { ...settings.smooth, ...patch } });
  }

  function erode(patch: Partial<CreativeSettings["erode"]>): void {
    onchange({ ...settings, erode: { ...settings.erode, ...patch } });
  }
</script>

{#snippet modes(value: ShapeMode, set: (mode: ShapeMode) => void)}
  <label class="row">
    <span>{t("creative.mode")}</span>
    <select value={value} onchange={(event) => set((event.currentTarget as HTMLSelectElement).value as ShapeMode)}>
      {#each SHAPE_MODES as mode (mode)}
        <option value={mode}>{t(`creative.mode.${mode}`)}</option>
      {/each}
    </select>
  </label>
  <p class="note">{t(`creative.modeHint.${value}`)}</p>
{/snippet}

<div class="creative-options">
  {#if settings.tool === "brush"}
    <div class="segmented" role="group" aria-label={t("creative.brushShape")}>
      {#each BRUSH_SHAPES as kind (kind)}
        <button
          class:active={settings.brush.shape === kind}
          aria-pressed={settings.brush.shape === kind}
          onclick={() => brush({ shape: kind })}
        >
          {t(`creative.brushShape.${kind}`)}
        </button>
      {/each}
    </div>
    <label class="row">
      <span>{t("creative.radius")}</span>
      <input
        type="range"
        min={BRUSH_RADIUS.min}
        max={BRUSH_RADIUS.max}
        value={settings.brush.radius}
        oninput={(event) =>
          brush({ radius: bounded(event.currentTarget.value, BRUSH_RADIUS, settings.brush.radius) })}
      />
      <output>{settings.brush.radius}</output>
    </label>
    <p class="note">{t("creative.radiusHint", { size: settings.brush.radius * 2 + 1 })}</p>
    {@render modes(settings.brush.mode, (mode) => brush({ mode }))}
    <p class="note">{t("creative.brushHint")}</p>
  {:else if settings.tool === "shape"}
    <div class="segmented" role="group" aria-label={t("creative.shapeKind")}>
      {#each CORNER_SHAPES as kind (kind)}
        <button
          class:active={settings.shape.kind === kind}
          aria-pressed={settings.shape.kind === kind}
          onclick={() => shape({ kind })}
        >
          {t(`creative.shapeKind.${kind}`)}
        </button>
      {/each}
    </div>
    {#if settings.shape.kind === "cylinder"}
      <div class="segmented" role="group" aria-label={t("creative.axis")}>
        {#each SHAPE_AXES as axis (axis)}
          <button
            class:active={settings.shape.axis === axis}
            aria-pressed={settings.shape.axis === axis}
            onclick={() => shape({ axis })}
          >
            {t(`creative.axis.${axis}`)}
          </button>
        {/each}
      </div>
    {/if}
    <label class="row">
      <span>{t("creative.height")}</span>
      <input
        type="number"
        min={TOOL_HEIGHT.min}
        max={TOOL_HEIGHT.max}
        value={settings.shape.height}
        onchange={(event) =>
          shape({ height: bounded(event.currentTarget.value, TOOL_HEIGHT, settings.shape.height) })}
      />
    </label>
    <label class="check">
      <input
        type="checkbox"
        checked={settings.shape.hollow}
        onchange={(event) => shape({ hollow: event.currentTarget.checked })}
      />
      <span>{t("creative.hollow")}</span>
    </label>
    {#if settings.shape.hollow}
      <label class="row">
        <span>{t("creative.thickness")}</span>
        <input
          type="number"
          min={TOOL_THICKNESS.min}
          max={TOOL_THICKNESS.max}
          value={settings.shape.thickness}
          onchange={(event) =>
            shape({ thickness: bounded(event.currentTarget.value, TOOL_THICKNESS, settings.shape.thickness) })}
        />
      </label>
    {/if}
    {@render modes(settings.shape.mode, (mode) => shape({ mode }))}
    <p class="note">{t("creative.cornersHint")}</p>
  {:else if settings.tool === "walls"}
    <label class="row">
      <span>{t("creative.height")}</span>
      <input
        type="number"
        min={TOOL_HEIGHT.min}
        max={TOOL_HEIGHT.max}
        value={settings.walls.height}
        onchange={(event) =>
          walls({ height: bounded(event.currentTarget.value, TOOL_HEIGHT, settings.walls.height) })}
      />
    </label>
    <label class="row">
      <span>{t("creative.thickness")}</span>
      <input
        type="number"
        min={TOOL_THICKNESS.min}
        max={TOOL_THICKNESS.max}
        value={settings.walls.thickness}
        onchange={(event) =>
          walls({ thickness: bounded(event.currentTarget.value, TOOL_THICKNESS, settings.walls.thickness) })}
      />
    </label>
    {@render modes(settings.walls.mode, (mode) => walls({ mode }))}
    <p class="note">{t("creative.cornersHint")}</p>
  {:else if settings.tool === "terrain"}
    <TerrainOptions
      settings={settings.terrain}
      onchange={(terrain) => onchange({ ...settings, terrain })}
      brush
      {blocks}
      {placeable}
      {legacy}
      {frame}
      {origin}
      idPrefix="creative-terrain"
    />
    <p class="note">{t("creative.terrainHint")}</p>
  {:else if settings.tool === "smooth"}
    <div class="segmented" role="group" aria-label={t("terrain.footprint")}>
      {#each FOOTPRINTS as footprint (footprint)}
        <button
          class:active={settings.smooth.footprint === footprint}
          aria-pressed={settings.smooth.footprint === footprint}
          onclick={() => smooth({ footprint })}
        >
          {t(`terrain.footprint.${footprint}`)}
        </button>
      {/each}
    </div>
    <label class="row">
      <span>{t("creative.radius")}</span>
      <input
        type="range"
        min={BRUSH_RADIUS.min}
        max={BRUSH_RADIUS.max}
        value={settings.smooth.radius}
        oninput={(event) => smooth({ radius: bounded(event.currentTarget.value, BRUSH_RADIUS, settings.smooth.radius) })}
      />
      <output>{settings.smooth.radius}</output>
    </label>
    <label class="row">
      <span>{t("creative.passes")}</span>
      <input
        type="number"
        min={SMOOTH_ITERATIONS.min}
        max={SMOOTH_ITERATIONS.max}
        value={settings.smooth.iterations}
        onchange={(event) =>
          smooth({ iterations: bounded(event.currentTarget.value, SMOOTH_ITERATIONS, settings.smooth.iterations) })}
      />
    </label>
    <p class="note">{t("creative.smoothHint")}</p>
  {:else if settings.tool === "erode"}
    <label class="row">
      <span>{t("creative.preset")}</span>
      <select
        value={settings.erode.preset}
        onchange={(event) => erode({ preset: event.currentTarget.value as ErosionPreset })}
      >
        {#each EROSION_PRESET_NAMES as preset (preset)}
          <option value={preset}>{t(`erode.preset.${preset}`)}</option>
        {/each}
      </select>
    </label>
    <p class="note">{t(`erode.presetHint.${settings.erode.preset}`)}</p>
    <label class="row">
      <span>{t("creative.radius")}</span>
      <input
        type="range"
        min={BRUSH_RADIUS.min}
        max={BRUSH_RADIUS.max}
        value={settings.erode.radius}
        oninput={(event) => erode({ radius: bounded(event.currentTarget.value, BRUSH_RADIUS, settings.erode.radius) })}
      />
      <output>{settings.erode.radius}</output>
    </label>
    <p class="note">{t("creative.erodeHint")}</p>
  {/if}
  {#if settings.tool !== "terrain" && settings.tool !== "smooth" && settings.tool !== "erode"}
    <p class="note">{t("creative.blockHint")}</p>
  {/if}
</div>

<style>
  /* The tool's choices are app.css's `.segmented`, as everywhere else. */
  .creative-options {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    font-size: var(--text-sm);
  }

  .row {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    margin: 0;
  }

  .row > span {
    flex: 0 0 72px;
    color: var(--text-dim);
  }

  .row input[type="range"] {
    flex: 1;
    min-width: 0;
  }

  .row input[type="number"],
  .row select {
    flex: 1;
    min-width: 0;
  }

  output {
    min-width: 2ch;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .check {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    margin: 0;
    color: var(--text);
  }

  .note {
    margin: 0;
    color: var(--text-dim);
    font-size: var(--text-sm);
    line-height: 1.4;
  }
</style>
