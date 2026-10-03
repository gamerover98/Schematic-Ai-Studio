<script lang="ts">
  /**
   * The states of one block in a mix, opened by a right-click on its chip.
   *
   * It edits the **chip** and nothing else -- the spelling a fill or a
   * placement will write -- so it is not the inspector, which edits a block
   * already in the document. The neighbour rules still have the last word at
   * the moment of writing: a fence's arms set here are re-derived from what
   * actually stands beside it, as every write is.
   *
   * On a pre-Flattening document a block is an `ID:DATA` pair, and that is how
   * its variants were chosen: wool is `35:0` to `35:15`. So there the panel is
   * the grid of rows `legacy_blocks.json` has for the id, each drawn and
   * labelled, with the chosen one's states shown underneath for reading. The
   * modern state editor would offer combinations that era cannot store.
   */
  import { legacyIdForState, legacyVariantsOf, type LegacyIndex } from "../../../shared/legacy_ids.js";
  import { defaultStateFor } from "../../../shared/block_states.js";
  import { blockIcons, requestBlockIcons } from "./block_icons.svelte.js";
  import Icon from "./Icon.svelte";
  import { canonicalBlock, readSpelling, writeSpelling } from "./block_spelling.js";
  import { placePopover, type AnchorRect } from "./floating.js";
  import { propertyRows } from "./inspector_rows.js";
  import { t } from "./i18n.svelte.js";

  interface Props {
    block: string;
    anchor: AnchorRect;
    legacy?: LegacyIndex | null;
    onchange: (block: string) => void;
    onclose: () => void;
  }

  const { block, anchor, legacy = null, onchange, onclose }: Props = $props();

  let root = $state<HTMLDivElement | null>(null);
  let placement = $state<{ x: number; y: number } | null>(null);
  let innerWidth = $state(0);
  let innerHeight = $state(0);

  const icons = $derived(blockIcons());
  const spelling = $derived(readSpelling(block));

  const rows = $derived(
    spelling === null ? [] : propertyRows(spelling.name, spelling.properties, legacy),
  );
  const defaults = $derived(spelling === null || legacy !== null ? {} : defaultStateFor(spelling.name));

  const variants = $derived(legacy === null ? [] : legacyVariantsOf(legacy, block));
  const current = $derived(legacyIdForState(legacy, block));

  $effect(() => {
    requestBlockIcons([block, ...variants.map((variant) => variant.modern)]);
  });

  function setProperty(name: string, value: string): void {
    if (spelling === null) return;
    const properties = { ...spelling.properties };
    if (value === "") delete properties[name];
    else properties[name] = value;
    onchange(writeSpelling({ ...spelling, properties }));
  }

  function resetAll(): void {
    if (spelling === null) return;
    onchange(writeSpelling({ ...spelling, properties: {} }));
  }

  function chooseVariant(modern: string): void {
    // The design rides along: a banner's look is not in its `ID:DATA`.
    const next = readSpelling(modern);
    if (next === null) return;
    onchange(canonicalBlock(writeSpelling({ ...next, bannerPatterns: spelling?.bannerPatterns ?? null }), null));
  }

  $effect(() => {
    if (root === null) {
      placement = null;
      return;
    }
    void rows.length;
    void variants.length;
    const box = root.getBoundingClientRect();
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
      "below",
    );
  });

  function onWindowPointer(event: PointerEvent): void {
    if (root !== null && !root.contains(event.target as Node)) onclose();
  }

  /*
   * Escape closes this and nothing else. The app's own window handler drops
   * the selection on Escape, and it was registered first, so a bubbling
   * listener here would run second and both would happen. Capture on the
   * window runs before either, and stopping there keeps the key from them.
   */
  $effect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      event.preventDefault();
      onclose();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  });
</script>

<svelte:window bind:innerWidth bind:innerHeight onpointerdown={onWindowPointer} />

<div
  class="modal"
  role="dialog"
  aria-label={t("blockState.title")}
  bind:this={root}
  style={placement === null ? "visibility: hidden" : `left: ${placement.x}px; top: ${placement.y}px`}
>
  <div class="head">
    {#if icons.get(block)}
      <img src={icons.get(block)} alt="" width="32" height="32" />
    {:else}
      <span class="pending" aria-hidden="true"></span>
    {/if}
    <code class="id">{block}</code>
    <button class="close" onclick={onclose} title={t("common.close")} aria-label={t("common.close")}>
      <Icon name="close" size={14} weight={2.2} />
    </button>
  </div>

  {#if legacy !== null}
    {#if variants.length === 0}
      <p class="hint">{t("blockState.legacyUnknown")}</p>
    {:else}
      <p class="label">{t("blockState.legacyVariants")}</p>
      <div class="variants">
        {#each variants as variant (variant.label)}
          <button
            class="variant"
            class:chosen={current?.exact === true && current.label === variant.label}
            title={variant.modern}
            onclick={() => chooseVariant(variant.modern)}
          >
            {#if icons.get(variant.modern)}
              <img src={icons.get(variant.modern)} alt="" width="28" height="28" />
            {:else}
              <span class="pending small" aria-hidden="true"></span>
            {/if}
            <span class="data">{variant.label}</span>
          </button>
        {/each}
      </div>
      {#if current !== null && !current.exact}
        <p class="hint">{t("blockState.legacyNotExact", { id: current.label })}</p>
      {/if}
    {/if}
    {#if rows.length > 0}
      <dl class="readonly">
        {#each rows as row (row.name)}
          <dt>{row.name}</dt>
          <dd>{row.value ?? "—"}</dd>
        {/each}
      </dl>
    {/if}
  {:else if rows.length === 0}
    <p class="hint">{t("blockState.none")}</p>
  {:else}
    <ul class="rows">
      {#each rows as row (row.name)}
        <li>
          <label for={`state-${row.name}`} class:unset={row.value === null}>{row.name}</label>
          {#if row.values}
            <select
              id={`state-${row.name}`}
              value={row.value ?? ""}
              onchange={(event) => setProperty(row.name, event.currentTarget.value)}
            >
              <option value="">
                {t("blockState.default", { value: defaults[row.name] ?? "—" })}
              </option>
              {#each row.values as option (option)}
                <option value={option}>{option}</option>
              {/each}
            </select>
          {:else}
            <input
              id={`state-${row.name}`}
              value={row.value ?? ""}
              placeholder={t("inspector.unset")}
              spellcheck="false"
              onchange={(event) => setProperty(row.name, event.currentTarget.value.trim())}
            />
          {/if}
        </li>
      {/each}
    </ul>
    <div class="foot">
      <p class="hint">{t("blockState.hint")}</p>
      <button onclick={resetAll} disabled={spelling === null || Object.keys(spelling.properties).length === 0}>
        {t("blockState.reset")}
      </button>
    </div>
  {/if}
</div>

<style>
  .modal {
    position: fixed;
    z-index: 30;
    width: min(270px, calc(100vw - 16px));
    max-height: min(420px, calc(100vh - 16px));
    overflow-y: auto;
    box-sizing: border-box;
    padding: 8px 10px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-panel);
    box-shadow: 0 8px 24px var(--shadow);
    font-size: 12px;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }

  .head img,
  .pending {
    flex: none;
    width: 32px;
    height: 32px;
    image-rendering: pixelated;
  }

  .pending {
    border-radius: 4px;
    background: var(--bg-input);
  }

  .pending.small {
    width: 28px;
    height: 28px;
  }

  .id {
    flex: 1;
    min-width: 0;
    font-size: 11px;
    overflow-wrap: anywhere;
  }

  .close {
    flex: none;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    background: none;
    color: var(--text-dim);
    cursor: pointer;
  }

  .close:hover {
    color: var(--text);
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .rows li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr);
    align-items: center;
    gap: 6px;
  }

  .rows label {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rows label.unset {
    color: var(--text-dim);
  }

  .rows select,
  .rows input {
    width: 100%;
    min-width: 0;
    font-size: 12px;
  }

  .foot {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    margin-top: 8px;
  }

  .foot .hint {
    flex: 1;
  }

  .hint,
  .label {
    margin: 4px 0;
    font-size: 11px;
    color: var(--text-dim);
  }

  .variants {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(44px, 1fr));
    gap: 4px;
  }

  .variant {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    padding: 3px 2px;
    border: 2px solid transparent;
    border-radius: 4px;
    background: var(--bg-input);
    cursor: pointer;
  }

  .variant img {
    width: 28px;
    height: 28px;
    image-rendering: pixelated;
  }

  .variant.chosen {
    border-color: var(--accent);
  }

  .data {
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    color: var(--text-dim);
  }

  .readonly {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 1px 10px;
    margin: 8px 0 0;
    font-size: 11px;
  }

  .readonly dt,
  .readonly dd {
    margin: 0;
  }

  .readonly dt {
    color: var(--text-dim);
  }
</style>
