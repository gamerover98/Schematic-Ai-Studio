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
   * A slot is also the quickest way to say "this one" to the tools above it.
   * What each click means is `materialAction`'s, a plain module, so it can be
   * stated in a check rather than found in a handler.
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
  import { t } from "./i18n.svelte.js";
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
  }: Props = $props();

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

  function act(slot: MaterialRow, event: MouseEvent, button: number): void {
    const action = materialAction(
      { button, ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey },
      slot.air,
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
        bind:this={elements[index]}
        draggable={!slot.air}
        ondragstart={(event) => dragStart(slot, event)}
        aria-label={t("materials.slot", { block: slot.block, count: slot.count.toLocaleString() })}
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
        <span class="count" aria-hidden="true">{formatCount(slot.count)}</span>
      </button>
    {/each}
  </div>
{/if}

{#if outside > 0}
  <p class="note">{t("materials.outside", { count: outside.toLocaleString() })}</p>
{/if}
<p class="note">{t("materials.hint")}</p>

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
    gap: 6px;
  }

  .heading {
    font-weight: 600;
  }

  .unify {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin: 0;
    font-size: 11px;
    color: var(--text-dim);
    cursor: pointer;
    white-space: nowrap;
  }

  .unify input {
    margin: 0;
  }

  .bar {
    display: flex;
    gap: 4px;
  }

  .search {
    flex: 1;
    min-width: 0;
    padding: 3px 6px;
    font-size: 11px;
  }

  .order {
    flex: 0 0 auto;
    max-width: 45%;
    padding: 3px 4px;
    font-size: 11px;
  }

  /*
   * Scrolls inside itself rather than growing the window, at a share of the
   * window's height -- the list's old rule, kept: drag the panel taller and the
   * inventory gets taller with it.
   */
  .inventory {
    display: grid;
    grid-template-columns: repeat(auto-fill, 36px);
    gap: 2px;
    max-height: max(152px, 24vh);
    overflow-y: auto;
    padding: 3px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-panel);
  }

  /* The game's slot: a square sunk into the panel, lit from the bottom right. */
  .slot {
    position: relative;
    width: 36px;
    height: 36px;
    padding: 0;
    border: none;
    border-radius: 0;
    background: var(--bg-input);
    box-shadow:
      inset 2px 2px 0 rgba(0, 0, 0, 0.35),
      inset -2px -2px 0 rgba(255, 255, 255, 0.1);
    cursor: pointer;
  }

  .slot:hover::after,
  .slot:focus-visible::after {
    content: "";
    position: absolute;
    inset: 0;
    background: rgba(255, 255, 255, 0.18);
    pointer-events: none;
  }

  .slot img {
    position: absolute;
    left: 2px;
    top: 2px;
    width: 32px;
    height: 32px;
    image-rendering: pixelated;
  }

  .pending,
  .glyph {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: var(--text-dim);
  }

  .pending {
    font-size: 10px;
    text-transform: uppercase;
  }


  /*
   * The game's stack count: white with a hard shadow, in the corner, over the
   * icon. Literal colours rather than tokens, because it is drawn on the
   * block's own picture rather than on the panel, and that is what reads over
   * any picture in either theme.
   */
  .count {
    position: absolute;
    right: 1px;
    bottom: 1px;
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
    text-shadow: 1px 1px 0 #3f3f3f;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }

  .note {
    margin: 0;
    font-size: 10px;
    color: var(--text-dim);
  }
</style>
