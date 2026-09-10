<script lang="ts">
  /**
   * "↑ Update 1.0.2" in the application bar, while there is something to do.
   *
   * `McpIndicator`'s rules, for `McpIndicator`'s reasons: it reads main's
   * status and never a setting, it is a button that opens the pane that can
   * act on what it reports, and it says its state in words -- never colour
   * alone.
   *
   * It draws nothing outside `available`, `downloading` and `ready`. The
   * startup check exists to say "there is something new", and a badge that
   * stayed on to say "nothing new" would be one more thing in the bar to learn
   * to ignore.
   */
  import type { UpdateStatus } from "../../../shared/ipc.js";
  import { t } from "./i18n.svelte.js";

  interface Props {
    status: UpdateStatus;
    onopen: () => void;
  }

  const { status, onopen }: Props = $props();

  const label = $derived.by(() => {
    switch (status.state) {
      case "available":
        return t("updates.indicator.available", { version: status.latest?.version ?? "" });
      case "downloading":
        return t("updates.indicator.downloading", {
          percent: String(Math.round(status.progress?.percent ?? 0)),
        });
      case "ready":
        return t("updates.indicator.ready");
      default:
        return null;
    }
  });
</script>

{#if label !== null}
  <button
    class="update"
    class:ready={status.state === "ready"}
    onclick={onopen}
    title={`${t("updates.title")} — ${label}`}
    aria-label={`${t("updates.title")}: ${label}`}
  >
    <span class="arrow" aria-hidden="true">↑</span>
    <span class="name">{label}</span>
  </button>
{/if}

<style>
  .update {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    font-size: 12px;
  }

  .arrow {
    font-weight: 700;
    color: var(--accent);
  }

  /* Ready is the one state that is waiting on a click, so it is the one that
     stands out. */
  .update.ready {
    border-color: var(--accent);
  }

  .name {
    font-variant-numeric: tabular-nums;
  }
</style>
