<script lang="ts">
  /**
   * A banner's design, as the list of layers it is.
   *
   * The generic NBT rows could show a design and not change it: they read
   * `patterns[3].pattern`, one leaf at a time, and a leaf editor has no way to
   * add a layer, take one out or put two in a different order -- which is most
   * of what designing a banner is. And a banner with no block entity showed
   * nothing at all, so there was no way to put a design on a banner that was
   * already in the document.
   *
   * ## Whole list out, every time
   *
   * Every change sends the entire list, as the `banner_patterns=[...]` text the
   * rest of the app already reads, through the inspector's own `setState` edit.
   * Main checks it against the document's version, writes it in the document's
   * spelling and keeps the block's state, so one change is one Ctrl+Z and a
   * design the schematic cannot hold is refused by name. Sending a patch per row
   * would be a second protocol for the same fact.
   *
   * The rows are local while they are being typed into and are replaced by what
   * main stored once it answers, so a colour typed as `Orange` comes back the
   * way the file keeps it.
   *
   * ## The colour picker is the sixteen dyes
   *
   * Not a colour wheel: a banner cannot be any other colour, and a picker that
   * offered one would offer something the file cannot hold. The swatches are
   * `DYE_HEX`, the table the cloth is tinted with, so a swatch is the colour the
   * viewport will draw.
   */
  import {
    BANNER_COLORS,
    BANNER_PATTERNS,
    DYE_HEX,
    LOOM_LAYER_LIMIT,
    MAX_BANNER_LAYERS,
  } from "../../../shared/banner_patterns.js";
  import { splitBlockInput } from "../../../shared/block_input.js";
  import BannerPatternHint from "./BannerPatternHint.svelte";
  import { placePopover, type Point } from "./floating.js";
  import { t } from "./i18n.svelte.js";

  interface Layer {
    pattern: string;
    color: string;
  }

  interface Props {
    /** What main last stored, bottom layer first. */
    layers: readonly { pattern: string; color: string }[];
    busy: boolean;
    /** The whole list, as `[{pattern:"...",color:"..."},...]`. */
    onchange: (patterns: string) => void;
  }

  const { layers, busy, onchange }: Props = $props();

  let rows = $state<Layer[]>([]);
  // Replaced whenever main answers with a new inspection, which is also what
  // throws away a half-typed row that main refused.
  $effect(() => {
    rows = layers.map((layer) => ({ pattern: layer.pattern, color: layer.color }));
  });

  /** Quotes and backslashes cannot be in an id or a dye, and would break the list. */
  const clean = (text: string): string => text.trim().replace(/["\\]/g, "");

  function listText(list: readonly Layer[]): string {
    return `[${list
      .map((row) => `{pattern:"${clean(row.pattern)}",color:"${clean(row.color)}"}`)
      .join(",")}]`;
  }

  function commit(next: Layer[]): void {
    rows = next;
    onchange(listText(next));
  }

  function setField(index: number, key: keyof Layer, value: string): void {
    commit(rows.map((row, at) => (at === index ? { ...row, [key]: value } : row)));
  }

  function move(index: number, by: -1 | 1): void {
    const to = index + by;
    if (to < 0 || to >= rows.length) return;
    const next = [...rows];
    [next[index], next[to]] = [next[to], next[index]];
    commit(next);
  }

  function remove(index: number): void {
    commit(rows.filter((_, at) => at !== index));
  }

  function add(): void {
    if (rows.length >= MAX_BANNER_LAYERS) return;
    commit([...rows, { pattern: "base", color: "white" }]);
  }

  // --- pasting a design ------------------------------------------------------

  let pasted = $state("");
  let pasteError = $state("");

  /**
   * A `/give` command, a block with `banner_patterns=[...]`, or the bare list.
   *
   * Only the design is taken: the banner keeps its own name, colour and
   * rotation, because what was clicked is the banner being painted and the
   * command names whatever banner its author happened to make.
   */
  function applyPasted(): void {
    pasteError = "";
    const text = pasted.trim();
    if (text === "") return;
    let patterns: string | null;
    try {
      patterns = text.startsWith("[") ? text : splitBlockInput(text).bannerPatterns;
    } catch (err) {
      pasteError = err instanceof Error ? err.message : String(err);
      return;
    }
    if (patterns === null) {
      pasteError = t("banner.editor.noPatterns");
      return;
    }
    pasted = "";
    onchange(patterns);
  }

  // --- the dye popover -------------------------------------------------------

  let picking = $state<number | null>(null);
  let anchor = $state<DOMRect | null>(null);
  let root = $state<HTMLDivElement | null>(null);
  let panel = $state<HTMLDivElement | null>(null);
  let placement = $state<Point | null>(null);
  let innerWidth = $state(0);
  let innerHeight = $state(0);

  function openPicker(index: number, event: MouseEvent): void {
    if (picking === index) {
      picking = null;
      return;
    }
    anchor = (event.currentTarget as HTMLElement).getBoundingClientRect();
    picking = index;
  }

  function pick(color: string): void {
    if (picking === null) return;
    const index = picking;
    picking = null;
    setField(index, "color", color);
  }

  function onWindowClick(event: MouseEvent): void {
    // A child of `root`, though `position: fixed`, so containment is the test.
    if (picking !== null && root && !root.contains(event.target as Node)) picking = null;
  }

  $effect(() => {
    if (picking === null || panel === null || anchor === null) {
      placement = null;
      return;
    }
    const box = panel.getBoundingClientRect();
    placement = placePopover(
      { left: anchor.left, top: anchor.top, width: anchor.width, height: anchor.height },
      {
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        popoverWidth: box.width,
        popoverHeight: box.height,
        margin: 8,
        gap: 4,
      },
      "below",
    );
  });

  const swatch = (color: string): string | null => {
    const hex = (DYE_HEX as Readonly<Record<string, string>>)[color.trim().replace(/^minecraft:/, "")];
    return hex === undefined ? null : `#${hex}`;
  };

  const describe = (pattern: string): string => {
    const row = BANNER_PATTERNS.find((one) => one.id === pattern.trim().replace(/^minecraft:/, ""));
    return row === undefined ? "" : `${row.name}: ${row.description}`;
  };
</script>

<svelte:window onclick={onWindowClick} bind:innerWidth bind:innerHeight />

<div class="field banner" bind:this={root}>
  <label for="banner-layers">{t("banner.editor.title")}</label>

  {#if rows.length === 0}
    <p class="hint">{t("banner.editor.empty")}</p>
  {:else}
    <ol id="banner-layers" class="layers">
      {#each rows as row, index (index)}
        <li title={describe(row.pattern)}>
          <span class="number">{index + 1}.</span>
          <input
            class="pattern"
            value={row.pattern}
            list="banner-pattern-ids"
            disabled={busy}
            spellcheck="false"
            aria-label={t("banner.editor.pattern", { n: index + 1 })}
            onchange={(event) => setField(index, "pattern", event.currentTarget.value)}
          />
          <input
            class="color"
            value={row.color}
            list="banner-dye-names"
            disabled={busy}
            spellcheck="false"
            aria-label={t("banner.editor.color", { n: index + 1 })}
            onchange={(event) => setField(index, "color", event.currentTarget.value)}
          />
          <button
            class="swatch"
            class:unknown={swatch(row.color) === null}
            style={swatch(row.color) === null ? undefined : `background: ${swatch(row.color)}`}
            disabled={busy}
            title={t("banner.editor.pickColor", { n: index + 1 })}
            aria-label={t("banner.editor.pickColor", { n: index + 1 })}
            aria-expanded={picking === index}
            onclick={(event) => openPicker(index, event)}
          ></button>
          <button
            class="icon"
            disabled={busy || index === 0}
            title={t("banner.editor.moveUp", { n: index + 1 })}
            aria-label={t("banner.editor.moveUp", { n: index + 1 })}
            onclick={() => move(index, -1)}>&#x2191;</button
          >
          <button
            class="icon"
            disabled={busy || index === rows.length - 1}
            title={t("banner.editor.moveDown", { n: index + 1 })}
            aria-label={t("banner.editor.moveDown", { n: index + 1 })}
            onclick={() => move(index, 1)}>&#x2193;</button
          >
          <button
            class="icon remove"
            disabled={busy}
            title={t("banner.editor.remove", { n: index + 1 })}
            aria-label={t("banner.editor.remove", { n: index + 1 })}
            onclick={() => remove(index)}>&#x00d7;</button
          >
        </li>
      {/each}
    </ol>
    <p class="hint">{t("banner.editor.order")}</p>
  {/if}

  <button class="add" disabled={busy || rows.length >= MAX_BANNER_LAYERS} onclick={add}>
    {t("banner.editor.add")}
  </button>
  {#if rows.length >= MAX_BANNER_LAYERS}
    <p class="hint">{t("banner.editor.full", { max: MAX_BANNER_LAYERS })}</p>
  {:else if rows.length > LOOM_LAYER_LIMIT}
    <p class="hint">{t("banner.editor.loom", { max: LOOM_LAYER_LIMIT })}</p>
  {/if}

  <datalist id="banner-pattern-ids">
    {#each BANNER_PATTERNS as one (one.id)}
      <option value={one.id}>{one.name}</option>
    {/each}
  </datalist>
  <datalist id="banner-dye-names">
    {#each BANNER_COLORS as dye (dye)}
      <option value={dye}></option>
    {/each}
  </datalist>

  {#if picking !== null}
    <div
      class="dyes"
      role="dialog"
      aria-label={t("banner.editor.pickColor", { n: picking + 1 })}
      bind:this={panel}
      style={placement === null ? "visibility: hidden" : `left: ${placement.x}px; top: ${placement.y}px`}
    >
      {#each BANNER_COLORS as dye (dye)}
        <button
          class="dye"
          class:chosen={rows[picking]?.color === dye}
          style={`background: #${DYE_HEX[dye]}`}
          title={dye}
          aria-label={dye}
          onclick={() => pick(dye)}
        ></button>
      {/each}
    </div>
  {/if}

  <div class="paste">
    <BannerPatternHint where="inspector" />
    <div class="paste-row">
      <input
        bind:value={pasted}
        placeholder={t("banner.editor.paste")}
        aria-label={t("banner.editor.paste")}
        disabled={busy}
        spellcheck="false"
        onkeydown={(event) => {
          if (event.key === "Enter") applyPasted();
        }}
      />
      <button disabled={busy || pasted.trim() === ""} onclick={applyPasted}>
        {t("banner.editor.apply")}
      </button>
    </div>
    {#if pasteError !== ""}
      <p class="error">{pasteError}</p>
    {/if}
  </div>
</div>

<style>
  .banner {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .layers {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  /*
   * Two lines per layer: the design across the whole width, and its colour
   * under it with the controls. One line was five things in a panel 300px
   * wide, and `triangle_bottom` came out as `triangle`.
   */
  .layers li {
    display: grid;
    grid-template-columns: 20px minmax(0, 1fr) 18px 16px 16px 16px;
    align-items: center;
    gap: 3px 4px;
    padding: 3px 0;
    border-bottom: 1px solid var(--border);
  }

  .layers li:last-child {
    border-bottom: none;
  }

  .layers .pattern {
    grid-column: 2 / -1;
  }

  .layers .color {
    grid-column: 2;
  }

  .number {
    font-size: 11px;
    color: var(--text-dim);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .layers input {
    min-width: 0;
    padding: 3px 6px;
    font-size: 12px;
  }

  .swatch {
    width: 18px;
    height: 18px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 3px;
    cursor: pointer;
  }

  /* A colour that is not a dye: say so rather than drawing a guess. */
  .swatch.unknown {
    background: repeating-linear-gradient(45deg, var(--bg-input) 0 3px, var(--border) 3px 6px);
  }

  .icon {
    width: 16px;
    padding: 0;
    border: none;
    background: none;
    color: var(--text-dim);
    cursor: pointer;
    line-height: 1;
  }

  .icon:hover:not(:disabled) {
    color: var(--text);
  }

  .icon:disabled {
    cursor: default;
    opacity: 0.35;
  }

  .remove {
    font-size: 15px;
  }

  .add {
    align-self: flex-start;
    padding: 3px 8px;
    font-size: 12px;
  }

  .dyes {
    position: fixed;
    z-index: 30;
    display: grid;
    grid-template-columns: repeat(4, 22px);
    gap: 4px;
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-panel);
    box-shadow: 0 6px 20px var(--shadow);
  }

  .dye {
    width: 22px;
    height: 22px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
  }

  .dye.chosen {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .paste {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 4px;
  }

  .paste-row {
    display: flex;
    gap: 4px;
  }

  .paste-row input {
    flex: 1 1 auto;
    min-width: 0;
  }

  .error {
    margin: 0;
    font-size: 11px;
    color: var(--danger);
    overflow-wrap: anywhere;
  }
</style>
