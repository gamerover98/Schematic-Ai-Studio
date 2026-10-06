<script lang="ts">
  /**
   * What the app is doing before it can be used.
   *
   * There was no such phase, and that was survivable until the block warm-up
   * arrived: meshing nine hundred blocks so the texture atlas stops moving is
   * seconds of the main process, and it used to start the first time anything
   * asked for an icon — which is the moment a schematic opens. The window sat
   * there, apparently hung, because every IPC call was queued behind it.
   *
   * So it happens here instead, up front, where waiting is what the screen is
   * for. Naming the steps is the rest of it: "loading" says nothing, and the
   * one step that takes real time deserves to say why.
   *
   * It is the first thing the app shows, and the start screen is the second,
   * so the two wear one header: the app's mark beside its name in the pixel
   * face, on the slab every window here is made of. The bar is the game's
   * loading bar in the inventory's material -- an emerald fill in a sunken
   * well.
   */
  import logo from "../assets/logo.png";
  import { formatNumber, t } from "./i18n.svelte.js";
  import Icon from "./Icon.svelte";

  export interface StartupStep {
    id: string;
    /** Already translated: the caller owns the wording. */
    label: string;
    state: "pending" | "running" | "done";
    /** Only the warm-up has one, and only while it runs. */
    progress?: { done: number; total: number };
  }

  interface Props {
    steps: readonly StartupStep[];
  }

  const { steps }: Props = $props();
</script>

<div class="startup" role="status" aria-live="polite">
  <div class="card slab">
    <header>
      <img class="logo" src={logo} alt="" width="48" height="48" />
      <div class="titles">
        <h1>{t("app.title")}</h1>
        <p class="lead">{t("startup.lead")}</p>
      </div>
    </header>

    <ul>
      {#each steps as step (step.id)}
        <li class={step.state}>
          <span class="mark">
            <Icon name={step.state === "done" ? "check" : step.state === "running" ? "dot" : "ring"} size={12} weight={2.4} />
          </span>
          <span class="label">{step.label}</span>
          {#if step.state === "running" && step.progress}
            <span class="count">
              {formatNumber(step.progress.done)} / {formatNumber(step.progress.total)}
            </span>
          {/if}
        </li>
        {#if step.state === "running" && step.progress}
          <!-- A bar only for the step that has a length worth showing. The
               others finish before the eye reaches them. -->
          <li class="bar-row">
            <div
              class="bar"
              role="progressbar"
              aria-valuemin="0"
              aria-valuemax={step.progress.total}
              aria-valuenow={step.progress.done}
            >
              <div
                class="fill"
                style={`width: ${Math.round((step.progress.done / Math.max(1, step.progress.total)) * 100)}%`}
              ></div>
            </div>
          </li>
        {/if}
      {/each}
    </ul>
  </div>
</div>

<style>
  /* The top tier: it is over everything, the start screen included, until
     the app can be used. Opaque, because there is nothing behind it yet. */
  .startup {
    position: fixed;
    inset: 0;
    z-index: var(--z-top);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-6);
    background: var(--bg);
  }

  .card {
    width: min(420px, 100%);
    padding: var(--space-5);
    box-shadow: var(--shadow-modal);
  }

  header {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    margin-bottom: var(--space-5);
  }

  .logo {
    flex: none;
    display: block;
  }

  .titles {
    min-width: 0;
  }

  h1 {
    margin: 0;
    font-family: var(--font-pixel);
    font-size: var(--text-xl);
    font-weight: 500;
    letter-spacing: 0.02em;
  }

  .lead {
    margin: var(--space-2) 0 0;
    color: var(--text-dim);
    font-size: var(--text-sm);
    line-height: 1.5;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-1) 0;
    color: var(--text-dim);
    font-size: var(--text-sm);
  }

  li.running {
    color: var(--text);
  }

  .mark {
    flex: none;
    display: grid;
    place-items: center;
    width: 12px;
  }

  li.done .mark {
    color: var(--accent-text);
  }

  .label {
    flex: 1 1 auto;
    min-width: 0;
  }

  .count {
    flex: none;
    font-family: var(--font-pixel);
    font-variant-numeric: tabular-nums;
    font-size: var(--text-sm);
  }

  .bar-row {
    padding: var(--space-1) 0 var(--space-3) calc(12px + var(--space-3));
  }

  .bar {
    width: 100%;
    height: 12px;
    border: var(--bevel) solid;
    border-color: var(--bevel-lo) var(--bevel-hi) var(--bevel-hi) var(--bevel-lo);
    background: var(--well);
    overflow: hidden;
  }

  .fill {
    height: 100%;
    background: var(--accent);
    /* Eased, because the warm-up reports in bursts of sixteen and an unsmoothed
       bar reads as stuttering rather than as progress. */
    transition: width 120ms linear;
  }
</style>
