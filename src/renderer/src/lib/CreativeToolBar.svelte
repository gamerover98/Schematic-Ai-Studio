<script lang="ts">
  /**
   * The creative tools, over the hotbar, in flight.
   *
   * Only in flight, because only there is the right button a tool: in orbit
   * it turns the camera. Clickable while the pointer is free -- Escape, as
   * ever, is how to get a cursor -- and read-only while it is locked, when B
   * and the bracket keys are how it changes. Its line under the buttons says
   * what the tool will do, and after a first corner, where that corner is and
   * how to let go of it.
   *
   * The keys are heard here rather than in `App.svelte`'s `onWindowKey`, for
   * the hotbar's reason: that function gives every Ctrl chord to the camera
   * while flying, and B is a key somebody presses while sprinting.
   * `creativeKey` holds the rule.
   */
  import { CREATIVE_TOOLS, type CreativeSettings, type CreativeTool } from "../../../shared/creative.js";
  import { creativeKey, takesCorners, type Cell } from "./creative_tools.js";
  import { t } from "./i18n.svelte.js";
  import Icon from "./Icon.svelte";
  import type { IconName } from "./icons.js";
  import { isTyping } from "./typing.js";

  interface Props {
    settings: CreativeSettings;
    /** The first corner of a shape or a wall, until the second is clicked. */
    corner: Cell | null;
    /** The pointer is locked: the view is flying and the bar cannot be clicked. */
    flying: boolean;
    /** Whether the keys are the bar's: not with a modal or a menu over the view. */
    keys: boolean;
    optionsOpen: boolean;
    ontool: (tool: CreativeTool) => void;
    oncycle: () => void;
    onresize: (by: number) => void;
    onoptions: () => void;
  }

  const { settings, corner, flying, keys, optionsOpen, ontool, oncycle, onresize, onoptions }: Props = $props();

  const ICONS: Record<CreativeTool, IconName> = {
    place: "block",
    brush: "brush",
    shape: "shape",
    walls: "walls",
  };

  /** What the tool in hand will do, in a few words. */
  const summary = $derived.by(() => {
    switch (settings.tool) {
      case "place":
        return t("creative.summary.place");
      case "brush":
        return t("creative.summary.brush", {
          shape: t(`creative.brushShape.${settings.brush.shape}`),
          radius: settings.brush.radius,
        });
      case "shape":
        return t(settings.shape.hollow ? "creative.summary.hollowShape" : "creative.summary.shape", {
          shape: t(`creative.shapeKind.${settings.shape.kind}`),
          height: settings.shape.height,
        });
      case "walls":
        return t("creative.summary.walls", {
          height: settings.walls.height,
          thickness: settings.walls.thickness,
        });
    }
  });

  /** What to do next: the gesture the tool waits for. */
  const hint = $derived.by(() => {
    if (!flying) return t("creative.hint.paused");
    if (corner !== null) return t("creative.hint.secondCorner", { x: corner.x, y: corner.y, z: corner.z });
    if (takesCorners(settings.tool)) return t("creative.hint.firstCorner");
    if (settings.tool === "brush") return t("creative.hint.brush");
    return t("creative.hint.place");
  });

  $effect(() => {
    if (!keys) return;
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return;
      const key = creativeKey(event, document.pointerLockElement !== null);
      if (key === null) return;
      event.preventDefault();
      if (key === "cycle") oncycle();
      else onresize(key === "bigger" ? 1 : -1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
</script>

<div class="creative-bar" class:locked={flying} role="toolbar" aria-label={t("creative.legend")}>
  <div class="tools">
    {#each CREATIVE_TOOLS as tool (tool)}
      <button
        class:active={settings.tool === tool}
        onclick={() => ontool(tool)}
        aria-pressed={settings.tool === tool}
        title={`${t(`creative.tool.${tool}`)} — ${t(`creative.toolHint.${tool}`)}`}
      >
        <Icon name={ICONS[tool]} />
        <span>{t(`creative.tool.${tool}`)}</span>
      </button>
    {/each}
    <button
      class="options"
      class:active={optionsOpen}
      onclick={onoptions}
      disabled={settings.tool === "place"}
      aria-pressed={optionsOpen}
      aria-label={t("creative.options")}
      title={t("creative.options")}
    >
      <Icon name="gear" />
    </button>
  </div>
  <div class="line">
    <strong>{summary}</strong>
    <span class="hint" class:pending={corner !== null}>{hint}</span>
  </div>
</div>

<style>
  .creative-bar {
    position: absolute;
    /* Clear of the hotbar, from the tokens that describe it -- the gizmo bar's
       place, which it never shares: that one is orbit's and this is flight's. */
    bottom: calc(var(--hotbar-inset) + var(--hotbar-height) + 8px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 5;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    max-width: calc(100% - 32px);
    padding: 4px 6px 5px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-panel);
    box-shadow: 0 6px 20px var(--shadow);
  }

  /* Nothing can be pressed while the pointer is locked; saying so is the honest look. */
  .creative-bar.locked .tools {
    pointer-events: none;
  }

  .tools {
    display: flex;
    gap: 2px;
    align-items: center;
  }

  button {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 26px;
    padding: 0 8px;
    border: 1px solid transparent;
    border-radius: 5px;
    background: none;
    color: var(--text-dim);
    font: inherit;
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
  }

  button:hover:not(:disabled) {
    background: var(--bg-input);
    color: var(--text);
  }

  button:disabled {
    opacity: 0.45;
    cursor: default;
  }

  button.active {
    border-color: var(--accent);
    color: var(--accent);
  }

  .options {
    width: 28px;
    padding: 0;
    justify-content: center;
    margin-left: 4px;
  }

  .line {
    display: flex;
    gap: 8px;
    align-items: baseline;
    max-width: 100%;
    font-size: 11px;
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .line strong {
    color: var(--text);
    font-weight: 600;
  }

  .hint {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* A first corner is waiting: the one line that asks for something. */
  .hint.pending {
    color: var(--selection);
  }
</style>
