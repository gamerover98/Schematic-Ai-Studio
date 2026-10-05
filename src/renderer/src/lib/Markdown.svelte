<script lang="ts">
  /**
   * An agent's answer, rendered.
   *
   * This is the one place in the app that uses `{@html}`, and the only reason
   * it is tolerable is that nothing reaches it except through `toSafeHtml`,
   * which sanitises with the allowlist in `markdown_policy.ts`. If you are
   * adding a second caller, send it through the same function; if you are
   * tempted to pass `entry.text` straight in, that is the mistake this comment
   * exists to stop.
   *
   * Only `agent` turns come here. What the user typed stays literal — echoing
   * someone's own words back with the asterisks eaten is a small betrayal, and
   * this app's users type `minecraft:oak_log` all day.
   */
  import DOMPurify from "dompurify";

  import { t } from "./i18n.svelte.js";
  import { toSafeHtml, type Purifier } from "./markdown.js";

  interface Props {
    source: string;
  }

  const { source }: Props = $props();

  const html = $derived(toSafeHtml(source, DOMPurify as unknown as Purifier));

  let container = $state<HTMLDivElement | null>(null);
  /** Which `<pre>` last had its contents copied, so the label can say so. */
  let copied = $state<HTMLElement | null>(null);

  /**
   * Hangs a copy button off every code block.
   *
   * Done to the DOM after injection rather than in the markdown pipeline,
   * because a button is a control and controls have no business being produced
   * by a sanitiser — anything `toSafeHtml` emits has to survive the allowlist,
   * and adding `<button>` to that list to get this would widen the one thing
   * the file exists to keep narrow.
   *
   * The click is handled by delegation on the container instead of by a
   * listener per button, so the buttons are inert markup and there is nothing
   * to unbind when the message re-renders.
   */
  $effect(() => {
    // Depend on the rendered html, not just the element: a new answer replaces
    // the whole subtree and the buttons go with it.
    void html;
    if (!container) return;
    copied = null;

    for (const pre of container.querySelectorAll("pre")) {
      if (pre.parentElement?.classList.contains("code")) continue;

      const wrapper = document.createElement("div");
      wrapper.className = "code";
      pre.replaceWith(wrapper);
      wrapper.append(pre);

      const button = document.createElement("button");
      button.className = "copy";
      button.type = "button";
      button.dataset.copy = "";
      button.textContent = t("chat.copyCode");
      wrapper.append(button);
    }
  });

  async function onClick(event: MouseEvent): Promise<void> {
    const target = event.target as HTMLElement | null;
    const button = target?.closest<HTMLElement>("[data-copy]");
    const pre = button?.parentElement?.querySelector("pre");
    if (!button || !pre) return;

    try {
      await navigator.clipboard.writeText(pre.textContent ?? "");
      button.textContent = t("chat.copied");
      copied = button;
    } catch {
      // A clipboard the browser refused is not worth an error banner in a chat
      // log. The button simply does not change, and the text is still there to
      // select by hand.
    }
  }

  /** Puts every other button's label back once one of them says "Copied". */
  $effect(() => {
    if (!container || copied === null) return;
    for (const button of container.querySelectorAll<HTMLElement>("[data-copy]")) {
      if (button !== copied) button.textContent = t("chat.copyCode");
    }
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="markdown" bind:this={container} onclick={onClick}>{@html html}</div>

<style>
  .markdown {
    margin: 0;
    line-height: 1.5;
    /* The container itself must never scroll sideways -- individual wide
       children do that for themselves, below. */
    overflow-wrap: anywhere;
  }

  /*
   * Everything below is `:global`, because none of it is in this component's
   * markup: it is injected. Svelte scopes styles by adding a class at compile
   * time, and there is nothing to add it to.
   */
  .markdown :global(p) {
    margin: 0 0 var(--space-3);
  }

  .markdown :global(> *:last-child) {
    margin-bottom: 0;
  }

  .markdown :global(h1),
  .markdown :global(h2),
  .markdown :global(h3),
  .markdown :global(h4),
  .markdown :global(h5),
  .markdown :global(h6) {
    margin: var(--space-4) 0 var(--space-2);
    font-size: var(--text-md);
    font-weight: 700;
    line-height: 1.3;
  }

  .markdown :global(h1) {
    font-size: var(--text-lg);
  }

  .markdown :global(ul),
  .markdown :global(ol) {
    margin: 0 0 var(--space-3);
    padding-left: var(--space-6);
  }

  .markdown :global(li) {
    margin: var(--space-1) 0;
  }

  /* The game's own bullet: a square, not a disc. */
  .markdown :global(ul) {
    list-style: square;
  }

  .markdown :global(li::marker) {
    color: var(--accent-text);
  }

  .markdown :global(blockquote) {
    margin: 0 0 var(--space-3);
    padding: var(--space-1) 0 var(--space-1) var(--space-4);
    border-left: var(--bevel) solid var(--border);
    color: var(--text-dim);
  }

  /* A groove cut into the slab, as the chat's boundary is. */
  .markdown :global(hr) {
    margin: var(--space-4) 0;
    border: none;
    border-top: 1px solid var(--bevel-lo);
    border-bottom: 1px solid var(--bevel-hi);
  }

  .markdown :global(code) {
    padding: 0 var(--space-1);
    background: var(--bg-input);
    font-family: var(--mono);
    font-size: var(--text-sm);
  }

  /* The wrapper the effect adds, so the button has something to sit against. */
  .markdown :global(.code) {
    position: relative;
    margin: 0 0 var(--space-3);
  }

  /* A well sunk into the slab, as `.sunken` is in app.css. */
  .markdown :global(pre) {
    margin: 0;
    padding: var(--space-3) var(--space-4);
    background: var(--bg-input);
    border: var(--bevel) solid;
    border-color: var(--bevel-lo) var(--bevel-hi) var(--bevel-hi) var(--bevel-lo);
    /* A long line scrolls inside the block rather than widening the panel. */
    overflow-x: auto;
  }

  .markdown :global(pre code) {
    padding: 0;
    background: none;
  }

  /* A small slab in the corner of the well: app.css's button, a size down. */
  .markdown :global(.copy) {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
    min-height: 24px;
    padding: 0 var(--space-3);
    color: var(--text-dim);
    font-size: var(--text-xs);
    /* Out of the way until wanted: the code is what you came to read. */
    opacity: 0;
    transition: opacity var(--duration-fast) var(--ease);
  }

  .markdown :global(.code:hover .copy),
  .markdown :global(.copy:focus-visible) {
    opacity: 1;
  }

  /*
   * A table in a 380px column does not fit, and the panel must not be the thing
   * that scrolls -- that would drag the whole conversation sideways.
   * `display: block` turns the table into its own scroll container, which is
   * the one way to get this without wrapping it in an extra element.
   */
  .markdown :global(table) {
    display: block;
    width: max-content;
    max-width: 100%;
    margin: 0 0 var(--space-3);
    overflow-x: auto;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }

  .markdown :global(th),
  .markdown :global(td) {
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--border);
    text-align: left;
  }

  .markdown :global(th) {
    background: var(--bg-input);
    font-weight: 700;
  }

  /* `marked` writes the GFM alignment row as an attribute, not a class. */
  .markdown :global([align="center"]) {
    text-align: center;
  }

  .markdown :global([align="right"]) {
    text-align: right;
  }

  .markdown :global(a) {
    color: var(--accent-text);
  }
</style>
