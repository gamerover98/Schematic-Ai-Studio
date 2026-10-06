<script lang="ts">
  /**
   * What this application is, said once, where somebody can find it.
   *
   * Nothing in the running app named its version, its licence, what it is
   * derived from, or that it costs nothing -- all of which lived only in
   * `README.md`, which is to say only on GitHub, which is to say nowhere for
   * anyone who installed it. Help -> About is the first place a person looks
   * for exactly these facts, and it was the one menu the app did not have.
   *
   * A `Modal`, so it releases the pointer lock on the way in like every other
   * dialog: this opens over the viewport, and in flight the canvas holds the
   * pointer.
   *
   * The version comes from main (`AppInfo`), not from a constant compiled in
   * beside it. `info` is therefore `null` for one await after the box opens,
   * which is a real state and is drawn as one rather than as a zero.
   */
  import type { AppInfo } from "../../../shared/ipc.js";
  import { REPOSITORY_URL } from "../../../shared/app_version.js";
  import { t } from "./i18n.svelte.js";
  import Modal from "./Modal.svelte";
  /*
   * The only asset import in the renderer. Vite emits it under
   * `out/renderer/assets/` and references it by relative URL, which the CSP's
   * `img-src 'self' data:` covers -- as it would the inlined `data:` form vite
   * uses for small files, so neither outcome needs a policy change.
   *
   * It is generated into the renderer's own tree by `scripts/gen-icons.mjs`
   * rather than imported across the vite root from `build/`, which would work
   * only for as long as `server.fs.allow`'s search kept reaching the repo root.
   */
  import logo from "../assets/logo.png";

  interface Props {
    open: boolean;
    /** `null` until main has answered; one await, on first open. */
    info: AppInfo | null;
    onclose: () => void;
  }

  const { open, info, onclose }: Props = $props();

  // One copy of the address: the updater reads its releases from the same one.
  const REPOSITORY = REPOSITORY_URL;
  const UPSTREAM = "https://github.com/CyniaAI/BuilderGPT";
  const FAITHFUL = "https://faithfulpack.net/";
  const LICENSE = "https://www.apache.org/licenses/LICENSE-2.0";

  /**
   * The runtime line, which is the row a bug report wants.
   *
   * One string rather than three fields: it is read once, copied once, and
   * pasted into an issue, and three labelled rows would be three things to
   * select instead of one.
   */
  const runtime = $derived(
    info === null
      ? null
      : `Electron ${info.electron} · Chromium ${info.chrome} · Node ${info.node} · ${info.platform}`,
  );
</script>

<Modal {open} title={t("about.title")} {onclose} width={460}>
  <div class="identity">
    <!--
      `alt=""` on purpose: the app name is the very next element, so a
      screen reader given alt text here would announce the name twice. It
      also keeps this out of the catalogue, where `tests/ui.ts` objects to
      both a key with no message and a message nobody asks for.
    -->
    <img class="logo" src={logo} alt="" width="72" height="72" />
    <div>
      <p class="name pixel">{t("app.title")}</p>
      <p class="version">
        {t("about.version", { version: info?.version ?? "—" })}
      </p>
    </div>
  </div>

  <p class="tagline">{t("about.tagline")}</p>

  <!--
    The point of the box rather than a footnote at the bottom of it.
    There are paid services promising the same thing; this one is not
    one of them, and somebody who has just installed it has no other way
    of knowing that.
  -->
  <p class="callout free">{t("about.free")}</p>

  <section>
    <h3>{t("about.runtime")}</h3>
    <p class="runtime">{runtime ?? "—"}</p>
  </section>

  <section>
    <h3>{t("about.credits")}</h3>
    <ul>
      <li>
        <a href={UPSTREAM} target="_blank" rel="noreferrer">CyniaAI/BuilderGPT</a>
        {" — "}{t("about.credit.origin")}
      </li>
      <li>
        <a href={FAITHFUL} target="_blank" rel="noreferrer">Faithful</a>
        {" — "}{t("about.credit.faithful")}
      </li>
      <li>{t("about.credit.libraries")}</li>
    </ul>
    <p class="hint">{t("about.credit.more")}</p>
  </section>

  {#snippet footer()}
    <!--
      External links are safe here and go to the system browser:
      `main/index.ts` answers `setWindowOpenHandler` with
      `shell.openExternal` and refuses `will-navigate` outright, so a
      `target="_blank"` cannot navigate the window away from the app.
    -->
    <a class="link" href={REPOSITORY} target="_blank" rel="noreferrer">
      {t("about.repository")}
    </a>
    <a class="link" href={LICENSE} target="_blank" rel="noreferrer">
      {t("about.license")}
    </a>
    <span class="spacer"></span>
    <button onclick={onclose}>{t("common.close")}</button>
  {/snippet}
</Modal>

<style>
  .identity {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    margin-bottom: var(--space-4);
  }

  /* Sized in CSS as well as in the attributes: the attributes reserve the
     square before the file loads, these keep it right if the generated asset
     is ever regenerated at another size. */
  .logo {
    flex: none;
    display: block;
    width: 72px;
    height: 72px;
  }

  .name {
    margin: 0;
    font-size: var(--text-xl);
  }

  .version {
    margin: var(--space-1) 0 0;
    font-size: var(--text-sm);
    color: var(--text-dim);
  }

  .tagline {
    margin: 0 0 var(--space-4);
    font-size: var(--text-sm);
    line-height: 1.6;
  }

  .free {
    margin-bottom: var(--space-5);
  }

  section {
    margin-bottom: var(--space-4);
  }

  .runtime {
    margin: 0;
    font-family: var(--mono);
    font-size: var(--text-xs);
    line-height: 1.6;
    color: var(--text-dim);
    /* Selectable and wrapping: this row exists to be copied into a report. */
    user-select: text;
    overflow-wrap: anywhere;
  }

  ul {
    margin: 0;
    padding-left: var(--space-5);
    font-size: var(--text-sm);
    line-height: 1.7;
  }

  a {
    color: var(--accent-text);
  }

  .spacer {
    flex: 1 1 auto;
  }

  .link {
    font-size: var(--text-sm);
  }
</style>
