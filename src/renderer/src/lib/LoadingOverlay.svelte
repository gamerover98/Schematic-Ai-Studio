<script lang="ts">
  /**
   * The loading bar over the viewport, while main reads or meshes a large
   * schematic.
   *
   * The startup screen's bar, in the same material: an emerald fill in a
   * sunken well, on a slab. It takes no pointer -- it says how long, and the
   * window is busy anyway -- and it is on the start screen's tier, after it in
   * the document, because a file opened from that screen is read while the
   * screen is still up.
   *
   * What is spoken is the start, once: the bar's value is on the progress bar
   * for anyone who asks, and announcing every step would be a stream of
   * numbers. The end needs no sentence, because the build appears.
   */
  import { formatNumber, t } from "./i18n.svelte.js";
  import type { LoadState } from "./load_progress.js";

  interface Props {
    load: LoadState;
  }

  const { load }: Props = $props();

  const percent = $derived(Math.floor(load.fraction * 100));
</script>

<div class="loading">
  <div class="card slab">
    <span class="sr-only" role="status">{t("loading.announce")}</span>
    <div class="head" aria-hidden="true">
      <strong class="pixel">{t(`loading.${load.phase}`)}</strong>
      <span class="figures">{formatNumber(percent)}%</span>
    </div>
    <div
      class="bar"
      role="progressbar"
      aria-label={t("loading.announce")}
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={percent}
      aria-valuetext={`${t(`loading.${load.phase}`)}, ${formatNumber(percent)}%`}
    >
      <div class="fill" style={`width: ${percent}%`}></div>
    </div>
  </div>
</div>

<style>
  .loading {
    position: absolute;
    inset: 0;
    z-index: var(--z-screen);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-6);
    pointer-events: none;
  }

  .card {
    width: min(360px, 100%);
    padding: var(--space-4) var(--space-5);
    box-shadow: var(--shadow-modal);
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }

  strong {
    font-weight: 500;
  }

  .figures {
    color: var(--text-dim);
    font-size: var(--text-sm);
  }

  .bar {
    width: 100%;
    height: 12px;
    border: var(--bevel) solid;
    border-color: var(--bevel-lo) var(--bevel-hi) var(--bevel-hi) var(--bevel-lo);
    background: var(--well);
    overflow: hidden;
  }

  .fill {
    height: 100%;
    background: var(--accent);
    transition: width 120ms linear;
  }
</style>
