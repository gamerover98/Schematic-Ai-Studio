<script lang="ts">
  /**
   * Lay a landscape over the selection, or smooth and erode what is there.
   *
   * It was a closed disclosure at the foot of the selection tools, under the
   * fill buttons and the materials, where a panel a few hundred pixels tall
   * put it below the fold: the one section of that window with a picture in
   * it was the one nobody scrolled to. It is a tab of the docked panel now,
   * beside Selection and Inspector, because it is a tool of its own that
   * happens to act on the same areas.
   *
   * The settings are `CreativeSettings.terrain`, `smooth` and `erode`: one
   * landscape, painted in by the brush in flight or laid over a box here.
   */
  import type { LegacyIndex } from "../../../shared/legacy_ids.js";
  import type { Box } from "../../../shared/regions.js";
  import type { ErodeToolSettings, SmoothToolSettings, TerrainToolSettings } from "../../../shared/creative.js";
  import { EROSION_PRESET_NAMES, SMOOTH_ITERATIONS, type ErosionPreset } from "../../../shared/terrain.js";
  import TerrainOptions from "./TerrainOptions.svelte";
  import { t } from "./i18n.svelte.js";

  interface Props {
    terrain: TerrainToolSettings;
    onterrainchange: (next: TerrainToolSettings) => void;
    onlayterrain: () => void;
    onfitterrain: () => void;
    smooth: SmoothToolSettings;
    onsmoothchange: (next: SmoothToolSettings) => void;
    onsmooth: () => void;
    erode: ErodeToolSettings;
    onerodechange: (next: ErodeToolSettings) => void;
    onerode: () => void;
    /** Nothing is selected, so nothing here has anything to act on. */
    none: boolean;
    busy: boolean;
    blocks: readonly string[];
    placeable?: ReadonlySet<string> | null;
    legacy?: LegacyIndex | null;
    /** What the picture is drawn over: `mapFrameOf`. */
    frame: Box | null;
    /** `DocumentState.frame`, where the terrain's noise is read. */
    origin: readonly [number, number, number];
  }

  const {
    terrain,
    onterrainchange,
    onlayterrain,
    onfitterrain,
    smooth,
    onsmoothchange,
    onsmooth,
    erode,
    onerodechange,
    onerode,
    none,
    busy,
    blocks,
    placeable = null,
    legacy = null,
    frame,
    origin,
  }: Props = $props();
</script>

<div class="terrain">
  <p class="hint">{none ? t("terrain.selectFirst") : t("selection.terrainHint")}</p>

  <TerrainOptions
    settings={terrain}
    onchange={onterrainchange}
    {blocks}
    {placeable}
    {legacy}
    frame={frame ?? { minX: 0, minY: 0, minZ: 0, maxX: 63, maxY: 63, maxZ: 63 }}
    {origin}
    idPrefix="selection-terrain"
  />
  <div class="row">
    <button onclick={onfitterrain} disabled={busy || none} title={t("selection.fitTerrainHint")}>
      {t("selection.fitTerrain")}
    </button>
    <button
      class="primary"
      onclick={onlayterrain}
      disabled={busy || none}
      title={none ? t("selection.selectFirst") : t("selection.layTerrainHint")}
    >
      {t("selection.layTerrain")}
    </button>
  </div>

  <div class="subtool">
    <label for="selection-smooth-passes">{t("selection.smoothPasses")}</label>
    <input
      id="selection-smooth-passes"
      type="number"
      min={SMOOTH_ITERATIONS.min}
      max={SMOOTH_ITERATIONS.max}
      value={smooth.iterations}
      onchange={(event) => {
        const value = Math.round(Number(event.currentTarget.value));
        if (Number.isFinite(value)) {
          onsmoothchange({
            ...smooth,
            iterations: Math.min(SMOOTH_ITERATIONS.max, Math.max(SMOOTH_ITERATIONS.min, value)),
          });
        }
      }}
    />
    <button onclick={onsmooth} disabled={busy || none} title={t("selection.smoothHint")}>
      {t("selection.smooth")}
    </button>
  </div>

  <div class="subtool">
    <label for="selection-erode-preset">{t("selection.erodePreset")}</label>
    <select
      id="selection-erode-preset"
      value={erode.preset}
      onchange={(event) => onerodechange({ ...erode, preset: event.currentTarget.value as ErosionPreset })}
    >
      {#each EROSION_PRESET_NAMES as preset (preset)}
        <option value={preset}>{t(`erode.preset.${preset}`)}</option>
      {/each}
    </select>
    <button onclick={onerode} disabled={busy || none} title={t("selection.erodeHint")}>
      {t("selection.erode")}
    </button>
  </div>
  <p class="hint">{t(`erode.presetHint.${erode.preset}`)}</p>
</div>

<style>
  .terrain {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    font-size: var(--text-sm);
  }

  .terrain :global(.hint) {
    margin: 0;
  }

  .row {
    display: flex;
    gap: var(--space-2);
  }

  .row button {
    flex: 1;
    min-width: 0;
  }

  .subtool {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }

  .subtool label {
    flex: 0 0 72px;
    margin: 0;
    color: var(--text-dim);
  }

  .subtool input,
  .subtool select {
    flex: 1;
    min-width: 0;
  }

  .subtool button {
    flex: 0 0 auto;
  }
</style>
