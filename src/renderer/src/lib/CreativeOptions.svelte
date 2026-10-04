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
  import { t } from "./i18n.svelte.js";

  interface Props {
    settings: CreativeSettings;
    onchange: (next: CreativeSettings) => void;
  }

  const { settings, onchange }: Props = $props();

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
  {/if}
  <p class="note">{t("creative.blockHint")}</p>
</div>

<style>
  .creative-options {
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 12px;
  }

  .segmented {
    display: flex;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-input);
  }

  .segmented button {
    flex: 1;
    min-width: 0;
    padding: 4px 2px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: none;
    color: var(--text-dim);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }

  .segmented button:hover {
    color: var(--text);
  }

  .segmented button.active {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--bg-panel);
  }

  .row {
    display: flex;
    gap: 8px;
    align-items: center;
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
    gap: 6px;
    align-items: center;
  }

  .note {
    margin: 0;
    color: var(--text-dim);
    font-size: 11px;
    line-height: 1.35;
  }
</style>
