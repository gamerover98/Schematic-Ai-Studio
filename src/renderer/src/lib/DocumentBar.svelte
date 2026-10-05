<script lang="ts">
  /**
   * Which schematic this is, and its settings: the leading third of the bar.
   *
   * It lives in the application bar because that is where it is always visible.
   * Before this, the file's name and -- the one that matters -- whether it had
   * unsaved changes were shown *only* inside the sidebar's second tab: the app
   * could tell you that you had unpaid work, but only if you were looking away
   * from the thing you were building.
   *
   * The app's own name gave up the spot and moved to the window title, which is
   * where a desktop app puts it and where it can carry the file name too.
   *
   * The size, the block count, the container and the version moved on to the
   * status bar, where a narrow window no longer cuts them off first, and Undo,
   * Redo and History to the trailing third: the bar reads as the document on
   * the left, how you look at it in the middle, and what you can do about it
   * on the right.
   */
  import type { DocumentState } from "../../../shared/ipc.js";
  import DocumentMenu, { type DocumentMenuItem } from "./DocumentMenu.svelte";
  import { t } from "./i18n.svelte.js";

  interface Props {
    /** `doc`, not `state`: a prop of that name breaks every rune in the file. */
    doc: DocumentState | null;
    busy: boolean;
    /** One of the schematic's own settings, from the Document menu. */
    onsetting: (item: DocumentMenuItem) => void;
    /**
     * Brings the start screen back after it has been dismissed.
     *
     * It blocks the window now, so it has to be dismissable — the generator is
     * reached by typing into the chat with nothing open, and a screen covering
     * the chat that could not be put away would delete the path it advertises.
     * This is the way back, and `startvisible` is what stops it offering to
     * summon something already on screen -- or something that cannot come back
     * yet, because the recovery question is up in its place.
     */
    onstart: () => void;
    startvisible: boolean;
  }

  const { doc, busy, onsetting, onstart, startvisible }: Props = $props();
</script>

{#if doc === null}
  <h1>{t("app.title")}</h1>
  {#if !startvisible}
    <button class="start-again" onclick={onstart} title={t("start.reopenHint")}>
      {t("start.reopen")}
    </button>
  {/if}
{:else}
  <div class="identity" title={doc.filePath ?? t("doc.notSaved")}>
    <strong class:dirty={doc.dirty}>
      {doc.fileName ?? t("doc.untitled")}{doc.dirty ? " •" : ""}
    </strong>
  </div>
  <DocumentMenu disabled={busy} onpick={onsetting} />
{/if}

<style>
  .start-again {
    flex: none;
    font-size: var(--text-sm);
  }

  h1 {
    flex: 0 1 auto;
    min-width: 0;
    margin: 0;
    font-family: var(--font-pixel);
    font-size: var(--text-md);
    font-weight: 500;
    white-space: nowrap;
  }

  /* The name keeps what width there is and gives way only to the menu beside
     it: which file this is survives a narrow window. */
  .identity {
    display: flex;
    align-items: baseline;
    flex: 0 1 auto;
    min-width: 0;
  }

  strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-pixel);
    font-size: var(--text-md);
    font-weight: 500;
  }

  /* The marker is a colour as well as a bullet: a lone `•` beside a file name
     reads as punctuation until you already know what it means. */
  strong.dirty {
    color: var(--accent);
  }
</style>
