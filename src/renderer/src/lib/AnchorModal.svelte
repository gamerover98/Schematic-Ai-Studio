<script lang="ts">
  /**
   * WorldEdit's paste anchor: create it, move it, show it, take it away.
   *
   * The anchor is a *cell*, and that is what this panel is about — the number
   * the file stores is its negation, and `anchorOf`/`offsetFor` in main are the
   * only two places that know. What is shown here is what is drawn in the
   * viewport, so the two can never disagree by a sign.
   *
   * The INFO block is not decoration. This is a tag nobody has heard of until
   * they need it, and the difference between a schematic that pastes where it
   * should and one that lands three blocks off is entirely inside it.
   */
  import {
    anchorLocation,
    tagPathLabel,
    type SchematicFormat,
  } from "../../../shared/schematic.js";
  import { anchorKey, mirrorAnchor } from "./anchor_draft.js";
  import { t } from "./i18n.svelte.js";
  import Modal from "./Modal.svelte";

  interface Props {
    open: boolean;
    /** The cell the anchor occupies, or `null` when there is no anchor. */
    anchor: [number, number, number] | null;
    /** What the file actually stores, shown so the negation is not a secret. */
    offset: [number, number, number] | null;
    /**
     * The open document's container, because it decides *which tag* the anchor
     * is written to — and that is the whole of what this panel got wrong.
     * Saying "Offset" for a Sponge v2 file names a tag holding the world
     * corner, so looking there and finding the wrong number is the correct
     * conclusion from a false statement.
     */
    format: SchematicFormat;
    /** The schematic's size, for the centre preset and the inside/outside note. */
    size: [number, number, number];
    /** Whether the marker is drawn in the viewport. */
    visible: boolean;
    busy: boolean;
    /**
     * Main's wording for whatever went wrong, shown *inside* the modal.
     *
     * The app's status banner is behind the scrim, so a failure reported there
     * is a failure nobody can see: the button appears to do nothing at all.
     */
    error: string;
    onset: (anchor: [number, number, number]) => void;
    onclear: () => void;
    onvisibility: (visible: boolean) => void;
    onclose: () => void;
  }

  const {
    open,
    anchor,
    offset,
    format,
    size,
    visible,
    busy,
    error,
    onset,
    onclear,
    onvisibility,
    onclose,
  }: Props = $props();

  let draft = $state<[string, string, string]>(["", "", ""]);

  /**
   * Main owns the anchor; this mirrors whatever comes back, including a Clear.
   *
   * The decision is `mirrorAnchor`'s, and it is keyed on the value rather than
   * on the prop's identity — see that module for what mirroring on identity
   * does to anything half-typed.
   */
  let mirrored = $state<string | null>(null);
  $effect(() => {
    const next = mirrorAnchor(anchor, mirrored);
    if (next === null) return;
    mirrored = anchorKey(anchor);
    draft = next;
  });

  const complete = $derived(
    draft.every((value) => value.trim() !== "" && Number.isFinite(Number(value))),
  );
  const values = $derived(
    [Number(draft[0]), Number(draft[1]), Number(draft[2])] as [number, number, number],
  );

  /**
   * The middle of the build, which is where somebody copying a selection
   * usually stands. Floored, because a cell is a whole number and the centre of
   * an even span falls between two.
   */
  const centre = $derived(
    [
      Math.floor(size[0] / 2),
      0,
      Math.floor(size[2] / 2),
    ] as [number, number, number],
  );

  const outside = $derived(
    anchor !== null &&
      (anchor[0] < 0 ||
        anchor[1] < 0 ||
        anchor[2] < 0 ||
        anchor[0] >= size[0] ||
        anchor[1] >= size[1] ||
        anchor[2] >= size[2]),
  );

  /**
   * `Offset`, `Metadata.WEOffsetX/Y/Z`, … — whichever this file will use, or
   * `null` for a container that has nowhere to keep one.
   *
   * Litematica is that container. The anchor still exists in the document and
   * the marker still shows in the viewport; what changes is that saving drops
   * it, and this panel is the only place that could say so. Naming a plausible
   * tag instead would be the failure this whole pair of functions was added to
   * fix, in a new format.
   */
  const storedAt = $derived.by(() => {
    const location = anchorLocation(format);
    return location === null ? null : tagPathLabel(location);
  });

  function preset(next: [number, number, number]): void {
    draft = [String(next[0]), String(next[1]), String(next[2])];
    onset(next);
  }
</script>

<Modal {open} title={t("anchor.title")} {onclose} width={620}>
  <section class="callout info">
    <h3>{t("anchor.infoTitle")}</h3>
    <p>{t("anchor.infoWhat")}</p>
    <!-- One paragraph to say what it is; the rest a press away. -->
    <details class="more">
      <summary>{t("anchor.more")}</summary>
      <p>{t("anchor.infoExample")}</p>
      <p>{t("anchor.infoPivot")}</p>
      <p>{t("anchor.infoStorage")}</p>
    </details>
  </section>

  <section>
    <h3>{t("anchor.positionTitle")}</h3>
    {#if anchor === null}
      <p class="hint none">{t("anchor.none")}</p>
    {/if}

    <div class="fields">
      {#each ["x", "y", "z"] as axis, index (axis)}
        <label>
          <span>{axis.toUpperCase()}</span>
          <input
            type="number"
            step="1"
            value={draft[index]}
            placeholder="0"
            disabled={busy}
            oninput={(event) => (draft[index] = event.currentTarget.value)}
            onkeydown={(event) => {
              if (event.key === "Enter" && complete) onset(values);
            }}
          />
        </label>
      {/each}
      <button class="primary" disabled={busy || !complete} onclick={() => onset(values)}>
        {anchor === null ? t("anchor.create") : t("anchor.move")}
      </button>
    </div>

    <div class="presets">
      <button disabled={busy} onclick={() => preset(centre)}>{t("anchor.atCentre")}</button>
      <button disabled={busy} onclick={() => preset([0, 0, 0])}>{t("anchor.atCorner")}</button>
      <button class="danger" disabled={busy || anchor === null} onclick={onclear}>
        {t("anchor.delete")}
      </button>
    </div>

    {#if outside}
      <p class="hint">{t("anchor.outside")}</p>
    {/if}

    {#if offset !== null}
      <p class="hint stored">
        {#if storedAt === null}
          {t("anchor.notStored")}
        {:else}
          {t("anchor.stored", {
            tag: storedAt,
            x: offset[0],
            y: offset[1],
            z: offset[2],
          })}
        {/if}
      </p>
    {/if}

    {#if error}
      <p class="callout bad error" role="alert">{error}</p>
    {/if}
  </section>

  <section>
    <h3>{t("anchor.viewTitle")}</h3>
    <label class="check">
      <input
        type="checkbox"
        checked={visible}
        disabled={busy}
        onchange={(event) => onvisibility(event.currentTarget.checked)}
      />
      {t("anchor.showMarker")}
    </label>
    <p class="hint">{t("anchor.markerHint")}</p>
  </section>
</Modal>

<style>
  section + section {
    margin-top: var(--space-5);
  }

  .info p {
    margin: 0 0 var(--space-3);
    font-size: var(--text-md);
  }

  .info p:last-child {
    margin-bottom: 0;
  }

  .none {
    margin: 0 0 var(--space-3);
  }

  .fields {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }

  .fields label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
  }

  .fields input {
    width: 88px;
  }

  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }

  .check {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin: 0;
    color: var(--text);
    font-size: var(--text-md);
  }

  .stored {
    font-family: var(--mono);
  }

  .error {
    margin-top: var(--space-3);
  }
</style>
