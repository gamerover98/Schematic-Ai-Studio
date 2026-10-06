<script lang="ts">
  /**
   * Every block the app can place, as they look, on `E`.
   *
   * ## The drawing is not here
   *
   * `block_icons.svelte.ts` owns the one renderer the window is allowed, and
   * the hotbar draws from the same cache — two components showing the same
   * blocks two different ways was how the hotbar came to be a row of hashed
   * colours next to a grid of actual blocks.
   *
   * ## Virtualised, and the arithmetic is not here
   *
   * `inventory.ts` decides which slice needs drawing, because a scroll offset is
   * not something this project's test harness can produce — the same split
   * `build_grid.ts` and `selection_drag.ts` use.
   *
   * ## A dialog, and every block in a slot
   *
   * It is a `Modal`, so the scrim, the pointer lock, the keyboard and the way
   * out are every other dialog's: it had a scrim and an Escape of its own. The
   * hotbar rises over it (`--z-beside-modal`), as the game draws its hotbar
   * inside the inventory, so a tile can be dragged down onto a slot.
   *
   * A tile is the block in a slot with its name under it, and on a legacy
   * schematic the `ID:DATA` the file will store written on the slot where the
   * game writes a stack's count.
   */
  import { blockIcons, iconsReady, requestBlockIcons } from "./block_icons.svelte.js";
  import { startBlockDrag } from "./block_drag.js";
  import { mcVersion } from "../../../shared/mc_versions.js";
  import { blockLabel, gridWindow, inventoryBlocks } from "./inventory.js";
import { legacyIdFor, type LegacyIndex } from "../../../shared/legacy_ids.js";
  import { tick } from "svelte";
  import { t, tn } from "./i18n.svelte.js";
  import Modal from "./Modal.svelte";
  import BannerPatternHint from "./BannerPatternHint.svelte";

  interface Props {
    open: boolean;
    /** Every placeable block id, as main lists them. */
    blocks: readonly string[];
    /** Shown beside the search, so the target is never a mystery. */
    version: string;
    /**
     * The names this schematic can hold, or `null` for no restriction.
     *
     * Only a legacy document supplies one: `legacy_blocks.json` says exactly
     * which blocks a pre-Flattening file can name, and it is the same table
     * the writer refuses a save on. Above 1.13 there is no such data and
     * nothing is cut -- see `inventoryBlocks`.
     */
    placeable?: ReadonlySet<string> | null;
    /**
     * The pre-Flattening table, when this schematic is one.
     *
     * A legacy file stores `35:14`, not `minecraft:red_wool` -- so on a legacy
     * document the grid says both. Naming only the modern spelling would be
     * telling somebody the app's word for a block instead of the file's.
     */
    legacy?: LegacyIndex | null;
    /** What the chosen block is for — named so the title can say it. */
    purpose: "hand" | "fill" | "replace";
    onclose: () => void;
    onpick: (block: string) => void;
  }

  const {
    open,
    blocks,
    version,
    placeable = null,
    legacy = null,
    purpose,
    onclose,
    onpick,
  }: Props = $props();

  /** A tile's side: a 44px slot, two lines of name under it, and room. */
  const TILE = 76;
  const COLUMNS = 8;

  let query = $state("");
  let scrollTop = $state(0);
  let viewportHeight = $state(420);
  let scroller = $state<HTMLDivElement | null>(null);
  let search = $state<HTMLInputElement | null>(null);

  const filtered = $derived(inventoryBlocks(blocks, query, placeable));
  const view = $derived(
    gridWindow({
      count: filtered.length,
      columns: COLUMNS,
      rowHeight: TILE,
      viewportHeight,
      scrollTop,
    }),
  );
  const visible = $derived(filtered.slice(view.firstIndex, view.lastIndex));

  /** The rendered icons. Read through the getter so this depends on the map. */
  const icons = $derived(blockIcons());

  $effect(() => {
    if (!open) return;
    // Read, so the warm-up landing re-runs this rather than waiting for a scroll.
    void iconsReady();
    requestBlockIcons(visible);
  });

  /*
   * The search takes the keys, so typing finds a block straight away. After a
   * `tick`: the dialog puts the focus on itself as it opens, in the same
   * flush, and would otherwise have the last word.
   */
  $effect(() => {
    if (!open || search === null) return;
    void tick().then(() => search?.focus());
  });
</script>

<Modal {open} title={t(`inventory.for.${purpose}`)} {onclose} width={660} height={600} flush>
  {#snippet head()}
    <input
      class="search"
      bind:this={search}
      bind:value={query}
      type="search"
      placeholder={t("inventory.search")}
      aria-label={t("inventory.search")}
    />
    <span class="count">
      {tn("count.blocks", filtered.length)}
      · {mcVersion(version)?.label ?? version}
    </span>
  {/snippet}

  <!--
    Searching for banners is the moment to say where a *patterned* one comes
    from: the grid holds sixteen plain colours and nothing else, and the
    design is pasted into a field this window does not have.
  -->
  {#if /banner/i.test(query)}
    <div class="banner">
      <BannerPatternHint where="place" />
    </div>
  {/if}

  <div
    class="grid"
    bind:this={scroller}
    bind:clientHeight={viewportHeight}
    onscroll={() => (scrollTop = scroller?.scrollTop ?? 0)}
  >
    <!-- One tall spacer, with only the visible rows positioned inside it.
         The spacer is what gives the scrollbar the right length without
         nine hundred elements existing. -->
    <div class="spacer" style={`height: ${view.totalRows * TILE}px`}>
      {#each visible as block, offset (block)}
        {@const index = view.firstIndex + offset}
        <button
          class="tile"
          style={`
            top: ${Math.floor(index / COLUMNS) * TILE}px;
            left: ${(index % COLUMNS) * TILE}px;
          `}
          onclick={() => {
            onpick(block);
            onclose();
          }}
          draggable="true"
          ondragstart={(event) => {
            // Onto a hotbar slot, which rises over this window while it
            // is open: how the game fills its hotbar.
            if (event.dataTransfer) startBlockDrag(event.dataTransfer, { block, pair: [] });
          }}
          title={legacyIdFor(legacy, block) ?? block}
        >
          <span class="slot">
            {#if icons.get(block)}
              <img src={icons.get(block)} alt="" width="32" height="32" />
            {:else}
              <!-- Not empty while it is being built: a blank slot that later
                   fills in reads as a broken image until it does. -->
              <span class="pending" aria-hidden="true"></span>
            {/if}
            {#if legacyIdFor(legacy, block)}
              <span class="legacy figures">{legacyIdFor(legacy, block)}</span>
            {/if}
          </span>
          <span class="name">{blockLabel(block)}</span>
        </button>
      {/each}
    </div>
  </div>
</Modal>

<style>
  /* Takes the header's room: the title beside it is one word. */
  .search {
    flex: 100 1 auto;
    min-width: 0;
    width: auto;
  }

  .count {
    flex: none;
    font-size: var(--text-xs);
    color: var(--text-dim);
  }

  .banner {
    flex: none;
    padding: var(--space-2) var(--space-5);
  }

  .grid {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-3);
  }

  .spacer {
    position: relative;
    width: 100%;
  }

  /* Words under a slot, not a slab: the global button's look is taken off,
     under the pointer too. */
  .tile,
  .tile:hover:not(:disabled),
  .tile:active:not(:disabled) {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    width: 76px;
    height: 76px;
    min-height: 0;
    padding: var(--space-1);
    border: 0;
    background: none;
    color: var(--text-dim);
    overflow: hidden;
  }

  .tile:hover:not(:disabled) {
    color: var(--text);
  }

  /* `.inset`'s well: the block sits in a slot, as in the game's inventory. */
  .slot {
    position: relative;
    flex: none;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    background: var(--slot);
    border: var(--bevel) solid;
    border-color: var(--bevel-lo) var(--bevel-hi) var(--bevel-hi) var(--bevel-lo);
  }

  /* The game lightens the slot under the pointer rather than outlining it. */
  .tile:hover .slot::after {
    content: "";
    position: absolute;
    inset: 0;
    background: var(--slot-text);
    opacity: 0.15;
  }

  img {
    width: 32px;
    height: 32px;
    /* The atlas is 16px art; anything but nearest turns a face into mush. */
    image-rendering: pixelated;
  }

  .pending {
    width: 32px;
    height: 32px;
    background: var(--bg-raised);
    opacity: 0.35;
  }

  /*
   * The `ID:DATA` the file will really store, on a legacy schematic only,
   * written on the slot as the game writes a stack's count: it answers a
   * question the name has already answered, for the person writing commands
   * against the same build.
   */
  .legacy {
    position: absolute;
    right: var(--space-1);
    bottom: var(--space-1);
    color: var(--slot-text);
    text-shadow: 1px 1px 0 var(--slot-text-shadow);
    font-size: var(--text-xs);
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  /* Two lines, which the tile has room for: on one, every long name came out
     as the same few letters -- "Acacia hangin…" is four different blocks. */
  .name {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    max-width: 100%;
    overflow: hidden;
    overflow-wrap: anywhere;
    text-align: center;
    font-size: var(--text-xs);
    line-height: 1.1;
  }
</style>
