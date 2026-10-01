<script lang="ts">
  /**
   * A block field that shows blocks as blocks, and may hold several.
   *
   * The value is a mix's spelling (`shared/block_mix.ts`): one block is the
   * bare id, as every block field in the app has always held, and two or more
   * are `70%stone,30%andesite`. So the field changes how a block is shown and
   * typed, and nothing about what reaches main.
   *
   * Each block is a chip with its icon. Hovering one shows `BlockTooltip`; a
   * right-click opens `BlockStateModal` on it; the weight under it appears
   * only once there is something to weigh it against. Typing goes after the
   * last chip, through `BlockPicker`'s search, and a choice -- or Enter on text
   * no list holds, like `35:14` or a pasted `/give` -- adds a chip.
   *
   * `weights={false}` is the Replace field, which is a list of blocks to look
   * for and has no use for shares. The weights are still carried in its text,
   * so swapping the two fields twice gives back exactly what was there.
   */
  import {
    addToMix,
    DEFAULT_DISTRIBUTION,
    effectiveShares,
    formatMix,
    freshSeed,
    removeFromMix,
    replaceInMix,
    reweightMix,
    singleBlockMix,
    tryParseMix,
    type BlockMix,
  } from "../../../shared/block_mix.js";
  import type { LegacyIndex } from "../../../shared/legacy_ids.js";
  import BlockPicker from "./BlockPicker.svelte";
  import BlockStateModal from "./BlockStateModal.svelte";
  import BlockTooltip from "./BlockTooltip.svelte";
  import { blockIcons, iconsReady, requestBlockIcons } from "./block_icons.svelte.js";
  import { canonicalBlock, shortName } from "./block_spelling.js";
  import type { AnchorRect } from "./floating.js";
  import { t } from "./i18n.svelte.js";

  interface Props {
    id?: string;
    value: string;
    placeholder?: string;
    /** Show and edit the weights. Off for a list of blocks to look for. */
    weights?: boolean;
    blocks: readonly string[];
    placeable?: ReadonlySet<string> | null;
    legacy?: LegacyIndex | null;
    onchange: (value: string) => void;
    onbrowse?: () => void;
  }

  const {
    id,
    value,
    placeholder,
    weights = true,
    blocks,
    placeable = null,
    legacy = null,
    onchange,
    onbrowse,
  }: Props = $props();

  const EMPTY: BlockMix = { entries: [], distribution: DEFAULT_DISTRIBUTION };

  const mix = $derived.by((): BlockMix => {
    if (value.trim() === "") return EMPTY;
    return tryParseMix(value) ?? singleBlockMix(value.trim());
  });
  const shares = $derived(effectiveShares(mix.entries));
  const showWeights = $derived(weights && mix.entries.length > 1);

  const icons = $derived(blockIcons());
  $effect(() => {
    void iconsReady();
    requestBlockIcons(mix.entries.map((entry) => entry.block));
  });

  /** What is being typed after the last chip. */
  let draft = $state("");

  let chips = $state<(HTMLDivElement | null)[]>([]);
  let hovered = $state<{ index: number; anchor: AnchorRect } | null>(null);
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;
  let editing = $state<{ index: number; anchor: AnchorRect } | null>(null);

  function emit(next: BlockMix): void {
    onchange(next.entries.length === 0 ? "" : formatMix(next));
  }

  function add(text: string): void {
    const block = canonicalBlock(text, legacy);
    draft = "";
    if (block === "") return;
    let next = addToMix(mix, block);
    /*
     * A mix made here gets a seed of its own the moment it becomes one, so
     * filling twice gives the same picture and the dice are what change it.
     * Seed 0 is what a typed mix with no `#random{...}` means, and leaving it
     * would make every mix anybody builds in this field the same pattern.
     */
    if (next.entries.length === 2 && next.distribution.seed === 0) {
      next = { ...next, distribution: { ...next.distribution, seed: freshSeed() } };
    }
    emit(next);
  }

  function rectOf(index: number): AnchorRect | null {
    const element = chips[index];
    if (!element) return null;
    const box = element.getBoundingClientRect();
    return { left: box.left, top: box.top, width: box.width, height: box.height };
  }

  function hoverStart(index: number): void {
    if (hoverTimer !== null) clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      const anchor = rectOf(index);
      if (anchor !== null) hovered = { index, anchor };
    }, 350);
  }

  function hoverEnd(): void {
    if (hoverTimer !== null) clearTimeout(hoverTimer);
    hoverTimer = null;
    hovered = null;
  }

  /** Opens the state editor on a chip. Exported for the materials list. */
  export function edit(index: number): void {
    const anchor = rectOf(index);
    hoverEnd();
    if (anchor !== null) editing = { index, anchor };
  }

  /** Opens the state editor on the last chip, once it has been drawn. */
  export function editLast(): void {
    requestAnimationFrame(() => edit(mix.entries.length - 1));
  }
</script>

<div class="mix" class:weighted={showWeights}>
  <div class="chips">
    <!--
      Keyed on the position as well: text typed by hand may name one block
      twice, and a duplicate key throws inside the flush.
    -->
    {#each mix.entries as entry, index (`${index}:${entry.block}`)}
      <div
        class="chip"
        role="group"
        bind:this={chips[index]}
        aria-label={entry.block}
        onpointerenter={() => hoverStart(index)}
        onpointerleave={hoverEnd}
        oncontextmenu={(event) => {
          event.preventDefault();
          edit(index);
        }}
      >
        <div class="tile">
          {#if icons.get(entry.block)}
            <img src={icons.get(entry.block)} alt="" width="26" height="26" />
          {:else}
            <span class="pending" aria-hidden="true">{shortName(entry.block).slice(0, 2)}</span>
          {/if}
          <button
            class="remove"
            type="button"
            title={t("mix.remove", { block: shortName(entry.block) })}
            aria-label={t("mix.remove", { block: shortName(entry.block) })}
            onclick={() => emit(removeFromMix(mix, index))}
          >
            ×
          </button>
        </div>
        {#if showWeights}
          <input
            class="weight"
            type="number"
            min="0"
            step="1"
            value={entry.weight}
            title={t("mix.weight")}
            aria-label={t("mix.weightOf", { block: shortName(entry.block) })}
            onchange={(event) => emit(reweightMix(mix, index, Number(event.currentTarget.value)))}
          />
          <span class="share">{Math.round(shares[index] * 100)}%</span>
        {/if}
      </div>
    {/each}
    <div class="adder">
      <BlockPicker
        {id}
        value={draft}
        placeholder={mix.entries.length === 0 ? placeholder : t("mix.add")}
        {blocks}
        {placeable}
        {legacy}
        onchange={(text) => (draft = text)}
        onpick={add}
      />
    </div>
  </div>
  {#if onbrowse}
    <button
      class="browse"
      type="button"
      onclick={onbrowse}
      title={t("selection.browse")}
      aria-label={t("selection.browse")}
    >
      &#x229E;
    </button>
  {/if}
</div>

{#if weights && mix.entries.length > 1}
  <div class="distribution">
    <span>{t("mix.random")}</span>
    <label>
      {t("mix.seed")}
      <input
        type="number"
        step="1"
        value={mix.distribution.seed}
        onchange={(event) =>
          emit({ ...mix, distribution: { ...mix.distribution, seed: Math.trunc(Number(event.currentTarget.value)) || 0 } })}
      />
    </label>
    <button
      type="button"
      class="dice"
      title={t("mix.reroll")}
      aria-label={t("mix.reroll")}
      onclick={() => emit({ ...mix, distribution: { ...mix.distribution, seed: freshSeed() } })}
    >
      🎲
    </button>
  </div>
{/if}

<!--
  Not while the state editor is open: changing a state re-keys the chip, the
  pointer is still over the new one, and the tooltip would come back on top of
  the panel it is describing.
-->
<BlockTooltip
  block={hovered === null || editing !== null ? null : (mix.entries[hovered.index]?.block ?? null)}
  anchor={hovered?.anchor ?? null}
  {legacy}
  weight={hovered !== null && showWeights ? (mix.entries[hovered.index]?.weight ?? null) : null}
  share={hovered !== null && showWeights ? (shares[hovered.index] ?? null) : null}
/>

{#if editing !== null && mix.entries[editing.index]}
  <BlockStateModal
    block={mix.entries[editing.index].block}
    anchor={editing.anchor}
    {legacy}
    onchange={(next) => {
      if (editing !== null) emit(replaceInMix(mix, editing.index, next));
    }}
    onclose={() => (editing = null)}
  />
{/if}

<style>
  .mix {
    display: flex;
    align-items: flex-start;
    gap: 4px;
  }

  .chips {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 4px;
    padding: 3px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-input);
  }

  .chip {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    width: 38px;
  }

  .tile {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 4px;
    background: var(--bg-panel);
  }

  .tile img {
    width: 26px;
    height: 26px;
    image-rendering: pixelated;
  }

  .pending {
    font-size: 10px;
    color: var(--text-dim);
    text-transform: uppercase;
  }

  .remove {
    position: absolute;
    top: -4px;
    right: -4px;
    display: none;
    width: 14px;
    height: 14px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--danger);
    color: var(--bg-panel);
    font-size: 11px;
    line-height: 14px;
    cursor: pointer;
  }

  .chip:hover .remove,
  .remove:focus-visible {
    display: block;
  }

  .weight {
    width: 38px;
    box-sizing: border-box;
    padding: 1px 2px;
    font-size: 10px;
    text-align: center;
  }

  .share {
    font-size: 9px;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }

  .adder {
    flex: 1 1 70px;
    min-width: 70px;
    align-self: center;
  }

  .adder :global(input) {
    border: none;
    background: transparent;
    padding: 4px 2px;
  }

  .browse {
    flex: none;
    width: 26px;
    align-self: stretch;
  }

  .distribution {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 2px;
    font-size: 11px;
    color: var(--text-dim);
  }

  .distribution label {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 0;
  }

  .distribution input {
    width: 90px;
    padding: 1px 4px;
    font-size: 11px;
  }

  .dice {
    padding: 0 4px;
    border: none;
    background: none;
    font-size: 14px;
    cursor: pointer;
  }
</style>
