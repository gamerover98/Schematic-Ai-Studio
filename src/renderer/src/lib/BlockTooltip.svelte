<script lang="ts">
  /**
   * What a block icon stands for, shown while the pointer rests on it.
   *
   * An icon says what a block looks like and nothing about which state it is
   * in, so a field of icons needs somewhere to read the rest: the full id, its
   * states with the ones left at their defaults dimmed, what a legacy file
   * will store it as, which releases have it, and -- from the caller -- how
   * many there are or what share of a mix it takes.
   *
   * `position: fixed` and placed by `placePopover`, `BlockPicker`'s dropdown
   * arrangement for its reason: the icons live inside a `ToolWindow`, which
   * clips. `pointer-events: none`, so it can never be the thing under the
   * pointer that keeps it open.
   */
  import { defaultStateFor } from "../../../shared/block_states.js";
  import { versionRangeOf } from "../../../shared/block_versions.js";
  import { mcVersion, versionNameOf } from "../../../shared/mc_versions.js";
  import { legacyIdForState, type LegacyIndex } from "../../../shared/legacy_ids.js";
  import { blockIcons, requestBlockIcons } from "./block_icons.svelte.js";
  import { readSpelling } from "./block_spelling.js";
  import { placePopover, type AnchorRect } from "./floating.js";
  import { propertyRows } from "./inspector_rows.js";
  import { t } from "./i18n.svelte.js";

  interface Props {
    /** The spelling to describe, or `null` for nothing to show. */
    block: string | null;
    anchor: AnchorRect | null;
    legacy?: LegacyIndex | null;
    /** How many there are, for an inventory slot. */
    count?: number | null;
    /** Its share of the whole, 0..1: of the selection, or of the mix. */
    share?: number | null;
    /** Its weight in a mix, beside the share it comes to. */
    weight?: number | null;
  }

  const { block, anchor, legacy = null, count = null, share = null, weight = null }: Props = $props();

  let popover = $state<HTMLDivElement | null>(null);
  let placement = $state<{ x: number; y: number } | null>(null);
  let innerWidth = $state(0);
  let innerHeight = $state(0);

  const icons = $derived(blockIcons());
  const spelling = $derived(block === null ? null : readSpelling(block));

  $effect(() => {
    if (block !== null) requestBlockIcons([block]);
  });

  const rows = $derived.by(() => {
    if (spelling === null) return [];
    const defaults = legacy === null ? defaultStateFor(spelling.name) : {};
    return propertyRows(spelling.name, spelling.properties, legacy).map((row) => ({
      name: row.name,
      value: row.value ?? defaults[row.name] ?? null,
      set: row.value !== null,
    }));
  });

  const legacyId = $derived(block === null ? null : legacyIdForState(legacy, block));

  /*
   * Only on a flat document. `block_versions.json` dates the *flattened name*,
   * so on a 1.12 schematic it would say red wool arrived in 1.13 beside the
   * line saying which `ID:DATA` 1.12 stores it as -- true, and the wrong
   * answer for the version open.
   */
  const versions = $derived.by(() => {
    if (spelling === null || legacy !== null) return null;
    const range = versionRangeOf(spelling.name);
    if (range === null) return null;
    const label = (dataVersion: number) => {
      const name = versionNameOf(dataVersion);
      return name === null ? String(dataVersion) : (mcVersion(name)?.label ?? name);
    };
    return range.until === null
      ? t("blockInfo.since", { version: label(range.since) })
      : t("blockInfo.between", { from: label(range.since), to: label(range.until) });
  });

  const percent = (value: number) =>
    value >= 0.995 || value === 0 ? `${Math.round(value * 100)}%` : `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`;

  $effect(() => {
    if (block === null || anchor === null || popover === null) {
      placement = null;
      return;
    }
    void rows.length;
    const box = popover.getBoundingClientRect();
    placement = placePopover(
      anchor,
      {
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        popoverWidth: box.width,
        popoverHeight: box.height,
        margin: 8,
        gap: 6,
      },
      "above",
    );
  });
</script>

<svelte:window bind:innerWidth bind:innerHeight />

{#if block !== null && anchor !== null}
  <div
    class="tooltip"
    role="tooltip"
    bind:this={popover}
    style={placement === null ? "visibility: hidden" : `left: ${placement.x}px; top: ${placement.y}px`}
  >
    <div class="head">
      {#if icons.get(block)}
        <img src={icons.get(block)} alt="" width="48" height="48" />
      {:else}
        <span class="pending" aria-hidden="true"></span>
      {/if}
      <code class="id">{block}</code>
    </div>
    {#if rows.length > 0}
      <dl class="props">
        {#each rows as row (row.name)}
          <dt class:unset={!row.set}>{row.name}</dt>
          <dd class:unset={!row.set}>{row.value ?? "—"}</dd>
        {/each}
      </dl>
    {/if}
    {#if legacyId}
      <p class="line">
        {legacyId.exact
          ? t("blockInfo.legacyId", { id: legacyId.label })
          : t("blockInfo.legacyApprox", { id: legacyId.label })}
      </p>
    {/if}
    {#if versions}
      <p class="line">{versions}</p>
    {/if}
    {#if count !== null}
      <p class="line strong">
        {share === null
          ? t("blockInfo.count", { count: count.toLocaleString() })
          : t("blockInfo.countShare", { count: count.toLocaleString(), share: percent(share) })}
      </p>
    {:else if weight !== null && share !== null}
      <p class="line strong">{t("blockInfo.weight", { weight: String(weight), share: percent(share) })}</p>
    {/if}
  </div>
{/if}

<style>
  .tooltip {
    position: fixed;
    z-index: 40;
    max-width: min(300px, calc(100vw - 16px));
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-panel);
    box-shadow: 0 6px 18px var(--shadow);
    font-size: 11px;
    pointer-events: none;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  img,
  .pending {
    flex: none;
    width: 48px;
    height: 48px;
    image-rendering: pixelated;
  }

  .pending {
    border-radius: 4px;
    background: var(--bg-input);
  }

  .id {
    min-width: 0;
    font-size: 11px;
    overflow-wrap: anywhere;
  }

  .props {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 1px 10px;
    margin: 6px 0 0;
  }

  .props dt,
  .props dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }

  .props dd {
    font-weight: 600;
  }

  .props .unset {
    color: var(--text-dim);
    font-weight: normal;
  }

  .line {
    margin: 5px 0 0;
    color: var(--text-dim);
  }

  .line.strong {
    color: var(--text);
    font-weight: 600;
  }
</style>
