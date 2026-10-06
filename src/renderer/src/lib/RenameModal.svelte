<script lang="ts">
  /**
   * A new name for the open schematic's file.
   *
   * Here rather than in the file manager, because the chats with the AI, the
   * version history and the hotbar are kept under the file's path: renamed
   * outside the app, the schematic came back with none of them. Main renames
   * the file and takes all three with it.
   *
   * The name only: the folder stays, and the extension is the format's, which
   * is why it is shown beside the field rather than in it. Main refuses a
   * name that cannot be a file or is already taken, and the sentence comes
   * back here because the app's banner is behind the scrim.
   */
  import { tick } from "svelte";
  import { t } from "./i18n.svelte.js";
  import Modal from "./Modal.svelte";

  interface Props {
    open: boolean;
    /** The file's name as it is, extension included. */
    fileName: string;
    busy: boolean;
    error: string;
    onrename: (name: string) => void;
    onclose: () => void;
  }

  const { open, fileName, busy, error, onrename, onclose }: Props = $props();

  const dot = $derived(fileName.lastIndexOf("."));
  const extension = $derived(dot > 0 ? fileName.slice(dot) : "");
  const current = $derived(dot > 0 ? fileName.slice(0, dot) : fileName);

  let name = $state("");
  let field = $state<HTMLInputElement | null>(null);

  // Re-seeded on every opening: the component stays mounted between them.
  $effect(() => {
    if (!open) return;
    name = current;
    void tick().then(() => field?.select());
  });

  const changed = $derived(name.trim() !== "" && name.trim() !== current);

  function submit(): void {
    if (changed && !busy) onrename(name.trim());
  }
</script>

<Modal {open} title={t("rename.title")} {onclose} width={420}>
  <label class="field" for="rename-name">{t("rename.label")}</label>
  <div class="row">
    <input
      id="rename-name"
      bind:this={field}
      bind:value={name}
      disabled={busy}
      spellcheck="false"
      onkeydown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          submit();
        }
      }}
    />
    {#if extension}<span class="extension">{extension}</span>{/if}
  </div>
  <p class="hint">{t("rename.hint")}</p>

  {#if error}
    <p class="callout bad" role="alert">{error}</p>
  {/if}

  {#snippet footer()}
    <button onclick={onclose} disabled={busy}>{t("common.cancel")}</button>
    <button class="primary" onclick={submit} disabled={busy || !changed}>{t("rename.apply")}</button>
  {/snippet}
</Modal>

<style>
  .field {
    display: block;
    margin-bottom: var(--space-2);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .row input {
    flex: 1;
    min-width: 0;
  }

  .extension {
    color: var(--text-dim);
  }

  .row ~ p {
    margin-top: var(--space-3);
  }
</style>
