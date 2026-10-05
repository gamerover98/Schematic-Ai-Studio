<script lang="ts">
  /**
   * How big the schematic is, and who decides.
   *
   * Three controls and three different mechanisms, which is the reason this is
   * one panel rather than three settings scattered about:
   *
   * - the **cage** is drawn by the viewer and touches nothing else;
   * - **automatic resizing** changes what an edit is allowed to do, and is
   *     honoured in main;
   * - the **size** is an edit, on the undo stack like any other.
   *
   * The shrink warning is not shown up front and must not be. Main counts what
   * would be lost and refuses, and this shows what came back -- because the
   * count is a fact about the blocks in the document, which this side does not
   * have, and a number guessed here would be wrong in exactly the case that
   * matters.
   */
  import { DOCUMENT_SIZE } from "../../../shared/settings.js";
  import { t } from "./i18n.svelte.js";
  import Modal from "./Modal.svelte";

  interface Props {
    open: boolean;
    /** The document's size now, which is also what the fields start at. */
    size: [number, number, number];
    /** Whether an edit outside the box may move the box. */
    autoGrow: boolean;
    /** Whether the box is drawn. */
    showBounds: boolean;
    busy: boolean;
    /**
     * Main's wording for whatever it refused, shown *inside* the modal.
     *
     * The app's status banner is behind the scrim, so a refusal reported there
     * is one nobody can see: the button would appear to do nothing at all.
     */
    error: string;
    /** True once main has refused a lossy shrink, so the button can offer to. */
    confirmable: boolean;
    onresize: (size: [number, number, number], confirmLoss: boolean) => void;
    onautogrow: (autoGrow: boolean) => void;
    onbounds: (showBounds: boolean) => void;
    onclose: () => void;
  }

  const {
    open,
    size,
    autoGrow,
    showBounds,
    busy,
    error,
    confirmable,
    onresize,
    onautogrow,
    onbounds,
    onclose,
  }: Props = $props();

  let draft = $state<[string, string, string]>(["", "", ""]);

  /**
   * Mirrors the document's size into the fields, keyed on the value.
   *
   * On identity it would refill them on every state push -- which is many a
   * second while a selection face is being dragged -- and wipe out whatever was
   * half-typed. `anchor_draft.ts` states the same rule for the anchor fields;
   * this is small enough to keep inline, and it is the same shape.
   */
  let mirrored = $state<string | null>(null);
  $effect(() => {
    const key = size.join(",");
    if (mirrored === key) return;
    mirrored = key;
    draft = [String(size[0]), String(size[1]), String(size[2])];
  });

  const parsed = $derived(draft.map((value) => Number.parseInt(value, 10)));

  const valid = $derived(
    parsed.every(
      (value) =>
        Number.isFinite(value) && value >= DOCUMENT_SIZE.min && value <= DOCUMENT_SIZE.max,
    ),
  );

  const changed = $derived(valid && parsed.some((value, index) => value !== size[index]));

  /** Whether any axis is being made smaller, which is the only lossy direction. */
  const shrinking = $derived(valid && parsed.some((value, index) => value < size[index]));

  const AXES = ["dimensions.width", "dimensions.height", "dimensions.length"] as const;

  function apply(confirmLoss: boolean): void {
    if (!changed || busy) return;
    onresize([parsed[0], parsed[1], parsed[2]], confirmLoss);
  }

</script>

<Modal {open} title={t("dimensions.title")} {onclose} width={460}>
  <label class="check">
    <input type="checkbox" checked={showBounds} onchange={(event) => onbounds(event.currentTarget.checked)} />
    <span>
      {t("dimensions.showBounds")}
      <small>{t("dimensions.showBoundsHint")}</small>
    </span>
  </label>

  <label class="check">
    <input type="checkbox" checked={autoGrow} onchange={(event) => onautogrow(event.currentTarget.checked)} />
    <span>
      {t("dimensions.autoGrow")}
      <small>{t("dimensions.autoGrowHint")}</small>
    </span>
  </label>

  <!--
    Always editable, not only with automatic resizing off. The two are not
    opposites: someone who builds freely still wants to say "make it 64
    wide" once, and hiding the fields behind a checkbox would make that
    look like it needed the checkbox.
  -->
  <fieldset>
    <legend>{t("dimensions.size")}</legend>
    <div class="axes">
      {#each AXES as axis, index (axis)}
        <label>
          <span>{t(axis)}</span>
          <input
            type="number"
            min={DOCUMENT_SIZE.min}
            max={DOCUMENT_SIZE.max}
            step="1"
            value={draft[index]}
            disabled={busy}
            oninput={(event) => (draft[index] = event.currentTarget.value)}
          />
        </label>
      {/each}
    </div>

    <!--
      Said before the button is pressed, because it is knowable here: any
      axis getting smaller *may* cost blocks. How many is main's to count,
      and arrives only if it refuses.
    -->
    {#if shrinking}
      <p class="callout warn shrinking">{t("dimensions.shrinking")}</p>
    {/if}
  </fieldset>

  {#if error !== ""}
    <p class="callout bad" role="alert">{error}</p>
  {/if}

  {#snippet footer()}
    <button onclick={onclose}>{t("common.close")}</button>
    {#if confirmable}
      <!--
        Only after main has refused once, and it says what it is agreeing
        to. A permanent "and delete whatever falls outside" checkbox would
        be armed on every ordinary resize, which is the state this refusal
        exists to avoid.
      -->
      <button class="danger" disabled={!changed || busy} onclick={() => apply(true)}>
        {t("dimensions.applyAnyway")}
      </button>
    {:else}
      <button class="primary" disabled={!changed || busy} onclick={() => apply(false)}>
        {t("dimensions.apply")}
      </button>
    {/if}
  {/snippet}
</Modal>

<style>
  .check {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
    color: var(--text);
    font-size: var(--text-md);
  }

  .check small {
    display: block;
    margin-top: var(--space-1);
    color: var(--text-dim);
    font-size: var(--text-sm);
    line-height: 1.4;
  }

  fieldset {
    margin-bottom: var(--space-4);
  }

  .axes {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-3);
  }

  .axes label {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
  }

  .shrinking {
    margin-top: var(--space-4);
  }
</style>
