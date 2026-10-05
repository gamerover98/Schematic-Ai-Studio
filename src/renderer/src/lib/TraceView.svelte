<script lang="ts">
  /**
   * What a turn did, drawn.
   *
   * The chat used to narrate a run as a list of one-line summaries — "filling
   * (0,0,0)-(9,3,9) with minecraft:stone" — which says what happened and
   * nothing about *why*, and for a build said "Sending the build spec to the
   * model" and then nothing at all. Here every part of a turn is a row that can
   * be opened: the request that was sent verbatim, the model thinking where it
   * does that, and each tool call with the arguments it was given and the
   * result it returned.
   *
   * ## Everything is collapsed except the thinking, and that is deliberate
   *
   * A trace is long. Opened by default it would push the answer — the thing
   * the user is waiting for — off the bottom of the panel. Reasoning is the
   * exception while it is still arriving, because a model that thinks for
   * thirty seconds and shows a closed box is the problem this replaces.
   *
   * ## Only the reader's own clicks decide what is open
   *
   * `open` is keyed by item id and nothing writes it but the toggles. An
   * earlier arrangement re-derived it from `running`, which snapped rows shut
   * the instant they finished — under the reader's cursor, mid-sentence.
   *
   * ## A well in the slab
   *
   * What the model did is sunk into the panel (`.sunken`), the way a slot is:
   * it is the machinery under the answer, and the answer stands on the slab
   * above it. While the turn is still going the well has an emerald edge.
   */
  import type { TraceItem } from "../../../shared/ipc.js";
  import { t, tn } from "./i18n.svelte.js";
  import Icon from "./Icon.svelte";

  interface Props {
    items: readonly TraceItem[];
    /** Whether the turn is still going; only then is a running row honest. */
    live?: boolean;
  }

  const { items, live = false }: Props = $props();

  let open = $state<Record<number, boolean>>({});
  /** Rows the reader has deliberately shut, so "open while running" can yield. */
  let dismissed = $state<Record<number, boolean>>({});

  function toggle(id: number): void {
    const next = !isOpen(id);
    open = { ...open, [id]: next };
    if (!next) dismissed = { ...dismissed, [id]: true };
  }

  function isOpen(item: TraceItem | number): boolean {
    const id = typeof item === "number" ? item : item.id;
    if (open[id] !== undefined) return open[id];
    // Thinking, while it is still being written. Everything else stays shut
    // until asked for.
    if (typeof item === "number" || dismissed[id]) return false;
    return item.kind === "reasoning" && item.running === true;
  }

  /** The row's heading: what this part of the turn is. */
  function label(item: TraceItem): string {
    if (item.kind === "tool") return item.name ?? t("trace.tool");
    if (item.kind === "request") return t("trace.request");
    if (item.kind === "reasoning") return t("trace.reasoning");
    if (item.kind === "note") return t("trace.note");
    return t("trace.wrote");
  }

  /** `1.4s`, or nothing while it is still going. */
  function duration(item: TraceItem): string {
    if (item.ms === undefined) return "";
    return item.ms < 1000 ? `${item.ms}ms` : `${(item.ms / 1000).toFixed(1)}s`;
  }

  /**
   * A note is one line and has nothing to open; everything else does.
   *
   * A row with a caret that opens an empty box is worse than no caret: it
   * invites a click that answers nothing.
   */
  function hasBody(item: TraceItem): boolean {
    return item.kind !== "note" && (item.text !== "" || item.input !== undefined);
  }
</script>

{#if items.length > 0}
  <div class="trace sunken" class:live>
    {#each items as item (item.id)}
      <div class="row" class:running={item.running}>
        {#if hasBody(item)}
          <button
            class="head"
            aria-expanded={isOpen(item)}
            onclick={() => toggle(item.id)}
          >
            <span class="caret"><Icon name={isOpen(item) ? "chevronDown" : "chevronRight"} size={10} weight={2.6} /></span>
            <span class="kind {item.kind}">{label(item)}</span>
            <span class="gist">{item.kind === "tool" ? item.text : ""}</span>
            {#if item.running}
              <span class="spinner"><Icon name="dot" size={10} /></span>
            {:else if duration(item) !== ""}
              <span class="ms">{duration(item)}</span>
            {/if}
          </button>
        {:else}
          <div class="head static">
            <span class="caret" aria-hidden="true">·</span>
            <span class="kind {item.kind}">{label(item)}</span>
            <span class="gist">{item.text}</span>
          </div>
        {/if}

        {#if isOpen(item) && hasBody(item)}
          <div class="body">
            {#if item.error !== undefined}
              <p class="failed">{item.error}</p>
            {/if}
            {#if item.input !== undefined}
              <p class="caption">{t("trace.arguments")}</p>
              <pre><code>{item.input}</code></pre>
            {/if}
            {#if item.output !== undefined}
              <p class="caption">{t("trace.result")}</p>
              <pre><code>{item.output}</code></pre>
            {/if}
            {#if item.text !== ""}
              {#if item.kind === "reasoning"}
                <!--
                  Prose, not code: reasoning is sentences, and a monospace box
                  with no wrapping turns a paragraph into a horizontal scroll.
                -->
                <p class="thinking">{item.text}</p>
              {:else if item.kind !== "tool"}
                <pre><code>{item.text}</code></pre>
              {/if}
            {/if}
            {#if item.elided !== undefined}
              <p class="elided">{item.elided}</p>
            {/if}
          </div>
        {/if}
      </div>
    {/each}
    {#if live}
      <p class="hint">{tn("trace.stepCount", items.length)}</p>
    {/if}
  </div>
{/if}

<style>
  .trace {
    display: flex;
    flex-direction: column;
    padding: var(--space-1) var(--space-3);
    min-width: 0;
  }

  .trace.live {
    box-shadow: inset 2px 0 0 var(--accent);
  }

  /*
   * A row is a line of text that opens, not a slab: the global button's bevel
   * and padding are taken off. 24px tall, the smallest target a pointer is
   * owed.
   */
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    min-height: 24px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-dim);
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
  }

  .head.static {
    cursor: default;
  }

  .head:hover:not(.static):not(:disabled) {
    background: none;
    color: var(--text);
  }

  .caret {
    flex: none;
    display: grid;
    place-items: center;
    width: 10px;
  }

  .kind {
    flex: none;
    font-family: var(--mono);
    color: var(--text);
  }

  .kind.reasoning {
    color: var(--accent-text);
    font-style: italic;
  }

  .kind.request {
    color: var(--text-dim);
  }

  /*
   * The one-line gist of a tool call. Truncated rather than wrapped: these sit
   * in a 380px column and a summary naming two coordinate triples would
   * otherwise take three lines each, turning a nine-call turn into a wall.
   */
  .gist {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ms {
    flex: none;
    font-variant-numeric: tabular-nums;
  }

  .spinner {
    flex: none;
    display: grid;
    place-items: center;
    color: var(--accent);
    animation: pulse 1.1s ease-in-out infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 0.25;
    }
    50% {
      opacity: 1;
    }
  }

  /* Someone who asked not to see motion is not asking to see less. */
  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation: none;
      opacity: 0.8;
    }
  }

  .body {
    padding: var(--space-1) 0 var(--space-3) var(--space-5);
  }

  .caption {
    margin: var(--space-2) 0 var(--space-1);
    font-family: var(--font-pixel);
    font-size: var(--text-xs);
    font-weight: 500;
    letter-spacing: 0.04em;
    color: var(--text-dim);
  }

  /*
   * Scrolls inside itself, both ways. A build script is long and a block-id
   * list is 933 lines; without the cap one trace row would own the panel.
   * The slab's colour, a step up out of the well it sits in.
   */
  pre {
    max-height: 240px;
    margin: 0;
    padding: var(--space-2) var(--space-3);
    overflow: auto;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    font-size: var(--text-xs);
    line-height: 1.45;
  }

  code {
    font-family: var(--mono);
    white-space: pre;
  }

  .thinking {
    max-height: 240px;
    margin: 0;
    padding: var(--space-2) var(--space-3);
    overflow-y: auto;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    font-size: var(--text-sm);
    line-height: 1.5;
    white-space: pre-wrap;
    color: var(--text-dim);
  }

  .failed {
    margin: var(--space-1) 0;
    font-size: var(--text-sm);
    color: var(--danger);
  }

  .elided,
  .hint {
    margin: var(--space-2) 0 var(--space-1);
    font-size: var(--text-xs);
    color: var(--text-dim);
    font-style: italic;
  }
</style>
