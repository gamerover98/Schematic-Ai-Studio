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
   */
  import type { PaletteCount } from "../../../shared/ipc.js";
  import type { LegacyIndex } from "../../../shared/legacy_ids.js";
  import BlockTooltip from "./BlockTooltip.svelte";
  import Icon from "./Icon.svelte";
  import { blockIcons, iconsReady, requestBlockIcons } from "./block_icons.svelte.js";
  import { shortName } from "./block_spelling.js";
  import type { AnchorRect } from "./floating.js";
  import { t } from "./i18n.svelte.js";
  import { AIR, formatCount, materialAction, type MaterialAction } from "./materials.js";

  interface Props {
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
    onaction: (block: string, action: MaterialAction) => void;
  }

  const { palette, air, outside, cells, scope, legacy = null, onaction }: Props = $props();

  const slots = $derived<{ block: string; count: number; air: boolean }[]>([
    ...palette.map((entry) => ({ block: entry.block, count: entry.count, air: false })),
    ...(air > 0 ? [{ block: AIR, count: air, air: true }] : []),
  ]);

  /** What the shares are of: the cells that hold something, air included. */
  const inside = $derived(Math.max(1, cells - outside));

  const icons = $derived(blockIcons());
  $effect(() => {
    void iconsReady();
    requestBlockIcons(palette.map((entry) => entry.block));
  });

  let elements = $state<(HTMLButtonElement | null)[]>([]);
  let hovered = $state<{ index: number; anchor: AnchorRect } | null>(null);
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

  function act(slot: { block: string; air: boolean }, event: MouseEvent, button: number): void {
    const action = materialAction(
      { button, ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey },
      slot.air,
    );
    if (action === "none") return;
    hoverEnd();
    onaction(slot.block, action);
  }

  const hoveredSlot = $derived(hovered === null ? null : (slots[hovered.index] ?? null));
</script>

<div class="inventory">
  <!-- Keyed on the block: a palette names each state once, and air is not in it. -->
  {#each slots as slot, index (slot.block)}
    <button
      type="button"
      class="slot"
      class:air={slot.air}
      bind:this={elements[index]}
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

<style>
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
