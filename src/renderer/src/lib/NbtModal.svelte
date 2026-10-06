<script lang="ts">
  /**
   * The schematic's own NBT, as text you can edit.
   *
   * A modal rather than a `ToolWindow` for one plain reason: the tool window is
   * a fixed 232px, and this holds a whole schematic's block-entity list. It also
   * needs no persisted position and no `UiSettings` fields, which a floating
   * panel would have wanted.
   *
   * Main is the referee. This holds a string, sends a string, and shows whatever
   * came back -- the parsing, the validation and the line numbers are all on the
   * other side of the bridge, where the document is.
   */
  import {
    anchorLocation,
    originLocation,
    tagPathLabel,
    type SchematicFormat,
  } from "../../../shared/schematic.js";
  import { t } from "./i18n.svelte.js";
  import Modal from "./Modal.svelte";

  interface Props {
    open: boolean;
    /** SNBT from main, refetched on open and on Revert. */
    text: string;
    /** False when the schematic was too large to offer: read-only. */
    editable: boolean;
    /** Tags left out of the text, named so the panel can say which. */
    omitted: string[];
    /** WorldEdit's Origin, or `null` when the file names none. */
    origin: [number, number, number] | null;
    /** The container, which decides where in this text the two vectors land. */
    format: SchematicFormat;
    busy: boolean;
    /** Main's wording for whatever went wrong, shown as it arrived. */
    error: string;
    onapply: (text: string) => void;
    onrevert: () => void;
    onorigin: (origin: [number, number, number] | null) => void;
    onclose: () => void;
  }

  const {
    open,
    text,
    editable,
    omitted,
    origin,
    format,
    busy,
    error,
    onapply,
    onrevert,
    onorigin,
    onclose,
  }: Props = $props();

  /** The edit in progress. Reset from `text` whenever main hands over a new one. */
  let draft = $state("");
  let originDraft = $state<[string, string, string]>(["", "", ""]);

  // Main owns the text; this mirrors it whenever a fresh one arrives, which is
  // on open and after a Revert or an Apply.
  $effect(() => {
    draft = text;
  });

  $effect(() => {
    originDraft = origin === null
      ? ["", "", ""]
      : [String(origin[0]), String(origin[1]), String(origin[2])];
  });

  /*
   * Where the two WorldEdit vectors are in the text below.
   *
   * Worth a line of its own because the answer is not guessable and differs
   * per container: v3 puts the anchor at the top level as `Offset` and leaves
   * `Metadata` holding only the Origin, so someone who set an anchor and then
   * went looking for a `WE*` key in `Metadata` — which is where WorldEdit's
   * *MCEdit* files keep it — finds nothing and concludes it was never written.
   */
  const anchorAt = $derived.by(() => {
    const location = anchorLocation(format);
    return location === null ? null : tagPathLabel(location);
  });
  const originAt = $derived.by(() => {
    const location = originLocation(format);
    return location === null ? null : tagPathLabel(location);
  });

  const dirty = $derived(draft !== text);
  const originComplete = $derived(
    originDraft.every((value) => value.trim() !== "" && Number.isFinite(Number(value))),
  );

  function applyOrigin(): void {
    if (!originComplete) return;
    onorigin([Number(originDraft[0]), Number(originDraft[1]), Number(originDraft[2])]);
  }
</script>

<!--
  Escape only, which the dialog already does. Enter belongs to the textarea --
  a newline is the one key an NBT editor cannot afford to have taken away
  from it, which is why this deliberately does not copy the chat composer's
  Enter/Shift+Enter split.
-->
<Modal {open} title={t("nbt.title")} {onclose} width={820} height={680} flush>
  <section class="origin">
    <h3>{t("nbt.originTitle")}</h3>
    <p class="hint">{t("nbt.originHint")}</p>
    <div class="fields">
      {#each ["x", "y", "z"] as axis, index (axis)}
        <label>
          <span>{axis.toUpperCase()}</span>
          <input
            type="number"
            step="1"
            value={originDraft[index]}
            placeholder={t("nbt.originUnset")}
            disabled={busy}
            oninput={(event) => (originDraft[index] = event.currentTarget.value)}
            onkeydown={(event) => {
              if (event.key === "Enter") applyOrigin();
            }}
          />
        </label>
      {/each}
      <button disabled={busy || !originComplete} onclick={applyOrigin}>
        {t("nbt.originSet")}
      </button>
      <button disabled={busy || origin === null} onclick={() => onorigin(null)}>
        {t("nbt.originClear")}
      </button>
    </div>
    <p class="hint">
      {#if anchorAt === null || originAt === null}
        {t("nbt.whereNone")}
      {:else}
        {t("nbt.whereHint", { anchor: anchorAt, origin: originAt })}
      {/if}
    </p>
  </section>

  <section class="text">
    <p class="hint">
      {editable ? t("nbt.omittedHint", { tags: omitted.join(", ") }) : t("nbt.readOnly")}
    </p>
    <textarea
      spellcheck="false"
      value={draft}
      readonly={!editable}
      disabled={busy}
      aria-label={t("nbt.title")}
      oninput={(event) => (draft = event.currentTarget.value)}
    ></textarea>
    {#if error}
      <p class="callout bad" role="alert">{error}</p>
    {/if}
  </section>

  {#snippet footer()}
    <button disabled={busy || !dirty} onclick={onrevert}>{t("nbt.revert")}</button>
    <button class="primary" disabled={busy || !editable || !dirty} onclick={() => onapply(draft)}>
      {t("nbt.apply")}
    </button>
  {/snippet}
</Modal>

<style>
  /* A groove under the Origin, which is trim: the text below is the point. */
  .origin {
    flex: none;
    padding: var(--space-2) var(--space-5) var(--space-4);
    border-bottom: var(--bevel) solid var(--bevel-lo);
    box-shadow: 0 var(--bevel) 0 var(--bevel-hi);
  }

  .origin h3 {
    margin-bottom: var(--space-1);
  }

  .fields {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    margin-top: var(--space-3);
  }

  .fields label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
  }

  .fields input {
    width: 92px;
  }

  /* The text takes what is left, and scrolls inside itself. */
  .text {
    flex: 1 1 auto;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    gap: var(--space-3);
    min-height: 0;
    padding: var(--space-4) var(--space-5);
  }

  .text .hint {
    margin: 0;
  }

  textarea {
    min-height: 0;
    height: 100%;
    resize: none;
    font-family: var(--mono);
    font-size: var(--text-sm);
    line-height: 1.5;
    tab-size: 2;
    white-space: pre;
    overflow: auto;
  }
</style>
