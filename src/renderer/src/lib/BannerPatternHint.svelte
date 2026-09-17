<script lang="ts">
  /**
   * Where a banner's design comes from, said where a banner is being chosen.
   *
   * A banner's design is not a block in any list: it is layers in a block
   * entity, and the place they are edited is the inspector's pattern editor,
   * on a banner already placed. So the selection tools and the inventory send
   * a person there (`place`), and the editor itself says where a ready-made
   * design comes from (`inspector`): an editor that hands back a `/give`
   * command, which the editor's paste field takes apart.
   *
   * The block field still takes that command whole -- `shared/block_input.ts`
   * reads it everywhere a block is named, the MCP tools included -- but it is
   * no longer what the screen teaches. Pasting a design into the thing that
   * holds a design is the gesture a person guesses.
   *
   * The link opens in the system browser. `main/index.ts` answers
   * `setWindowOpenHandler` with `shell.openExternal` and refuses `will-navigate`,
   * so `target="_blank"` cannot take the window away from the app -- About's
   * links rely on the same thing.
   */
  import { BANNER_EDITOR_URL } from "../../../shared/banner_patterns.js";
  import { t } from "./i18n.svelte.js";

  interface Props {
    /**
     * `place`: beside a field that picks a banner, pointing at the inspector.
     * `inspector`: inside the pattern editor, pointing at its paste field.
     */
    where: "place" | "inspector";
  }

  const { where }: Props = $props();
</script>

<p class="banner-hint">
  {where === "place" ? t("banner.hint.place.before") : t("banner.hint.inspector.before")}<a
    href={BANNER_EDITOR_URL}
    target="_blank"
    rel="noreferrer">{t("banner.hint.editor")}</a
  >{where === "place" ? t("banner.hint.place.after") : t("banner.hint.inspector.after")}
</p>

<style>
  .banner-hint {
    margin: 0;
    font-size: 11px;
    line-height: 1.35;
    color: var(--text-dim);
  }

  .banner-hint a {
    color: var(--accent);
  }
</style>
