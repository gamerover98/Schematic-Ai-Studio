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
   *
   * **Pinned**, it is the materials list's right-click: the same reading,
   * held still so it can be read and its id copied, until Escape or a press
   * anywhere else. It takes the pointer then, and the Escape: the window's
   * own Escape drops the selection, which would take the list away with it.
   */
  import { defaultStateFor } from "../../../shared/block_states.js";
  import { versionRangeOf, versionTableFloor } from "../../../shared/block_versions.js";
  import { mcVersion, versionNameOf } from "../../../shared/mc_versions.js";
  import { legacyIdForState, type LegacyIndex } from "../../../shared/legacy_ids.js";
  import { api, bridgeAvailable } from "./bridge.svelte.js";
  import { blockIcons, requestBlockIcons } from "./block_icons.svelte.js";
  import { readSpelling, shortName } from "./block_spelling.js";
  import { placePopover, type AnchorRect } from "./floating.js";
  import { propertyRows } from "./inspector_rows.js";
  import { t, tn } from "./i18n.svelte.js";
  import { blockLabel } from "./inventory.js";

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
    /** What a count's share is of: the selection, or the whole schematic. */
    shareOf?: "selection" | "document";
    /** The far halves counted with this one: a bed's head beside its foot. */
    pair?: readonly string[];
    /** Held still, with a way to copy the id; see the header. */
    pinned?: boolean;
    /** Escape, or a press outside, while pinned. */
    onclose?: () => void;
  }

  const {
    block,
    anchor,
    legacy = null,
    count = null,
    share = null,
    weight = null,
    shareOf = "selection",
    pair = [],
    pinned = false,
    onclose,
  }: Props = $props();

  let copied = $state(false);

  async function copyId(): Promise<void> {
    if (block === null || !bridgeAvailable) return;
    await api().copyToClipboard(block);
    copied = true;
    setTimeout(() => (copied = false), 1200);
  }

  $effect(() => {
    if (!pinned || block === null) return;
    /*
     * On the way down, so this Escape is the popover's and goes no further:
     * the window's own would drop the selection, and the list with it.
     */
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onclose?.();
    };
    const onPress = (event: PointerEvent) => {
      if (popover !== null && event.target instanceof Node && popover.contains(event.target)) return;
      onclose?.();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPress, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPress, true);
    };
  });

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
   *
   * And a block the table dates to its own first release is "since 1.13 or
   * earlier", not "since 1.13": the table starts there and oak stairs did not.
   */
  const versions = $derived.by(() => {
    if (spelling === null || legacy !== null) return null;
    const range = versionRangeOf(spelling.name);
    if (range === null) return null;
    const label = (dataVersion: number) => {
      const name = versionNameOf(dataVersion);
      return name === null ? String(dataVersion) : (mcVersion(name)?.label ?? name);
    };
    const atFloor = range.since <= versionTableFloor();
    if (range.until === null) {
      return atFloor
        ? t("blockInfo.sinceOrEarlier", { version: label(range.since) })
        : t("blockInfo.since", { version: label(range.since) });
    }
    return atFloor
      ? t("blockInfo.until", { to: label(range.until) })
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
    class:pinned
    role={pinned ? "dialog" : "tooltip"}
    aria-label={pinned ? block : undefined}
    bind:this={popover}
    style={placement === null ? "visibility: hidden" : `left: ${placement.x}px; top: ${placement.y}px`}
  >
    <div class="head">
      <span class="slot">
        {#if icons.get(block)}
          <img src={icons.get(block)} alt="" width="40" height="40" />
        {/if}
      </span>
      <div class="names">
        <span class="name">{blockLabel(block)}</span>
        <code class="id">{block}</code>
      </div>
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
        <!-- The separator is a string: Svelte trims the space a block opens with. -->
        {tn("count.blocks", count)}{#if share !== null}{" · "}{t(shareOf === "document" ? "blockInfo.shareDocument" : "blockInfo.share", {
            share: percent(share),
          })}{/if}
      </p>
    {:else if weight !== null && share !== null}
      <p class="line strong">{t("blockInfo.weight", { weight: String(weight), share: percent(share) })}</p>
    {/if}
    {#if pair.length > 0}
      <p class="line">{t("blockInfo.pair", { other: pair.map(shortName).join(", ") })}</p>
    {/if}
    {#if pinned}
      <div class="actions">
        <button type="button" onclick={() => void copyId()}>
          {copied ? t("blockInfo.copied") : t("blockInfo.copyId")}
        </button>
        <button type="button" onclick={() => onclose?.()}>{t("common.close")}</button>
      </div>
    {/if}
  </div>
{/if}

<style>
  /* A slab on the popover tier: the chat's popovers and the block list's. */
  .tooltip {
    position: fixed;
    z-index: var(--z-popover);
    max-width: min(300px, calc(100vw - 16px));
    padding: var(--space-3) var(--space-4);
    border: var(--bevel) solid;
    border-color: var(--bevel-hi) var(--bevel-lo) var(--bevel-lo) var(--bevel-hi);
    background: var(--bg-panel);
    box-shadow: var(--shadow-float);
    font-size: var(--text-sm);
    pointer-events: none;
  }

  .tooltip.pinned {
    pointer-events: auto;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  .actions button {
    padding: 0 var(--space-3);
    font-size: var(--text-sm);
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  /* The block in a slot, as the list it was read from holds it. */
  .slot {
    flex: none;
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    border: var(--bevel) solid;
    border-color: var(--bevel-lo) var(--bevel-hi) var(--bevel-hi) var(--bevel-lo);
    background: var(--slot);
  }

  img {
    width: 40px;
    height: 40px;
    image-rendering: pixelated;
  }

  .names {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .name {
    font-size: var(--text-md);
    font-weight: 700;
  }

  .id {
    min-width: 0;
    font-family: var(--mono);
    font-size: var(--text-xs);
    color: var(--text-dim);
    overflow-wrap: anywhere;
  }

  .props {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-1) var(--space-4);
    margin: var(--space-3) 0 0;
  }

  .props dt,
  .props dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }

  .props dd {
    font-weight: 700;
  }

  .props .unset {
    color: var(--text-dim);
    font-weight: normal;
  }

  .line {
    margin: var(--space-2) 0 0;
    color: var(--text-dim);
  }

  .line.strong {
    color: var(--text);
    font-weight: 700;
  }
</style>
