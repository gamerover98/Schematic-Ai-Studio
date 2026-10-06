<script lang="ts">
  /**
   * The schematic's version history, as a modal.
   *
   * It was a `ToolWindow`, put there because it is a reflection of the open
   * document exactly as the inspector is. That is true of its *nature* and was
   * false about its size: a tool window is a fixed 232px, and a row here reads
   * `manual · 64×32×64 · 12,048 blocks` with a Restore button and a delete
   * beside it. Every row ellipsised, and the panel was too small to hold the
   * list it exists to show.
   *
   * A `Modal`, so the pointer lock goes when it opens: in flight the canvas
   * holds the pointer, and a panel over a camera still turning underneath is
   * the documented failure.
   */
  import type { DocumentVersion } from "../../../shared/ipc.js";
  import { t } from "./i18n.svelte.js";
  import Modal from "./Modal.svelte";
  import VersionList from "./VersionList.svelte";

  interface Props {
    open: boolean;
    versions: readonly DocumentVersion[];
    busy: boolean;
    /** Whether the open document has a file yet; the history is keyed on the path. */
    saved: boolean;
    onsave: () => void;
    onrestore: (id: string) => void;
    ondelete: (id: string) => void;
    onclose: () => void;
  }

  const { open, versions, busy, saved, onsave, onrestore, ondelete, onclose }: Props = $props();
</script>

<Modal {open} title={t("versions.legend")} {onclose} width={640}>
  <VersionList {versions} {busy} {saved} {onsave} {onrestore} {ondelete} />
</Modal>
