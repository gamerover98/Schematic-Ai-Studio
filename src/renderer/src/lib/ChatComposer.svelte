<script lang="ts">
  /**
   * The chat input: one bordered box holding the textarea, what the request
   * will act on, and the model it will go to.
   *
   * Pinned to the bottom of the panel with the log scrolling above it, which is
   * the arrangement every chat converges on and the one this replaces did not
   * have -- the old prompt box sat in the middle of a scrolling column and went
   * off-screen as the conversation grew.
   *
   * The context chip replaces a `<label>` that read "Acts on your selection
   * unless you say otherwise". Same fact, but as a chip it reads as part of the
   * request being composed rather than as instructions about it, and it can
   * carry the actual size.
   *
   * The box is the game's text field: a well sunk into the slab, with the
   * focus ring on the box rather than on the bare textarea inside it, because
   * the box is what you are typing into. Send is the emerald slab, Stop the
   * redstone one.
   */
  import type { RegionSpec } from "../../../shared/ipc.js";
  import type { ExportType, KeyStorageStatus, Settings } from "../../../shared/settings.js";
  import { formatNumber, t } from "./i18n.svelte.js";
  import { providerLabel } from "./provider_label.js";
  import Icon from "./Icon.svelte";
  import ModelPicker from "./ModelPicker.svelte";

  interface Props {
    selection: RegionSpec | null;
    /**
     * How many areas are selected beside the active one. The chip measures
     * the active area, because that is what the tools default to; the others
     * are said as a count, because the agent is told about them too.
     */
    otherAreas?: number;
    busy: boolean;
    /**
     * Whether there is a run that `onstop` can actually stop.
     *
     * Not the same question as `busy`, and that difference is the whole point:
     * switching conversations, restoring a checkpoint and refreshing the
     * document all set `busy`, and none of them is stoppable. Deciding the
     * button from `busy` put a Stop on screen that did nothing at all.
     */
    running: boolean;
    /** Whether a schematic is open; decides what a message means, not whether one can be sent. */
    hasDocument: boolean;
    /**
     * The reference image a *build* will be given, if any.
     *
     * Only ever consulted with nothing open, because that is the only time a
     * message goes to the generator. It used to live in a form in a sidebar tab
     * next to a second text box for the description -- which is to say the app
     * had two places to ask a model to build something, and this one already
     * had the conversation.
     */
    imageName: string | null;
    /** Whether the chosen model can read an image at all. */
    acceptsImages: boolean;
    imageHint: string;
    /**
     * Whether the chosen provider has no key.
     *
     * The generator's own button had this guard and the chat never did, so the
     * same missing key greyed one control out and let the other send a message
     * that could only come back as an error. Only one of those controls is left.
     */
    blockedOnKey: boolean;
    onpickimage: () => void;
    onclearimage: () => void;
    settings: Settings;
    keyStatus: KeyStorageStatus | null;
    /**
     * The half-written message.
     *
     * Owned by `App.svelte` rather than held here. It was tabs that made this
     * necessary -- switching one unmounted the composer and threw the draft
     * away -- and the tabs are gone, but the ownership stays: a draft is part
     * of the conversation's state, and the conversation belongs to the app.
     */
    draft: string;
    ondraftchange: (draft: string) => void;
    onask: (prompt: string) => void;
    onstop: () => void;
    onsettingschange: (patch: Partial<Settings>) => void;
    onopensettings: () => void;
    /**
     * Bumped to put the caret in the box: the start screen's "describe it in
     * the chat" is a way in only if the next keystroke lands here.
     */
    focusRequest?: number;
  }

  const {
    selection,
    otherAreas = 0,
    busy,
    running,
    hasDocument,
    imageName,
    acceptsImages,
    imageHint,
    blockedOnKey,
    onpickimage,
    onclearimage,
    settings,
    keyStatus,
    draft,
    ondraftchange,
    onask,
    onstop,
    onsettingschange,
    onopensettings,
    focusRequest = 0,
  }: Props = $props();

  let input = $state<HTMLTextAreaElement | null>(null);

  const volume = $derived(
    selection === null
      ? 0
      : (selection.maxX - selection.minX + 1) *
          (selection.maxY - selection.minY + 1) *
          (selection.maxZ - selection.minZ + 1),
  );

  /**
   * Grows with the text, up to a point.
   *
   * Height has to be reset to `auto` before reading `scrollHeight`, or the box
   * only ever grows: `scrollHeight` of an element already tall enough is its
   * own height, so it would latch at each maximum and never shrink back.
   */
  function autosize(): void {
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
  }

  $effect(() => {
    void draft;
    autosize();
  });

  $effect(() => {
    if (focusRequest > 0) input?.focus();
  });

  function submit(): void {
    const prompt = draft.trim();
    if (prompt === "" || busy || blockedOnKey) return;
    ondraftchange("");
    onask(prompt);
  }

  function onKeydown(event: KeyboardEvent): void {
    // Enter sends, Shift+Enter breaks the line -- the convention everywhere.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }
</script>

<div class="composer">
  <textarea
    bind:this={input}
    value={draft}
    oninput={(event) => ondraftchange(event.currentTarget.value)}
    onkeydown={onKeydown}
    placeholder={hasDocument ? t("chat.placeholder") : t("chat.buildPlaceholder")}
    rows="1"
    aria-label={t("chat.legend")}
  ></textarea>

  <div class="context">
    {#if !hasDocument}
      <!-- Nothing to act *on*: the message describes what to make. -->
      <span class="chip dim" title={t("chat.actsAsBuild")}>#new-schematic</span>
      <!--
        And the two things a build takes that a message cannot carry by itself.
        Shown only here, because with a document open the message goes to the
        agent and neither of them means anything.
      -->
      {#if imageName === null}
        <button
          class="chip attach"
          onclick={onpickimage}
          disabled={!acceptsImages || busy}
          title={acceptsImages ? t("chat.attachImageHint") : imageHint}
        >
          <Icon name="attach" size={12} />
          {t("chat.attachImage")}
        </button>
      {:else}
        <span class="chip" title={imageName}>
          <Icon name="attach" size={12} />
          <em>{imageName}</em>
          <button class="clear" onclick={onclearimage} aria-label={t("common.clear")}>
            <Icon name="close" size={11} weight={2.4} />
          </button>
        </span>
      {/if}
      <select
        class="format"
        value={settings.exportType}
        onchange={(event) =>
          onsettingschange({ exportType: event.currentTarget.value as ExportType })}
        title={t("chat.exportTypeHint")}
        aria-label={t("chat.exportType")}
      >
        <option value="schem">.schem</option>
        <option value="mcfunction">.mcfunction</option>
      </select>
    {:else if selection}
      <span class="chip" title={t("chat.actsOnSelection")}>
        #selection
        <em>
          {selection.maxX - selection.minX + 1}×{selection.maxY - selection.minY + 1}×{selection.maxZ -
            selection.minZ +
            1}
          · {formatNumber(volume)}
        </em>
        {#if otherAreas > 0}
          <em title={t("chat.otherAreas", { count: otherAreas })}>+{otherAreas}</em>
        {/if}
      </span>
    {:else}
      <span class="chip dim" title={t("chat.actsOnAll")}>#whole-schematic</span>
    {/if}
  </div>

  <div class="actions">
    <ModelPicker {settings} {keyStatus} onchange={onsettingschange} {onopensettings} />
    {#if running}
      <!--
        Never disabled. A Stop that is greyed out while the thing it stops is
        running is the one state this button must not have.
      -->
      <button class="send danger" onclick={onstop} title={t("chat.stopHint")}>
        <Icon name="stop" size={14} />{t("chat.stop")}
      </button>
    {:else}
      <button
        class="send primary"
        onclick={submit}
        disabled={busy || blockedOnKey || draft.trim() === ""}
        aria-label={t("chat.send")}
        title={blockedOnKey ? t("chat.needsKey", { provider: providerLabel(settings.provider) }) : t("chat.send")}
      >
        <Icon name="send" size={15} />
      </button>
    {/if}
  </div>
</div>

<style>
  /*
   * Both columns may shrink, and the context wraps. With nothing open the
   * context row holds three things -- the chip, the image and the format --
   * and in a narrow sidebar the format select used to run on under the model
   * name, its arrow covering half of it. Wrapping keeps every control whole;
   * the model name gives way with an ellipsis rather than being covered.
   */
  .composer {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, auto);
    grid-template-areas:
      "text text"
      "context actions";
    gap: var(--space-2);
    padding: var(--space-3);
    background: var(--bg-input);
    border: var(--bevel) solid;
    border-color: var(--bevel-lo) var(--bevel-hi) var(--bevel-hi) var(--bevel-lo);
  }

  /* The ring of the field you are typing in, drawn round the whole box. */
  .composer:has(textarea:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 0;
  }

  textarea {
    grid-area: text;
    width: 100%;
    min-height: 24px;
    max-height: 180px;
    padding: var(--space-1) var(--space-2);
    border: none;
    background: none;
    resize: none;
    overflow-y: auto;
  }

  textarea:focus,
  textarea:focus-visible {
    outline: none;
  }

  .context {
    grid-area: context;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }

  /* A label stamped on the request: square, a step up out of the well. */
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    max-width: 100%;
    min-height: 24px;
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-panel);
    font-size: var(--text-xs);
    color: var(--accent-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chip.dim {
    color: var(--text-dim);
  }

  /* A chip that is also a button: same shape, so the row reads as one strip of
     small facts about the request rather than as a toolbar. */
  .chip.attach {
    color: var(--text-dim);
    cursor: pointer;
  }

  .chip.attach:hover:not(:disabled) {
    color: var(--text);
    background: var(--bg-hover);
    border-color: var(--field-edge);
  }

  .chip .clear {
    display: grid;
    place-items: center;
    min-height: 0;
    padding: 0 var(--space-1);
    border: none;
    background: none;
    color: var(--text-dim);
  }

  .chip .clear:hover:not(:disabled) {
    background: none;
    color: var(--text);
  }

  /* `width: auto` undoes app.css's `width: 100%` for every select, which is
     what made this one as wide as the whole row and push under the model. */
  .format {
    flex: none;
    width: auto;
    min-height: 24px;
    padding: 0 var(--space-2);
    font-size: var(--text-xs);
  }

  .chip em {
    font-style: normal;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }

  .actions {
    grid-area: actions;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    justify-content: flex-end;
    align-self: end;
    min-width: 0;
  }

  .send {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    min-width: 40px;
    padding: 0 var(--space-3);
  }
</style>
