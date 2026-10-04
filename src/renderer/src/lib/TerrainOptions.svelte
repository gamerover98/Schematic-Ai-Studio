<script lang="ts">
  /**
   * What a terrain is made of: the noise its surface comes from, how high
   * that surface runs, how it meets what is there, and its three layers.
   *
   * One panel for the two places a terrain is put down -- painted in by the
   * creative brush, and laid over the selection -- because they put down the
   * same landscape (`CreativeSettings.terrain`). `brush` adds what only the
   * brush has: its footprint and its radius.
   *
   * The noise is edited the way a mix's distribution is, with the same names
   * for the same parameters (`mix.param.*`), and the picture under it is the
   * surface itself (`TerrainPreview`), not the noise.
   */
  import { DISTRIBUTION_PARAMS, freshSeed, normalizeDistribution, resolveParams, type ParamValue } from "../../../shared/block_mix.js";
  import { BRUSH_RADIUS, type TerrainToolSettings } from "../../../shared/creative.js";
  import type { LegacyIndex } from "../../../shared/legacy_ids.js";
  import type { Box } from "../../../shared/regions.js";
  import {
    FOOTPRINTS,
    SUBSOIL_DEPTH,
    TERRAIN_AMPLITUDE,
    TERRAIN_BASE,
    TERRAIN_MODES,
    TERRAIN_NOISES,
    type TerrainMode,
    type TerrainNoise,
  } from "../../../shared/terrain.js";
  import BlockMixField from "./BlockMixField.svelte";
  import Icon from "./Icon.svelte";
  import TerrainPreview from "./TerrainPreview.svelte";
  import { t } from "./i18n.svelte.js";

  interface Props {
    settings: TerrainToolSettings;
    onchange: (next: TerrainToolSettings) => void;
    /** Show the brush's footprint and radius. */
    brush?: boolean;
    blocks: readonly string[];
    placeable?: ReadonlySet<string> | null;
    legacy?: LegacyIndex | null;
    /** What the picture shows: the selection, or the schematic. */
    frame: Box;
    /** `DocumentState.frame`, where the noise is read. */
    origin: readonly [number, number, number];
    /** Prefixes the fields' ids, so two panels on screen do not share them. */
    idPrefix?: string;
  }

  const {
    settings,
    onchange,
    brush = false,
    blocks,
    placeable = null,
    legacy = null,
    frame,
    origin,
    idPrefix = "terrain",
  }: Props = $props();

  /** Whether the noise's own parameters are open. Most terrains need none. */
  let tuning = $state(false);

  const field = $derived(settings.field);
  const specs = $derived(DISTRIBUTION_PARAMS[field.noise.kind]);
  const params = $derived(resolveParams(field.noise));

  function patch(next: Partial<TerrainToolSettings>): void {
    onchange({ ...settings, ...next });
  }

  function patchField(next: Partial<TerrainToolSettings["field"]>): void {
    patch({ field: { ...field, ...next } });
  }

  /** A whole number inside a range, or the value it replaces when it is not one. */
  function bounded(raw: string, range: { readonly min: number; readonly max: number }, fallback: number): number {
    const value = Math.round(Number(raw));
    return Number.isFinite(value) ? Math.min(range.max, Math.max(range.min, value)) : fallback;
  }

  /** Another noise, keeping the seed: its parameters belonged to the old one. */
  function setNoise(kind: TerrainNoise): void {
    patchField({ noise: { kind, seed: field.noise.seed } });
  }

  /** One parameter, read the way the spelling reads it: clamped, or ignored. */
  function setParam(key: string, value: ParamValue): void {
    try {
      patchField({
        noise: normalizeDistribution({ ...field.noise, params: { ...(field.noise.params ?? {}), [key]: value } }),
      });
    } catch {
      // Nothing to write; the field shows the value it had again.
    }
  }
</script>

<div class="terrain-options">
  <div class="row">
    <label for={`${idPrefix}-noise`}>{t("terrain.noise")}</label>
    <select
      id={`${idPrefix}-noise`}
      value={field.noise.kind}
      title={t(`mix.kindHint.${field.noise.kind}`)}
      onchange={(event) => setNoise(event.currentTarget.value as TerrainNoise)}
    >
      {#each TERRAIN_NOISES as kind (kind)}
        <option value={kind}>{t(`mix.kind.${kind}`)}</option>
      {/each}
    </select>
    <button
      type="button"
      class="icon"
      class:open={tuning}
      aria-expanded={tuning}
      title={t("mix.tune")}
      aria-label={t("mix.tune")}
      onclick={() => (tuning = !tuning)}
    >
      <Icon name="gear" size={14} weight={1.8} />
    </button>
  </div>
  <div class="row">
    <label for={`${idPrefix}-seed`}>{t("mix.seed")}</label>
    <input
      id={`${idPrefix}-seed`}
      type="number"
      step="1"
      value={field.noise.seed}
      onchange={(event) =>
        patchField({ noise: { ...field.noise, seed: Math.trunc(Number(event.currentTarget.value)) || 0 } })}
    />
    <button
      type="button"
      class="icon"
      title={t("mix.reroll")}
      aria-label={t("mix.reroll")}
      onclick={() => patchField({ noise: { ...field.noise, seed: freshSeed() } })}
    >
      <Icon name="dice" size={16} weight={1.8} />
    </button>
  </div>
  {#if tuning}
    <div class="params">
      {#each specs as spec (spec.key)}
        <label for={`${idPrefix}-${spec.key}`} title={t(`mix.paramHint.${spec.key}`)}>{t(`mix.param.${spec.key}`)}</label>
        {#if spec.type === "number"}
          <input
            id={`${idPrefix}-${spec.key}`}
            type="number"
            min={spec.min}
            max={spec.max}
            step={spec.step}
            value={params[spec.key]}
            title={t(`mix.paramHint.${spec.key}`)}
            onchange={(event) => setParam(spec.key, Number(event.currentTarget.value))}
          />
        {:else if spec.type === "choice"}
          <select
            id={`${idPrefix}-${spec.key}`}
            value={params[spec.key]}
            title={t(`mix.paramHint.${spec.key}`)}
            onchange={(event) => setParam(spec.key, event.currentTarget.value)}
          >
            {#each spec.options as option (option)}
              <option value={option}>{t(`mix.option.${option}`)}</option>
            {/each}
          </select>
        {:else}
          <input
            id={`${idPrefix}-${spec.key}`}
            type="checkbox"
            checked={params[spec.key] === true}
            title={t(`mix.paramHint.${spec.key}`)}
            onchange={(event) => setParam(spec.key, event.currentTarget.checked)}
          />
        {/if}
      {/each}
    </div>
  {/if}

  <div class="pair">
    <label>
      <span>{t("terrain.base")}</span>
      <input
        type="number"
        min={TERRAIN_BASE.min}
        max={TERRAIN_BASE.max}
        value={field.base}
        title={t("terrain.baseHint")}
        onchange={(event) => patchField({ base: bounded(event.currentTarget.value, TERRAIN_BASE, field.base) })}
      />
    </label>
    <label>
      <span>{t("terrain.amplitude")}</span>
      <input
        type="number"
        min={TERRAIN_AMPLITUDE.min}
        max={TERRAIN_AMPLITUDE.max}
        value={field.amplitude}
        title={t("terrain.amplitudeHint")}
        onchange={(event) =>
          patchField({ amplitude: bounded(event.currentTarget.value, TERRAIN_AMPLITUDE, field.amplitude) })}
      />
    </label>
  </div>
  <p class="note">{t("terrain.rangeHint", { low: field.base, high: field.base + field.amplitude })}</p>
  <TerrainPreview {field} {frame} {origin} />

  <div class="row">
    <label for={`${idPrefix}-mode`}>{t("terrain.mode")}</label>
    <select
      id={`${idPrefix}-mode`}
      value={settings.mode}
      onchange={(event) => patch({ mode: event.currentTarget.value as TerrainMode })}
    >
      {#each TERRAIN_MODES as mode (mode)}
        <option value={mode}>{t(`terrain.mode.${mode}`)}</option>
      {/each}
    </select>
  </div>
  <p class="note">{t(`terrain.modeHint.${settings.mode}`)}</p>

  {#if brush}
    <div class="segmented" role="group" aria-label={t("terrain.footprint")}>
      {#each FOOTPRINTS as footprint (footprint)}
        <button
          type="button"
          class:active={settings.footprint === footprint}
          aria-pressed={settings.footprint === footprint}
          onclick={() => patch({ footprint })}
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
        value={settings.radius}
        oninput={(event) => patch({ radius: bounded(event.currentTarget.value, BRUSH_RADIUS, settings.radius) })}
      />
      <output>{settings.radius}</output>
    </label>
  {/if}

  {#if settings.mode !== "dig"}
    <div class="layer">
      <label for={`${idPrefix}-surface`}>{t("terrain.surface")}</label>
      <BlockMixField
        id={`${idPrefix}-surface`}
        value={settings.surface}
        placeholder="minecraft:grass_block"
        {blocks}
        {placeable}
        {legacy}
        onchange={(surface) => surface.trim() !== "" && patch({ surface })}
      />
    </div>
    <div class="layer">
      <div class="layer-head">
        <label for={`${idPrefix}-subsoil`}>{t("terrain.subsoil")}</label>
        <label class="depth">
          <span>{t("terrain.depth")}</span>
          <input
            type="number"
            min={SUBSOIL_DEPTH.min}
            max={SUBSOIL_DEPTH.max}
            value={settings.subsoilDepth}
            onchange={(event) =>
              patch({ subsoilDepth: bounded(event.currentTarget.value, SUBSOIL_DEPTH, settings.subsoilDepth) })}
          />
        </label>
      </div>
      <BlockMixField
        id={`${idPrefix}-subsoil`}
        value={settings.subsoil}
        placeholder="minecraft:dirt"
        {blocks}
        {placeable}
        {legacy}
        onchange={(subsoil) => subsoil.trim() !== "" && patch({ subsoil })}
      />
    </div>
    <div class="layer">
      <label for={`${idPrefix}-rock`}>{t("terrain.rock")}</label>
      <BlockMixField
        id={`${idPrefix}-rock`}
        value={settings.rock}
        placeholder="minecraft:stone"
        {blocks}
        {placeable}
        {legacy}
        onchange={(rock) => rock.trim() !== "" && patch({ rock })}
      />
    </div>
  {/if}
</div>

<style>
  .terrain-options {
    display: flex;
    flex-direction: column;
    gap: 7px;
    font-size: 12px;
  }

  .row {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .row > label:first-child,
  .row > span:first-child {
    flex: 0 0 72px;
    color: var(--text-dim);
  }

  .row select,
  .row input[type="number"],
  .row input[type="range"] {
    flex: 1;
    min-width: 0;
  }

  .row button.icon {
    flex: 0 0 26px;
    height: 24px;
  }

  button.icon.open {
    border-color: var(--accent);
    color: var(--accent);
  }

  .params {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 8px;
    align-items: center;
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: 6px;
  }

  .params label {
    color: var(--text-dim);
  }

  .params input[type="number"],
  .params select {
    min-width: 0;
  }

  .pair {
    display: flex;
    gap: 8px;
  }

  .pair label {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    color: var(--text-dim);
  }

  .pair input {
    min-width: 0;
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

  .segmented button.active {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--bg-panel);
  }

  output {
    min-width: 2ch;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .layer {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .layer-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 6px;
  }

  .depth {
    display: flex;
    gap: 4px;
    align-items: center;
    color: var(--text-dim);
  }

  .depth input {
    width: 52px;
  }

  .note {
    margin: 0;
    color: var(--text-dim);
    font-size: 11px;
    line-height: 1.35;
  }
</style>
