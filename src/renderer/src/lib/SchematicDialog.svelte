<script lang="ts">
  /**
   * What a schematic is going to be: how big, which container, which version.
   *
   * One component for New and for Save As, because they ask the same three
   * questions and only the size field differs — New sets it, Save As inherits
   * it from the open document and shows it as a fact. Two components would be
   * two places to keep the era rule, and the era rule is the whole reason these
   * questions belong together.
   *
   * ## Why the format is chosen here and not in the OS dialog
   *
   * `.schem` is both Sponge v2 and Sponge v3, and Electron's save dialog
   * reports the path the user chose but not which filter produced it. So the
   * container cannot be recovered from the file name, which means it has to be
   * decided before the native dialog opens rather than read out of it after.
   */
  import {
    SCHEMATIC_FORMAT_LABEL,
    schematicExtension,
    type SchematicFormat,
  } from "../../../shared/schematic.js";
  import {
    formatsFor,
    MC_VERSIONS,
    mcVersion,
    refusalFor,
  } from "../../../shared/mc_versions.js";
  import { t, tn } from "./i18n.svelte.js";
  import Modal from "./Modal.svelte";

  interface Props {
    open: boolean;
    /** `new` asks for a size; `save-as` shows the one the document already has. */
    mode: "new" | "save-as";
    /** Starting values, so Save As opens on what the document already is. */
    initial: {
      width: number;
      height: number;
      length: number;
      format: SchematicFormat;
      version: string;
    };
    /** The file name Save As will suggest, without an extension. */
    suggestedName?: string;
    onclose: () => void;
    onconfirm: (choice: {
      width: number;
      height: number;
      length: number;
      format: SchematicFormat;
      version: string;
    }) => void;
  }

  const { open, mode, initial, suggestedName, onclose, onconfirm }: Props = $props();

  let width = $state(16);
  let height = $state(16);
  let length = $state(16);
  let format = $state<SchematicFormat>("sponge3");
  let version = $state("");

  /**
   * Re-seeded every time it opens, not once at construction.
   *
   * The component stays mounted between openings, so fields set from `initial`
   * at construction would show the first document's size forever. Guarded on
   * `open` rather than on `initial` because a parent that rebuilds the object
   * would otherwise reset a half-typed number under the cursor.
   */
  $effect(() => {
    if (!open) return;
    width = initial.width;
    height = initial.height;
    length = initial.length;
    format = initial.format;
    version = initial.version;
  });

  /** Sizes are typed, so they arrive as anything. */
  const clamp = (value: number) => Math.max(1, Math.min(2048, Math.trunc(value) || 1));

  const volume = $derived(clamp(width) * clamp(height) * clamp(length));

  /**
   * The version decides which containers are on offer, not the other way round.
   *
   * That is the direction the fact runs: you are building *for* a Minecraft
   * version, and Sponge's palette is flattened block names that did not exist
   * before 1.13. A format picker that let you choose Sponge for 1.8.8 would be
   * offering a file nothing can read.
   */
  const formats = $derived(formatsFor(version));

  /**
   * Why the format the user had is no longer available, if it went away.
   *
   * Shown rather than silently corrected. The select below snaps to something
   * valid either way — leaving it on an impossible value would be worse — but a
   * control that changes under the cursor with no explanation is how someone
   * concludes the app is broken.
   */
  const refused = $derived(refusalFor(format, version));

  $effect(() => {
    if (formats.length > 0 && !formats.includes(format)) format = formats[0];
  });

  function confirm(): void {
    onconfirm({
      width: clamp(width),
      height: clamp(height),
      length: clamp(length),
      format,
      version,
    });
  }

  function onKeydown(event: KeyboardEvent): void {
    // Enter confirms from anywhere but a number field being edited, where it
    // would fire before the value is committed on some platforms -- and a
    // button, where Enter is that button's own: Cancel must not create.
    if (event.key === "Enter" && !(event.target as HTMLElement)?.matches?.("input[type=number], button")) {
      event.preventDefault();
      confirm();
    }
  }
</script>

<Modal
  {open}
  title={mode === "new" ? t("doc.newTitle") : t("doc.saveAsTitle")}
  {onclose}
  width={420}
  onkeydown={onKeydown}
>
  {#if mode === "new"}
    <fieldset>
      <legend>{t("doc.size")}</legend>
      <div class="sizes">
        <label>
          <span>{t("doc.width")}</span>
          <input type="number" min="1" max="2048" bind:value={width} />
        </label>
        <label>
          <span>{t("doc.height")}</span>
          <input type="number" min="1" max="2048" bind:value={height} />
        </label>
        <label>
          <span>{t("doc.length")}</span>
          <input type="number" min="1" max="2048" bind:value={length} />
        </label>
      </div>
      <p class="hint">{tn("count.blocks", volume)}</p>
    </fieldset>
  {:else}
    <p class="callout fact">
      {t("doc.savingSize", { size: `${initial.width}×${initial.height}×${initial.length}` })}
    </p>
  {/if}

  <!--
    Version above format, in the order the decision is actually made: which
    Minecraft you are building for, and only then which of the containers
    that version can live in.
  -->
  <label class="pair">
    <span>{t("doc.version")}</span>
    <select bind:value={version}>
      {#each MC_VERSIONS as option (option.name)}
        <option value={option.name}>
          {option.label}{option.era === "legacy" ? ` — ${t("doc.legacyEra")}` : ""}
        </option>
      {/each}
    </select>
  </label>

  <label class="pair">
    <span>{t("doc.format")}</span>
    <select bind:value={format}>
      {#each formats as option (option)}
        <option value={option}>{SCHEMATIC_FORMAT_LABEL[option]}</option>
      {/each}
    </select>
  </label>

  {#if refused}
    <p class="callout warn">{refused}</p>
  {:else if mcVersion(version)?.era === "legacy"}
    <p class="hint">{t("doc.legacyNote")}</p>
  {/if}

  {#if mode === "save-as" && suggestedName}
    <p class="hint">
      {t("doc.willBeNamed", { name: `${suggestedName}.${schematicExtension(format)}` })}
    </p>
  {/if}

  {#snippet footer()}
    <button onclick={onclose}>{t("common.cancel")}</button>
    <button class="primary" onclick={confirm}>
      {mode === "new" ? t("doc.create") : t("doc.chooseLocation")}
    </button>
  {/snippet}
</Modal>

<style>
  fieldset,
  .fact {
    margin-bottom: var(--space-4);
  }

  .sizes {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-3);
  }

  .sizes label {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
  }

  /* The label beside its control. */
  .pair {
    display: grid;
    grid-template-columns: 96px minmax(0, 1fr);
    align-items: center;
    gap: var(--space-3);
    margin: 0 0 var(--space-3);
  }

  .pair ~ p {
    margin-top: var(--space-3);
  }
</style>
