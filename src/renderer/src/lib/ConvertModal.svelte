<script lang="ts">
  /**
   * One file into another, without opening either.
   *
   * The only panel here that is **not** about the open document, which is why
   * it is the one whose button is never disabled: converting a `.litematic`
   * somebody sent you is a thing to do before there is anything open at all.
   *
   * It does not preview. The costs a conversion can have -- a block MCEdit
   * cannot spell, an anchor Litematica has nowhere to keep, entities a
   * `.mcfunction` cannot summon -- are all facts about the *source*, and this
   * has not read it. Main reports them afterwards, by name, and nothing is
   * overwritten in the meantime, so the honest order is convert-then-say rather
   * than a promise made from a filename.
   */
  import { FILE_KINDS, FILE_KIND_LABEL, type FileKind } from "../../../shared/ipc.js";
  import { MC_VERSION_NAMES, mcVersion, refusalFor } from "../../../shared/mc_versions.js";
  import type { SchematicFormat } from "../../../shared/schematic.js";
  import { t } from "./i18n.svelte.js";
  import Modal from "./Modal.svelte";

  interface Props {
    open: boolean;
    busy: boolean;
    /** Main's wording for whatever it refused, shown inside the modal. */
    error: string;
    /** What the last run wrote, so the panel can say it landed. */
    report: string;
    onpicksource: () => void;
    onpicktarget: (format: FileKind) => void;
    source: string;
    target: string;
    onconvert: (request: {
      source: string;
      target: string;
      format: FileKind;
      version?: string;
    }) => void;
    onclose: () => void;
  }

  const {
    open,
    busy,
    error,
    report,
    onpicksource,
    onpicktarget,
    source,
    target,
    onconvert,
    onclose,
  }: Props = $props();

  let format = $state<FileKind>("sponge3");
  /** Empty means "whatever the source says", which is what a conversion wants. */
  let version = $state<string>("");

  /**
   * A container cannot hold every version, and the rule is not this panel's.
   *
   * `formatsFor` is the same function the New and Save As dialogs ask, so a
   * `.litematic` is refused for 1.13 here for the reason it is refused there:
   * Litematica converts the palette of anything older than 1.13.2. A
   * `.mcfunction` is not in that table at all -- it is not a container -- and
   * carries no version tag, so it accepts any of them.
   */
  const refusal = $derived.by(() => {
    if (version === "" || format === "mcfunction") return null;
    return refusalFor(format as SchematicFormat, version);
  });

  const ready = $derived(source !== "" && target !== "" && refusal === null && !busy);

  function apply(): void {
    if (!ready) return;
    onconvert({
      source,
      target,
      format,
      ...(version === "" ? {} : { version }),
    });
  }

</script>

<Modal {open} title={t("convert.title")} {onclose} width={520}>
  <p class="hint lead">{t("convert.hint")}</p>

  <fieldset>
    <legend>{t("convert.from")}</legend>
    <div class="pick">
      <input type="text" readonly value={source} placeholder={t("convert.nothing")} aria-label={t("convert.from")} />
      <button onclick={onpicksource} disabled={busy}>{t("convert.browse")}</button>
    </div>
  </fieldset>

  <fieldset>
    <legend>{t("convert.to")}</legend>
    <div class="choices">
      <label>
        <span>{t("convert.format")}</span>
        <select bind:value={format} disabled={busy}>
          {#each FILE_KINDS as option (option)}
            <option value={option}>{FILE_KIND_LABEL[option]}</option>
          {/each}
        </select>
      </label>

      <!--
        Blank first, and it is the default: a conversion keeps whatever the
        source said unless somebody means to change it. Stamping the newest
        version on a file cut from 1.16 would be a claim nobody made.
      -->
      <label>
        <span>{t("convert.version")}</span>
        <select bind:value={version} disabled={busy || format === "mcfunction"}>
          <option value="">{t("convert.keepVersion")}</option>
          {#each MC_VERSION_NAMES as name (name)}
            <option value={name}>{mcVersion(name)?.label ?? name}</option>
          {/each}
        </select>
      </label>
    </div>

    <div class="pick">
      <input type="text" readonly value={target} placeholder={t("convert.nothing")} aria-label={t("convert.to")} />
      <button onclick={() => onpicktarget(format)} disabled={busy}>
        {t("convert.browse")}
      </button>
    </div>

    {#if refusal !== null}
      <p class="callout warn refusal">{refusal}</p>
    {/if}
  </fieldset>

  {#if error !== ""}
    <p class="callout bad" role="alert">{error}</p>
  {/if}
  {#if report !== ""}
    <p class="callout" role="status">{report}</p>
  {/if}

  {#snippet footer()}
    <button onclick={onclose}>{t("common.close")}</button>
    <button class="primary" disabled={!ready} onclick={apply}>{t("convert.apply")}</button>
  {/snippet}
</Modal>

<style>
  .lead {
    margin: 0 0 var(--space-4);
    line-height: 1.5;
  }

  fieldset {
    margin-bottom: var(--space-4);
  }

  .pick {
    display: flex;
    gap: var(--space-3);
  }

  .pick input {
    flex: 1 1 auto;
    min-width: 0;
  }

  .choices {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }

  .choices label {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
  }

  .refusal {
    margin-top: var(--space-4);
  }

  .callout + .callout {
    margin-top: var(--space-3);
  }
</style>
