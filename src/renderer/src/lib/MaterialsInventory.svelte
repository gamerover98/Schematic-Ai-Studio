<script lang="ts">
  /**
   * What the selection is made of, laid out as a Minecraft inventory.
   *
   * It was a column of ids with a number beside each, which answered "what is
   * in here" in a form nobody reads at a glance: a block is recognised by what
   * it looks like, and how much of it there is by the number in the corner of
   * its slot. So each material is a slot with its icon and its count where the
   * game puts a stack's, air last, and the exact count and its share of the
   * selection in the hover.
   *
   * A click on a slot lights its block up in the viewport, through walls, and
   * Ctrl lights several; the slots lit are drawn pressed, and a button under
   * them puts the glow out. What each click means is `materialAction`'s, a
   * plain module, so it can be stated in a check rather than found in a
   * handler.
   *
   * The bar above the slots is for the lists that outgrew a glance: a search,
   * an order, and states merged into one slot per block. What each of those
   * does is `materialRows`, in the same module. The search is the window's
   * and forgotten with it; the order and the merge are settings, because they
   * are how somebody likes to read the list rather than what they are looking
   * for now.
   *
   * A slot is also dragged: onto With or Replace, which it fills (Ctrl adds),
   * or onto a hotbar slot. Air is not dragged, having nowhere it may go but
   * Replace, which a click already does. The right button pins the slot's
   * reading open instead of opening the states, which are the With chip's.
   */
  import type { PaletteCount } from "../../../shared/ipc.js";
  import type { LegacyIndex } from "../../../shared/legacy_ids.js";
  import { MATERIALS_SORTS, type MaterialsSort } from "../../../shared/settings.js";
  import BlockTooltip from "./BlockTooltip.svelte";
  import Icon from "./Icon.svelte";
  import { startBlockDrag } from "./block_drag.js";
  import { blockIcons, iconsReady, requestBlockIcons } from "./block_icons.svelte.js";
  import { shortName } from "./block_spelling.js";
  import type { AnchorRect } from "./floating.js";
  import { formatNumber, t, tn } from "./i18n.svelte.js";
  import { formatCount, materialAction, materialRows, type MaterialAction, type MaterialRow } from "./materials.js";

  interface Props {
    /** The heading the bar sits beside: whose materials these are. */
    title: string;
    /** Most common first, air left out: `DocumentState.palette`'s rule. */
    palette: readonly PaletteCount[];
    air: number;
    /** Cells of the selection that lie outside the document and hold nothing. */
    outside: number;
    /** Every cell counted, outside ones included. */
    cells: number;
    /** Whose materials these are, for what the share in the hover is of. */
    scope: "selection" | "document";
    legacy?: LegacyIndex | null;
    /** One slot per block whatever its states; `UiSettings.materialsUnify`. */
    unify: boolean;
    onunifychange: (unify: boolean) => void;
    sort: MaterialsSort;
    onsortchange: (sort: MaterialsSort) => void;
    /**
     * A slot, clicked. `pair` is the far halves the slot also stands for --
     * a bed's head beside its foot -- which a replace has to name as well.
     */
    onaction: (slot: { block: string; pair: readonly string[] }, action: MaterialAction) => void;
    /** The slots lit in the viewport, by their `block`. */
    glowing?: readonly string[];
    /** How many cells glow, once the viewport's answer is in; `null` before. */
    glowTotal?: number | null;
    /** The viewport draws part of them: there were more faces than it takes. */
    glowCapped?: boolean;
    /** The viewport outlines them in cells of several blocks, there being so many. */
    glowCoarse?: boolean;
    /** Puts the glow out. */
    onglowclear?: () => void;
  }

  const {
    title,
    palette,
    air,
    outside,
    cells,
    scope,
    legacy = null,
    unify,
    onunifychange,
    sort,
    onsortchange,
    onaction,
    glowing = [],
    glowTotal = null,
    glowCapped = false,
    glowCoarse = false,
    onglowclear = () => {},
  }: Props = $props();

  const lit = $derived(new Set(glowing));

  let query = $state("");

  const slots = $derived<MaterialRow[]>(materialRows(palette, air, { unify, sort, query }));

  /*
   * Written out once per order rather than built from the value, because the
   * catalogue is checked against the keys the source asks for by name.
   */
  const sortLabels = $derived<Record<MaterialsSort, string>>({
    countDesc: t("materials.sort.countDesc"),
    countAsc: t("materials.sort.countAsc"),
    nameAsc: t("materials.sort.nameAsc"),
    nameDesc: t("materials.sort.nameDesc"),
  });

  /** What the shares are of: the cells that hold something, air included. */
  const inside = $derived(Math.max(1, cells - outside));

  const icons = $derived(blockIcons());
  $effect(() => {
    void iconsReady();
    requestBlockIcons(slots.filter((slot) => !slot.air).map((slot) => slot.block));
  });

  let elements = $state<(HTMLButtonElement | null)[]>([]);
  let hovered = $state<{ index: number; anchor: AnchorRect } | null>(null);
  /** The slot whose reading the right button pinned open, by its block. */
  let pinned = $state<{ block: string; anchor: AnchorRect } | null>(null);
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;

  function hoverStart(index: number): void {
    if (hoverTimer !== null) clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      const element = elements[index];
      if (!element) return;
      const box = element.getBoundingClientRect();
      hovered = { index, anchor: { left: box.left, top: box.top, width: box.width, height: box.height } };
    }, 350);
  }

  function hoverEnd(): void {
    if (hoverTimer !== null) clearTimeout(hoverTimer);
    hoverTimer = null;
    hovered = null;
  }

  /** Replace and With are beside the list only with a selection: see `materialAction`. */
  const fields = $derived(scope === "selection");

  function act(slot: MaterialRow, event: MouseEvent, button: number): void {
    const action = materialAction(
      { button, ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey },
      slot.air,
      fields,
    );
    if (action === "none") return;
    hoverEnd();
    if (action === "info") {
      const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
      pinned = { block: slot.block, anchor: { left: box.left, top: box.top, width: box.width, height: box.height } };
      return;
    }
    onaction({ block: slot.block, pair: slot.pair }, action);
  }

  function dragStart(slot: MaterialRow, event: DragEvent): void {
    hoverEnd();
    pinned = null;
    if (event.dataTransfer) startBlockDrag(event.dataTransfer, { block: slot.block, pair: slot.pair });
  }

  const hoveredSlot = $derived(hovered === null || pinned !== null ? null : (slots[hovered.index] ?? null));
  /** Gone with its slot, when a count or a search takes the slot away. */
  const pinnedSlot = $derived(pinned === null ? null : (slots.find((slot) => slot.block === pinned?.block) ?? null));
</script>

<div class="head">
  <span class="heading">{title}</span>
  <label class="unify" title={t("materials.unifyHint")}>
    <input
      type="checkbox"
      checked={unify}
      onchange={(event) => onunifychange((event.currentTarget as HTMLInputElement).checked)}
    />
    {t("materials.unify")}
  </label>
</div>

<div class="bar">
  <input
    class="search"
    type="search"
    placeholder={t("materials.search")}
    aria-label={t("materials.search")}
    bind:value={query}
  />
  <select
    class="order"
    aria-label={t("materials.sort")}
    title={t("materials.sort")}
    value={sort}
    onchange={(event) => onsortchange((event.currentTarget as HTMLSelectElement).value as MaterialsSort)}
  >
    {#each MATERIALS_SORTS as option (option)}
      <option value={option}>{sortLabels[option]}</option>
    {/each}
  </select>
</div>

{#if slots.length === 0}
  <p class="note">{t("materials.noMatch", { query: query.trim() })}</p>
{:else}
  <div class="inventory">
    <!-- Keyed on the block: a palette names each state once, and air is not in it. -->
    {#each slots as slot, index (slot.block)}
      <button
        type="button"
        class="slot"
        class:air={slot.air}
        class:lit={lit.has(slot.block)}
        aria-pressed={slot.air ? undefined : lit.has(slot.block)}
        bind:this={elements[index]}
        draggable={!slot.air}
        ondragstart={(event) => dragStart(slot, event)}
        aria-label={t("materials.slot", { block: slot.block, count: formatNumber(slot.count) })}
        onclick={(event) => act(slot, event, 0)}
        oncontextmenu={(event) => {
          event.preventDefault();
          act(slot, event, 2);
        }}
        onpointerenter={() => hoverStart(index)}
        onpointerleave={hoverEnd}
        onfocus={() => hoverStart(index)}
        onblur={hoverEnd}
      >
        {#if slot.air}
          <span class="glyph"><Icon name="air" size={22} weight={1.6} /></span>
        {:else if icons.get(slot.block)}
          <img src={icons.get(slot.block)} alt="" width="32" height="32" />
        {:else}
          <span class="pending" aria-hidden="true">{shortName(slot.block).slice(0, 2)}</span>
        {/if}
        <span class="count pixel" aria-hidden="true">{formatCount(slot.count)}</span>
      </button>
    {/each}
  </div>
{/if}

{#if glowing.length > 0}
  <div class="glow">
    <span class="note">
      {glowTotal === null
        ? t("materials.glowFinding")
        : glowCapped
          ? tn("materials.glowCapped", glowTotal)
          : glowCoarse
            ? tn("materials.glowCoarse", glowTotal)
            : tn("materials.glowLit", glowTotal)}
    </span>
    <button type="button" class="off" onclick={onglowclear} title={t("materials.glowOffHint")}>
      {t("materials.glowOff")}
    </button>
  </div>
{/if}

{#if outside > 0}
  <p class="note">{t("materials.outside", { count: formatNumber(outside) })}</p>
{/if}
<p class="note">{fields ? t("materials.hint") : t("materials.hintDocument")}</p>

<BlockTooltip
  block={hoveredSlot?.block ?? null}
  anchor={hovered?.anchor ?? null}
  {legacy}
  count={hoveredSlot?.count ?? null}
  share={hoveredSlot === null ? null : hoveredSlot.count / inside}
  shareOf={scope}
/>

{#if pinned !== null && pinnedSlot !== null}
  <BlockTooltip
    block={pinnedSlot.block}
    anchor={pinned.anchor}
    {legacy}
    count={pinnedSlot.count}
    share={pinnedSlot.count / inside}
    shareOf={scope}
    pair={pinnedSlot.pair}
    pinned
    onclose={() => (pinned = null)}
  />
{/if}

<style>
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .heading {
    font-weight: 700;
  }

  .unify {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-dim);
    cursor: pointer;
    white-space: nowrap;
  }

  .bar {
    display: flex;
    gap: var(--space-2);
  }

  .search {
    flex: 1;
    min-width: 0;
    font-size: var(--text-sm);
  }

  .order {
    flex: 0 0 auto;
    width: auto;
    max-width: 45%;
    font-size: var(--text-sm);
  }

  /*
   * Scrolls inside itself rather than growing the panel, at a share of the
   * window's height -- the list's old rule, kept: a taller window gives the
   * inventory more rows.
   */
  .inventory {
    display: grid;
    grid-template-columns: repeat(auto-fill, 36px);
    gap: var(--space-1);
    max-height: max(152px, 24vh);
    overflow-y: auto;
  }

  /*
   * The game's slot: a square sunk into the slab, dark in every theme, with
   * the bevel every well here has -- `.inset`'s, so a slot and a field read
   * as the same material.
   */
  .slot {
    position: relative;
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    min-height: 0;
    padding: 0;
    border: var(--bevel) solid;
    border-color: var(--bevel-lo) var(--bevel-hi) var(--bevel-hi) var(--bevel-lo);
    background: var(--slot);
  }

  .slot:hover {
    background: var(--slot);
  }

  /*
   * Lit: the glow's own colour round the slot and the slot raised rather than
   * sunk, which is the pressed state of a toggle read the other way up -- a
   * slot is already a hollow, so "pressed in" would look like every other.
   */
  .slot.lit {
    border-color: var(--bevel-hi) var(--bevel-lo) var(--bevel-lo) var(--bevel-hi);
    box-shadow: inset 0 0 0 2px var(--glow);
  }

  .slot:hover::after,
  .slot:focus-visible::after {
    content: "";
    position: absolute;
    inset: 0;
    background: color-mix(in srgb, var(--slot-text) 18%, transparent);
    pointer-events: none;
  }

  .slot img {
    width: 32px;
    height: 32px;
    image-rendering: pixelated;
  }

  .pending,
  .glyph {
    display: grid;
    place-items: center;
    color: color-mix(in srgb, var(--slot-text) 70%, transparent);
  }

  .pending {
    font-size: var(--text-xs);
    text-transform: uppercase;
  }

  /*
   * The game's stack count: in the corner, over the icon, in the pixel face,
   * white with a hard shadow -- which is what reads over any picture, and the
   * slot under it is dark in every theme.
   */
  .count {
    position: absolute;
    right: 1px;
    bottom: 0;
    color: var(--slot-text);
    font-size: var(--text-sm);
    line-height: 1;
    text-shadow: 1px 1px 0 var(--slot-text-shadow);
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }

  .glow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .glow .off {
    flex: 0 0 auto;
    padding: 0 var(--space-3);
    font-size: var(--text-sm);
  }

  .note {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-dim);
  }
</style>
