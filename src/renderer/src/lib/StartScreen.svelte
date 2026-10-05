<script lang="ts">
  /**
   * What the viewport says when nothing is open.
   *
   * It used to say nothing. The canvas mounted, drew its floor grid, and every
   * gesture landed on a document that was not there — the build grid is gated
   * on `documentSize`, so a click was not refused, it simply had no target and
   * nothing on screen explained why. The two things that would have fixed it,
   * New and Open, were one click away inside a sidebar tab that is not the
   * default one.
   *
   * Here rather than inside `Viewer.svelte`, and that is not arbitrary: the
   * viewer receives geometry and has no business knowing what a recent document
   * is. It is a sibling laid over the same canvas, and `Screen.svelte` is how it
   * covers the window.
   *
   * **Four ways in, as four tiles**, each with a line saying what it takes:
   * New, Open, Convert -- and the chat. With nothing open, a message typed into
   * the chat goes to the *generator* and builds the schematic the rest of the
   * conversation then edits, a real capability that is completely invisible
   * until someone tries it by accident. It was a sentence at the foot of this
   * card asking the reader to close it and go and type; it is a tile now, and
   * pressing it does both.
   *
   * It blocks the window while it is up, which it did not: it was a card over a
   * live viewport, with the camera buttons, the gear and the whole sidebar
   * still taking clicks on a document that was not there. Blocking is why it
   * also has to be *dismissable* — the generator is reached by typing into the
   * chat with nothing open, so a screen that covered the chat and could not be
   * put away would not be polish, it would delete the feature it advertises.
   */
  import type { Artifact, RecentDocument } from "../../../shared/ipc.js";
  import logo from "../assets/logo.png";
  import { ageLabel } from "./age_label.js";
  import { t } from "./i18n.svelte.js";
  import Icon from "./Icon.svelte";
  import Screen from "./Screen.svelte";

  interface Props {
    /** Dismissing it reveals the app in the state it has always had. */
    ondismiss: () => void;
    recent: readonly RecentDocument[];
    /**
     * Every file the generator has ever written, newest first.
     *
     * It had a fieldset of its own in the sidebar, which is a strange place for
     * a list whose only two verbs are "open this" and "show me where it is":
     * those are the verbs of this screen. And an `.mcfunction` is never opened,
     * so this is the only thing in the app that admits it exists.
     */
    artifacts: readonly Artifact[];
    busy: boolean;
    onnew: () => void;
    onopen: () => void;
    /**
     * Converting a file someone sent you is a thing to do before there is
     * anything open at all, and this is what the window shows then.
     */
    onconvert: () => void;
    /** Put this away and the caret in the chat, where a message builds a schematic. */
    ondescribe: () => void;
    onopenrecent: (filePath: string) => void;
    onopenartifact: (artifact: Artifact) => void;
    onrevealartifact: (artifact: Artifact) => void;
    /**
     * The pre-1.0.0 profile, when it holds keys this one does not.
     *
     * Here because this is what launching the app looks like with nothing
     * open, and because the alternative was what happened: the app knew the
     * keys were next door and said nothing, so generation stopped and what
     * surfaced was the provider calling the key invalid. Not a native dialog
     * -- blocking the launch over something recoverable by pasting a key
     * again would be out of proportion.
     */
    legacyProfile?: { path: string; providers: string[] } | null;
    onrevealpath: (target: string) => void;
  }

  const {
    ondismiss,
    recent,
    artifacts,
    busy,
    onnew,
    onopen,
    onconvert,
    ondescribe,
    onopenrecent,
    onopenartifact,
    onrevealartifact,
    legacyProfile = null,
    onrevealpath,
  }: Props = $props();

  /** Six is what fits without the card starting to scroll. */
  const shown = $derived(recent.slice(0, 6));

  /*
   * Fewer, and only the ones the recents do not already carry.
   *
   * A generated `.schem` is opened the moment it is made, so it is in the
   * recents by the time anyone sees this screen -- listing it twice would make
   * the card longer without making anything findable.
   */
  const generated = $derived(
    artifacts
      .filter((artifact) => !recent.some((entry) => entry.filePath === artifact.path))
      .slice(0, 4),
  );

  function fileName(filePath: string): string {
    return filePath.split(/[\\/]/).pop() ?? filePath;
  }

  /** The folder, so two builds with the same name are told apart at a glance. */
  function folder(filePath: string): string {
    const parts = filePath.split(/[\\/]/).filter((part) => part !== "");
    return parts.length >= 2 ? parts[parts.length - 2] : "";
  }
</script>

<!--
  Escape and a backdrop click put it away, like every other modal here; unlike
  them it is what the window shows when there is nothing to show, so it comes
  back from the document bar and from Ctrl+K.
-->
<Screen title={t("app.title")} lead={t("start.lead")} mark={logo} {ondismiss} width={560}>
  {#if legacyProfile}
    <!-- A warning that is still prose: the button in it is the one useful verb. -->
    <p class="callout warn legacy">
      {t("start.legacyProfile", { providers: legacyProfile.providers.join(", ") })}
      <button class="link" onclick={() => onrevealpath(legacyProfile?.path ?? "")}>
        {t("provider.legacyProfileReveal")}
      </button>
    </p>
  {/if}

  <!--
    The ways in, as the game's own menu has them: slabs to press, the first one
    lit. Each icon sits in a slot, as a block does everywhere else here.
  -->
  <div class="actions">
    <button class="action primary" onclick={onnew} disabled={busy}>
      <span class="slot"><Icon name="plus" size={20} /></span>
      <span class="words"><span class="what">{t("doc.new")}</span><span class="why">{t("start.newHint")}</span></span>
    </button>
    <button class="action" onclick={onopen} disabled={busy}>
      <span class="slot"><Icon name="folder" size={20} /></span>
      <span class="words"><span class="what">{t("doc.open")}</span><span class="why">{t("start.openHint")}</span></span>
    </button>
    <!-- Never disabled: converting needs nothing open, and nothing to wait for. -->
    <button class="action" onclick={onconvert}>
      <span class="slot"><Icon name="swapHorizontal" size={20} /></span>
      <span class="words"
        ><span class="what">{t("start.convert")}</span><span class="why">{t("start.convertHint")}</span></span
      >
    </button>
    <button class="action" onclick={ondescribe}>
      <span class="slot"><Icon name="chat" size={20} /></span>
      <span class="words"
        ><span class="what">{t("start.describe")}</span><span class="why">{t("start.describeHint")}</span></span
      >
    </button>
  </div>

  {#if shown.length > 0}
    <h3 class="list-title">{t("doc.recent")}</h3>
    <ul class="list sunken">
      {#each shown as entry (entry.filePath)}
        <li>
          <button
            class="entry"
            onclick={() => onopenrecent(entry.filePath)}
            disabled={busy}
            title={entry.filePath}
          >
            <span class="name">{fileName(entry.filePath)}</span>
            <span class="where">{folder(entry.filePath)}</span>
            <span class="when">{ageLabel(entry.openedAt)}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if generated.length > 0}
    <h3 class="list-title">{t("start.generated")}</h3>
    <ul class="list sunken">
      {#each generated as artifact (artifact.path)}
        <li class="generated">
          <!--
            Only a `.schem` opens. An `.mcfunction` is a list of commands and
            nothing in this app reads one back, so its row reveals instead --
            a button whose only outcome is an error would be worse than one
            that does the single thing the file supports, and a disabled row
            worse still, since nothing on it would say why.
          -->
          <button
            class="entry"
            onclick={() =>
              artifact.type === "schem" ? onopenartifact(artifact) : onrevealartifact(artifact)}
            disabled={busy}
            title={artifact.path}
          >
            <span class="name">{artifact.name}</span>
            <span class="where">.{artifact.type}</span>
            <span class="when">{ageLabel(Date.parse(artifact.createdAt))}</span>
          </button>
          <button
            class="icon"
            onclick={() => onrevealartifact(artifact)}
            title={t("start.reveal")}
            aria-label={t("start.reveal")}><Icon name="folder" size={16} /></button
          >
        </li>
      {/each}
    </ul>
  {/if}

  {#snippet footer()}
    <p class="drop">{t("start.dropHint")}</p>
  {/snippet}
</Screen>

<style>
  .legacy {
    margin-bottom: var(--space-4);
  }

  /* Two by two, one above the other when the window is narrow. */
  .actions {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--space-3);
  }

  /* A tile: the icon's slot, then what it is and what it takes. */
  .action {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: var(--space-4);
    min-height: calc(2 * var(--control-h));
    padding: var(--space-3);
    text-align: left;
  }

  .slot {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border: var(--bevel) solid;
    border-color: var(--bevel-lo) var(--bevel-hi) var(--bevel-hi) var(--bevel-lo);
    background: var(--slot);
    color: var(--slot-text);
  }

  .words {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .what {
    font-weight: 700;
  }

  .why {
    color: var(--text-dim);
    font-size: var(--text-sm);
    font-weight: 400;
    line-height: 1.35;
  }

  /* On the lit tile both lines are the accent's own text colour. */
  .action.primary .why {
    color: inherit;
  }

  .list-title {
    margin: var(--space-5) 0 var(--space-2);
  }

  .list {
    list-style: none;
    margin: 0;
    padding: var(--space-1);
  }

  /*
   * A row draws itself on the well, so it says so under the pointer too. It
   * is picked out as a world is in the game's list: an outline, not a fill.
   */
  .entry {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-width: 0;
    min-height: var(--control-h);
    padding: 0 var(--space-3);
    border: var(--bevel) solid transparent;
    background: none;
    text-align: left;
  }

  .entry:hover:not(:disabled) {
    border-color: var(--field-edge);
    background: none;
  }

  .entry:focus-visible {
    outline: none;
    border-color: var(--accent);
  }

  .name {
    flex: 0 1 auto;
    max-width: 60%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 700;
  }

  /* The folder gives way first: it is the disambiguator, not the identity. */
  .where {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-dim);
    font-size: var(--text-sm);
  }

  .when {
    flex: none;
    color: var(--text-dim);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }

  .generated {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .generated .entry {
    flex: 1 1 auto;
  }

  .drop {
    flex: 1 1 auto;
    margin: 0;
    color: var(--text-dim);
    font-size: var(--text-sm);
  }
</style>
