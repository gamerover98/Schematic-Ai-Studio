<script lang="ts">
  /**
   * The conversation, and the whole height of the panel.
   *
   * The previous version was a 320px-tall box wedged between five other
   * fieldsets in a scrolling column: the log scrolled inside a scroller, and
   * the prompt drifted off-screen as the page grew. Here the log is the only
   * thing that scrolls and the composer is pinned beneath it, which is the
   * arrangement that makes a chat usable and the one this was asked to match.
   *
   * Tool calls still arrive as they happen rather than all at the end, because
   * a request can take half a minute and a panel that shows nothing for that
   * long is indistinguishable from one that has hung. They fold into a
   * disclosure once the turn lands, though: while it is running they are the
   * only evidence of progress, and afterwards they are the least interesting
   * part of the answer.
   *
   * ## The right-hand docked panel, and it looks like the left-hand one
   *
   * The same strip across the top, with the conversation standing on it as
   * the panel's one tab -- the tools' panel has three -- so the two edges of
   * the window read as one piece of furniture. Each turn is a name in the
   * pixel face behind a square of its colour, the way the game prints a
   * player's name in chat; what the model did is a well sunk into the slab;
   * what changed is the blocks themselves, in slots, with the count beside
   * each.
   */
  import type {
    ChatEntry,
    ConversationSummary,
    ProgressEvent,
    RegionSpec,
    TraceItem,
  } from "../../../shared/ipc.js";
  import type { KeyStorageStatus, Settings } from "../../../shared/settings.js";
  import { blockIcons, iconsReady, requestBlockIcons } from "./block_icons.svelte.js";
  import ChatComposer from "./ChatComposer.svelte";
  import ConversationPicker from "./ConversationPicker.svelte";
  import { formatNumber, t, tn } from "./i18n.svelte.js";
  import Icon from "./Icon.svelte";
  import { blockLabel, isAir } from "./inventory.js";
  import Markdown from "./Markdown.svelte";
  import TraceView from "./TraceView.svelte";

  interface Props {
    entries: ChatEntry[];
    /** Tool calls for the turn in flight, cleared when it lands. */
    /**
     * What the turn in flight is doing, as main reports it.
     *
     * The old live view was a list of tool summaries, which meant a model that
     * thought for thirty seconds before its first tool call showed a pulsing
     * dot and nothing else. This carries the thinking and the request too.
     */
    live: TraceItem[];
    /**
     * How far a *build* has got, when the message in flight is building.
     *
     * A generation's only feedback used to be a bar in the Structure fieldset,
     * in a sidebar tab -- which is to say, not on screen, since asking for a
     * build is something you do here. `null` for an agent turn, which reports
     * itself through the trace instead.
     */
    progress: ProgressEvent | null;
    selection: RegionSpec | null;
    /** How many areas are selected beside `selection`; see `ChatComposer`. */
    otherAreas?: number;
    /** Exchanges the agent is carrying into the next question. */
    remembered: number;
    /**
     * Index into `entries` where the agent's memory begins.
     *
     * Computed by main, not here. "The last N user turns" is the obvious rule
     * and it is wrong: a run that failed leaves its entry in the log without
     * ever entering the model's memory, so counting from this side drifts by
     * one for every error above it. `0` means everything is remembered.
     */
    rememberedFrom: number;
    /**
     * Whether a schematic is open.
     *
     * Not a gate any more — it decides what a message *means*. With something
     * open the agent edits it; with nothing open the prompt describes a
     * schematic to build, and the generator makes one.
     */
    hasDocument: boolean;
    /**
     * The reference image and the format a *build* would use. Passed straight
     * through to the composer, which is the only place they are shown -- and
     * only with nothing open, which is when a message builds rather than edits.
     */
    imageName: string | null;
    acceptsImages: boolean;
    imageHint: string;
    /** Whether the chosen provider has no key and so cannot answer at all. */
    blockedOnKey: boolean;
    onpickimage: () => void;
    onclearimage: () => void;
    busy: boolean;
    /**
     * Whether there is a run to stop. Passed straight down: the composer is
     * where it decides between Send and Stop, and `busy` is a different
     * question -- see the note on the prop there.
     */
    running: boolean;
    settings: Settings;
    keyStatus: KeyStorageStatus | null;
    /** Held by `App.svelte`, which is where the conversation's state lives. */
    draft: string;
    ondraftchange: (draft: string) => void;
    /**
     * The undo entry currently on top of the stack. A turn offers "Undo this"
     * only while it matches its own — once anything else has been done, that
     * button would revert the wrong thing.
     */
    undoLabel: string | null;
    /** Its id, which is what the match is actually made on. */
    undoTransactionId: number | null;
    /** Every conversation about this schematic, newest first. */
    conversations: ConversationSummary[];
    activeConversationId: string;
    onask: (prompt: string) => void;
    /** Starts another conversation; the current one stays in the list. */
    onforget: () => void;
    onrefreshconversations: () => void;
    /** Put the schematic back to how it was before the turn at this index. */
    onrestore: (entryIndex: number) => void;
    onopenconversation: (id: string) => void;
    ondeleteconversation: (id: string) => void;
    onstop: () => void;
    onundo: () => void;
    onsettingschange: (patch: Partial<Settings>) => void;
    onopensettings: () => void;
    /** Puts the panel away; the bar's toggle and Ctrl+B bring it back. */
    oncollapse: () => void;
    /** Bumped to put the caret in the composer; see `ChatComposer`. */
    focusRequest?: number;
  }

  const {
    entries,
    live,
    progress,
    selection,
    otherAreas = 0,
    remembered,
    rememberedFrom,
    hasDocument,
    imageName,
    acceptsImages,
    imageHint,
    blockedOnKey,
    onpickimage,
    onclearimage,
    busy,
    running,
    settings,
    keyStatus,
    draft,
    ondraftchange,
    undoLabel,
    undoTransactionId,
    conversations,
    activeConversationId,
    onask,
    onforget,
    onrefreshconversations,
    onrestore,
    onopenconversation,
    ondeleteconversation,
    onstop,
    onundo,
    onsettingschange,
    onopensettings,
    oncollapse,
    focusRequest = 0,
  }: Props = $props();

  /** The few tallies that matter, and how many were left out. */
  const SHOWN = 4;

  /**
   * Starters for each of the two things a first message can be.
   *
   * With nothing open they describe a build, because that is what a prompt
   * does then; with a document they describe an edit.
   */
  const EDIT_EXAMPLES = ["chat.example1", "chat.example2", "chat.example3"];
  const BUILD_EXAMPLES = ["chat.build1", "chat.build2", "chat.build3"];
  const examples = $derived(hasDocument ? EDIT_EXAMPLES : BUILD_EXAMPLES);

  let log = $state<HTMLDivElement | null>(null);
  /** Which agent turns have had their tool list opened, by index. */
  let expanded = $state<Record<number, boolean>>({});

  /**
   * The blocks the receipts name, for their slots.
   *
   * Only the tallies that are shown, and never air: there is no picture of
   * air, and the slot of a block that was emptied out stays empty, which is
   * the honest picture of it.
   */
  const receiptBlocks = $derived(
    entries.flatMap((entry) =>
      entry.summary && entry.summary.changed > 0
        ? [...entry.summary.removed.slice(0, SHOWN), ...entry.summary.added.slice(0, SHOWN)]
            .map((tally) => tally.block)
            .filter((block) => !isAir(block))
        : [],
    ),
  );
  const icons = $derived(blockIcons());

  $effect(() => {
    // Read so an atlas that moved asks for every icon again.
    void iconsReady();
    requestBlockIcons(receiptBlocks);
  });

  /**
   * Follows the conversation down.
   *
   * Only when the user is already near the bottom: yanking the view back while
   * they are reading something further up is worse than not following at all.
   */
  $effect(() => {
    void entries;
    void live;
    const element = log;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (distance < 160) {
      queueMicrotask(() => element.scrollTo({ top: element.scrollHeight }));
    }
  });

  function who(role: ChatEntry["role"]): string {
    if (role === "user") return t("chat.you");
    if (role === "error") return t("chat.failed");
    if (role === "note") return t("chat.stopped");
    return t("chat.ai");
  }
</script>

<!--
  The panel's `aria-label` is what a screen reader announces on the way in;
  the conversation's own name is the tab.
-->
<section class="chat" aria-label={t("chat.label")}>
  <!--
    The header names the conversation you are in rather than the panel you are
    looking at: "Chat" was true and told you nothing, and with several
    conversations per schematic the useful fact is which one this is.
  -->
  <header class="panel-head">
    <ConversationPicker
      {conversations}
      activeId={activeConversationId}
      {busy}
      onrefresh={onrefreshconversations}
      onopen={onopenconversation}
      ondelete={ondeleteconversation}
    />
    <span class="spacer"></span>
    <button
      class="icon"
      onclick={onforget}
      disabled={busy || (entries.length === 0 && remembered === 0)}
      title={t("chat.newChatHint")}
      aria-label={t("chat.newChat")}><Icon name="plus" /></button
    >
    <!-- The mirror of the tools' chevron, pointing at the edge it goes to. -->
    <button
      class="icon"
      onclick={oncollapse}
      title={t("sidebar.hideShortcut")}
      aria-label={t("sidebar.hide")}><Icon name="chevronRight" /></button
    >
  </header>

  <!--
  `selectable` because a model's answer is read and copied. The window's shell
  is `user-select: none` so that Ctrl+A in flight stops highlighting the whole
  app; `app.css` carries the reasoning.
-->
<div class="log selectable" bind:this={log}>
    {#if entries.length === 0 && live.length === 0}
      <div class="empty">
        <p>{hasDocument ? t("chat.emptyTitle") : t("chat.emptyBuildTitle")}</p>
        <ul class="examples">
          {#each examples as key (key)}
            <li><button class="example" onclick={() => onask(t(key))}>{t(key)}</button></li>
          {/each}
        </ul>
      </div>
    {/if}

    {#each entries as entry, index (index)}
      {#if index === rememberedFrom && rememberedFrom > 0}
        <!--
          Everything above this line is readable and not remembered. Without it
          the agent looks as though it has forgotten something plainly visible
          three messages up -- which it has, and which nothing said.
        -->
        <div class="boundary" role="separator">
          <span>{t("chat.memoryStarts")}</span>
        </div>
      {/if}
      <article class={`turn ${entry.role}`}>
        <div class="who">
          <span class="mark" aria-hidden="true"></span>
          <span class="name">{who(entry.role)}</span>
          <!--
            Wherever a snapshot is attached, whatever kind of entry carries it:
            a user turn carries the state before it was asked, and the note left
            by an earlier restore carries the state that restore stepped away
            from. One rule rather than two, and the second is what makes going
            back reversible.

            On the name's line, so it takes no room of its own: hidden until
            the turn is pointed at, it used to leave a blank line under every
            message that had one.
          -->
          {#if entry.checkpoint}
            <button
              class="icon restore"
              disabled={busy}
              onclick={() => onrestore(index)}
              title={t("chat.restore")}
              aria-label={t("chat.restore")}><Icon name="history" size={14} /></button
            >
          {/if}
        </div>

        <!--
          The trace when there is one, and the old summary list when there is
          not. Conversations written before traces existed still hold `steps`,
          and dropping them would blank the history of anyone who had been
          using the app -- which is why `CONVERSATION_FORMAT` did not have to
          change for this.
        -->
        {#if entry.trace && entry.trace.length > 0}
          <TraceView items={entry.trace} />
        {:else if entry.steps && entry.steps.length > 0}
          <button
            class="tools"
            aria-expanded={expanded[index] === true}
            onclick={() => (expanded = { ...expanded, [index]: !expanded[index] })}
          >
            <Icon name={expanded[index] ? "chevronDown" : "chevronRight"} size={10} weight={2.6} />
            {tn("chat.toolsUsed", entry.steps.length)}
          </button>
          {#if expanded[index]}
            <ul class="steps sunken">
              {#each entry.steps as step, stepIndex (stepIndex)}
                <li>{step.summary}</li>
              {/each}
            </ul>
          {/if}
        {/if}

        <!--
          Only the agent's turns are markdown. What the user typed is shown
          back exactly as typed -- their asterisks and their
          `minecraft:oak_log` survive -- and an error message is main's own
          wording, which arrives already phrased and is not ours to reformat.
        -->
        {#if entry.role === "agent"}
          <Markdown source={entry.text} />
        {:else}
          <p class="text">{entry.text}</p>
        {/if}

        {#if entry.summary && entry.summary.changed > 0}
          <!--
            What came out and what went in, as the blocks themselves: a slot
            with the block in it and the count beside it, read the way the
            materials list is. The id is the hover, for whoever has to type it.
          -->
          <ul class="receipt">
            {#each entry.summary.removed.slice(0, SHOWN) as tally (tally.block)}
              <li class="removed" title={tally.block}>
                <span class="slot">
                  {#if icons.get(tally.block)}<img src={icons.get(tally.block)} alt="" />{/if}
                </span>
                <span class="count">−{formatNumber(tally.count)}</span>
                <span class="block">{blockLabel(tally.block)}</span>
              </li>
            {/each}
            {#if entry.summary.removed.length > SHOWN}
              <li class="more">{t("chat.andMore", { count: entry.summary.removed.length - SHOWN })}</li>
            {/if}
            {#each entry.summary.added.slice(0, SHOWN) as tally (tally.block)}
              <li class="added" title={tally.block}>
                <span class="slot">
                  {#if icons.get(tally.block)}<img src={icons.get(tally.block)} alt="" />{/if}
                </span>
                <span class="count">+{formatNumber(tally.count)}</span>
                <span class="block">{blockLabel(tally.block)}</span>
              </li>
            {/each}
            {#if entry.summary.added.length > SHOWN}
              <li class="more">{t("chat.andMore", { count: entry.summary.added.length - SHOWN })}</li>
            {/if}
          </ul>
          <!--
            By id, not by label. The label comes from the prompt, so asking
            for "make it taller" twice produced two turns this could not tell
            apart, and the button offered to undo whichever was on top.
          -->
          {#if entry.undoTransactionId != null && entry.undoTransactionId === undoTransactionId}
            <button class="link undo" onclick={onundo} disabled={busy}>
              <Icon name="undo" size={14} />{t("chat.undoThis")}
            </button>
          {/if}
        {:else if entry.changed !== undefined && entry.changed > 0}
          <span class="hint">
            {tn("chat.blocksChanged", entry.changed)}
          </span>
        {/if}
      </article>
    {/each}

    {#if live.length > 0 || progress !== null}
      <article class="turn agent live" aria-busy="true">
        <div class="who">
          <span class="mark" aria-hidden="true"></span>
          <span class="name">{t("chat.ai")}</span>
        </div>
        {#if live.length > 0}
          <TraceView items={live} live />
        {/if}
        {#if progress !== null}
          <!-- The experience bar: a well, filled with emerald from the left. -->
          <div
            class="progress sunken"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress.fraction * 100)}
          >
            <div class="bar" style={`width: ${Math.round(progress.fraction * 100)}%`}></div>
          </div>
          <span class="hint">{progress.message}</span>
        {/if}
      </article>
    {/if}
  </div>

  <footer>
    <ChatComposer
      {selection}
      {otherAreas}
      {busy}
      {running}
      {hasDocument}
      {imageName}
      {acceptsImages}
      {imageHint}
      {blockedOnKey}
      {onpickimage}
      {onclearimage}
      {settings}
      {keyStatus}
      {draft}
      {ondraftchange}
      {onask}
      {onstop}
      {onsettingschange}
      {onopensettings}
      {focusRequest}
    />
    {#if remembered > 0}
      <p class="hint memory">{tn("chat.remembered", remembered)}</p>
    {/if}
  </footer>
</section>

<style>
  /*
   * `min-height: 0` on the log is what lets it scroll instead of stretching the
   * panel: a flex item's automatic minimum size is its content, so without it a
   * long conversation pushes the composer off the bottom of the window.
   */
  .chat {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .panel-head {
    flex: none;
  }

  .spacer {
    flex: 1;
  }

  .log {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-2) var(--space-4);
  }

  .empty {
    padding: var(--space-5) 0;
    color: var(--text-dim);
  }

  .empty p {
    margin: 0 0 var(--space-4);
  }

  .examples {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  /* Slabs, as every button is; long enough to wrap, so they wrap. */
  .example {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    text-align: left;
    color: var(--text-dim);
  }

  .example:hover:not(:disabled) {
    color: var(--text);
  }

  /* A line cut into the stone, light under dark, with the words in its gap. */
  .boundary {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin: var(--space-3) 0;
    color: var(--text-dim);
    font-size: var(--text-xs);
  }

  .boundary::before,
  .boundary::after {
    content: "";
    flex: 1;
    border-top: 1px solid var(--bevel-lo);
    border-bottom: 1px solid var(--bevel-hi);
  }

  .turn {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3) 0;
    min-width: 0;
  }

  /* Each exchange starts below a groove, as the boundary is cut. */
  .turn + .turn.user {
    border-top: 1px solid var(--bevel-lo);
    box-shadow: inset 0 1px 0 var(--bevel-hi);
    padding-top: var(--space-4);
  }

  /*
   * The name, in the pixel face behind a square of its colour. Gold is you,
   * emerald the model, redstone a failure; a run that was stopped is said in
   * the quiet colour, because nothing went wrong.
   */
  .who {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 24px;
    color: var(--accent-text);
  }

  .turn.user .who {
    color: var(--warn);
  }

  .turn.error .who {
    color: var(--danger);
  }

  .turn.note .who {
    color: var(--text-dim);
  }

  .mark {
    flex: none;
    width: 8px;
    height: 8px;
    background: currentColor;
  }

  .name {
    font-family: var(--font-pixel);
    font-size: var(--text-md);
    font-weight: 500;
    letter-spacing: 0.02em;
  }

  /* The cursor of a turn still being written, blinking as a caret does. */
  .live .mark {
    animation: blink 1s steps(1, end) infinite;
  }

  @keyframes blink {
    50% {
      opacity: 0.25;
    }
  }

  /*
   * Quiet until wanted: this is the one control in the log that throws work
   * away, and it should not read as the obvious next thing to press. 24px, the
   * smallest target a pointer is owed.
   */
  .restore {
    width: 24px;
    height: 24px;
    margin-left: auto;
    opacity: 0;
  }

  .turn:hover .restore,
  .restore:focus-visible {
    opacity: 1;
  }

  .text {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .tools {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    align-self: flex-start;
    min-height: 24px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-dim);
    font-size: var(--text-sm);
  }

  .tools:hover:not(:disabled) {
    background: none;
    color: var(--text);
  }

  .steps {
    margin: 0;
    padding: var(--space-2) var(--space-3) var(--space-2) var(--space-6);
    font-size: var(--text-sm);
    color: var(--text-dim);
  }

  .receipt {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .receipt li {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  /* An inventory slot, a size down: dark in every theme, as the list's are. */
  .slot {
    flex: none;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    background: var(--slot);
    border: var(--bevel) solid;
    border-color: var(--bevel-lo) var(--bevel-hi) var(--bevel-hi) var(--bevel-lo);
  }

  .slot img {
    width: 20px;
    height: 20px;
  }

  /* A count is figures, not pixels: `.figures` in app.css says why. */
  .count {
    flex: none;
    min-width: 5ch;
    font-family: var(--font-body);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .removed .count {
    color: var(--danger);
  }

  .added .count {
    color: var(--ok);
  }

  /* Long block names wrap rather than stretching the panel. */
  .block {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .receipt .more {
    padding-left: calc(28px + var(--space-3));
    font-size: var(--text-sm);
    color: var(--text-dim);
  }

  .undo {
    align-self: flex-start;
  }

  .progress {
    height: 10px;
    overflow: hidden;
  }

  .bar {
    height: 100%;
    background: var(--accent);
    transition: width var(--duration-fast) linear;
  }

  footer {
    flex: none;
    padding: var(--space-3) var(--space-4) var(--space-4);
    border-top: 1px solid var(--bevel-lo);
    box-shadow: inset 0 1px 0 var(--bevel-hi);
  }

  .memory {
    margin: var(--space-2) var(--space-1) 0;
  }
</style>
