<script lang="ts">
  /**
   * Everything that configures the app, out of the way of the work.
   *
   * Ten panes in four groups, and each pane in sections. It was ten panes in a
   * flat list, ordered by when each was written, and it had drifted into the
   * shape a flat list drifts into: ambient occlusion in two panes, the virtual
   * floor under "Sky & light", the frame counter and the stutter report among
   * the things that cost GPU time, a pane of two settings beside a pane of
   * twenty, and a hint at the top of Textures pointing at panes called
   * Viewport and Quality that had stopped holding what it said they held.
   *
   *   App            General (theme, language, what new builds are for),
   *                  Updates
   *   Viewport       Scene (sky, floor and grid, camera), Lighting (look, sun,
   *                  light from blocks), Textures
   *   Performance    Graphics (the card, resolution, frames and distance),
   *                  Level of detail, Diagnostics
   *   Connections    AI providers, MCP server
   *
   * **What rebuilds the preview says so beside its own name**, with a badge.
   * The tints, the resource pack, the markers and the three lights baked into
   * the vertices are multiplied into the atlas or the mesh, so changing one
   * re-meshes the document; everything else is a uniform the viewer changes
   * between frames. That used to be one paragraph at the top of one pane, and
   * the three lights that rebuild were in another pane, each repeating it in
   * its own hint.
   */
  import {
    AA_LEVELS,
    DEFAULT_BIOME_COLOR,
    DEFAULT_WATER_COLOR,
    FPS_CAPS,
    GPU_PREFERENCES,
    LANGUAGES,
    LOD_AUTO_TRIANGLES,
    LOD_MODES,
    LOD_PIXELS,
    MCP_PORT,
    PREVIEW_SETTING_RANGES,
    SHADER_MODES,
    SHADOW_QUALITIES,
    THEMES,
    effectiveIncludeDevBuilds,
    lodSettings,
    type GpuPreference,
    type LodMode,
    type KeyStorageStatus,
    type Language,
    type PreviewSettings,
    type ShaderMode,
    type Provider,
    type Settings,
    type Theme,
    type UpdateSettings,
  } from "../../../shared/settings.js";
  import ApiKeysSection from "./ApiKeysSection.svelte";
  import { fpsCap } from "./shader_modes.js";
  import { stutterReport } from "./frame_profiler.js";
  import { t, tn } from "./i18n.svelte.js";
  import Icon from "./Icon.svelte";
  import Modal from "./Modal.svelte";
  import { tintColour } from "./lod.js";
  import type { GpuStatus, McpActivity, McpStatus, MeshLod, UpdateStatus } from "../../../shared/ipc.js";
  import { choiceValue, formatMemory, gpuNeedsRestart, parseChoiceValue, pixelLoad } from "./gpu_choice.js";
  import { dotColor, dotFor, maskToken } from "./mcp_status.js";
  import { bindAddressRefusal, isLoopbackAddress } from "../../../shared/settings.js";
  import { bridgeCommand, connectCommand } from "../../../shared/mcp.js";
  import { mcVersion } from "../../../shared/mc_versions.js";
  import { api } from "./bridge.svelte.js";

  type Category =
    | "general"
    | "updates"
    | "scene"
    | "lighting"
    | "textures"
    | "performance"
    | "lod"
    | "diagnostics"
    | "providers"
    | "mcp";

  interface Props {
    open: boolean;
    settings: Settings;
    keyStatus: KeyStorageStatus | null;
    resourcePackPath: string | null;
    resourcePackName: string | null;
    /**
     * The Minecraft versions a schematic can be written for, and where
     * generated files land.
     *
     * Both were fields in the generator's form, in a sidebar tab, which made
     * them look like inputs to that one button. They are not: the version is
     * what a new schematic and a build from the chat are made for, and the
     * folder is where every generation ever goes. They are preferences, and
     * this is where preferences live.
     */
    versions: readonly string[];
    defaultOutputDir: string;
    onpickoutputdir: () => void;
    onrevealoutputdir: () => void;
    onrevealpath: (target: string) => void;
    busy: boolean;
    onclose: () => void;
    onchange: (patch: Partial<Settings>) => void;
    onpreviewchange: (patch: Partial<PreviewSettings>) => void;
    onuichange: (patch: Partial<Settings["ui"]>) => void;
    onpickresourcepack: () => void;
    onclearresourcepack: () => void;
    onsavekey: (provider: Provider, apiKey: string) => Promise<void>;
    onclearkey: (provider: Provider) => Promise<void>;
    /**
     * The pane to open on, when something else chose it.
     *
     * `startOn`, not `category`: the local `$state` below is already called
     * that, and a prop of the same name would shadow it — the same class of
     * collision `DocumentPanel`'s `doc` prop exists to avoid.
     */
    startOn: Category | null;
    /**
     * Where the open schematic's levels of detail stand, from main, or `null`
     * with nothing open. The settings are what was asked for; this says what
     * came of it -- which is the answer to "why does this build have none".
     */
    lodStatus: MeshLod | null;
    /**
     * The MCP server, from main rather than from the settings above.
     *
     * `settings.mcp.enabled` is the checkbox and this is what is actually
     * listening; they come apart when a port is taken, which is exactly the
     * case worth showing. See `mcp_status.ts`.
     */
    mcpStatus: McpStatus | null;
    mcpActivity: readonly McpActivity[];
    onmcpenabled: (enabled: boolean) => void;
    onmcpregenerate: () => void;
    onpickmcproot: () => void;
    /**
     * The updater, from main -- what it found and what it is doing -- and the
     * four things the pane can ask of it. Main's rather than the settings'
     * for the MCP status's reason: the settings are what was asked for, this
     * is what happened.
     */
    updateStatus: UpdateStatus | null;
    onupdateschange: (patch: Partial<UpdateSettings>) => void;
    oncheckupdates: () => void;
    ondownloadupdate: () => void;
    oninstallupdate: () => void;
  }

  const {
    open,
    settings,
    keyStatus,
    resourcePackPath,
    resourcePackName,
    versions,
    defaultOutputDir,
    onpickoutputdir,
    onrevealoutputdir,
    onrevealpath,
    busy,
    onclose,
    onchange,
    onpreviewchange,
    onuichange,
    onpickresourcepack,
    onclearresourcepack,
    onsavekey,
    onclearkey,
    startOn,
    lodStatus,
    mcpStatus,
    mcpActivity,
    onmcpenabled,
    onmcpregenerate,
    onpickmcproot,
    updateStatus,
    onupdateschange,
    oncheckupdates,
    ondownloadupdate,
    oninstallupdate,
  }: Props = $props();

  /**
   * A tick count as a clock face.
   *
   * Ticks are what the setting stores and what anyone typing `/time set` knows,
   * but "18000" does not read as midnight to anybody. Both, then: the slider is
   * in ticks and the label says what hour that is.
   */
  function clockLabel(ticks: number): string {
    // Tick 0 is dawn, which the game puts at 06:00.
    const minutes = Math.round(((ticks / 24000) * 24 * 60 + 6 * 60) % (24 * 60));
    const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
    const mm = String(minutes % 60).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  /**
   * What the theme's floor colour is right now, for the picker to start from.
   *
   * An `<input type="color">` has no empty value -- it always shows *some*
   * colour -- so with the setting empty it has to show the one actually being
   * drawn, or opening Settings would suggest the floor is black.
   */
  const themeGround = $derived.by(() => {
    void open;
    if (typeof document === "undefined") return "#161d27";
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue("--viewport-ground")
      .trim();
    return value === "" ? "#161d27" : value;
  });

  /** Whether the token is shown in the clear. Off every time the modal opens. */
  let revealed = $state(false);
  /** Which field was last copied, so the button can say so briefly. */
  let copied = $state<"url" | "token" | "command" | "bridge" | null>(null);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    // Re-masked whenever the modal is closed: a token left revealed would still
    // be on screen the next time this pane is opened, which is the one place it
    // could be read by somebody standing behind you.
    if (!open) revealed = false;
  });

  let stutterNote = $state<string | null>(null);

  /*
   * The GPU is chosen at launch, so the pane compares the setting with what
   * main says this process was started with -- main's answer, because the
   * setting on screen may already have moved -- and with what Chromium
   * reports drawing with, which is the only answer that is not a wish.
   * Asked each time the pane opens: the first answer may still be reading
   * the adapter list.
   */
  let gpu = $state<GpuStatus | null>(null);
  $effect(() => {
    if (!open) return;
    void api()
      .getGpuStatus()
      .then((status) => (gpu = status))
      .catch(() => undefined);
  });
  function adapterName(key: string | null): string | null {
    if (key === null) return null;
    return gpu?.adapters?.find((adapter) => adapter.key === key)?.name ?? null;
  }
  function gpuLabel(pref: GpuPreference): string {
    const base =
      pref === "high-performance"
        ? t("preview.gpuPreference.highPerformance")
        : pref === "low-power"
          ? t("preview.gpuPreference.lowPower")
          : t("preview.gpuPreference.auto");
    const lands = adapterName(
      pref === "high-performance" ? (gpu?.highPerformance ?? null) : pref === "low-power" ? (gpu?.lowPower ?? null) : null,
    );
    return lands === null ? base : `${base} — ${lands}`;
  }
  /*
   * Where the cards can be listed and chosen, the list is the cards: the two
   * presets would only name one of them a second time. A preset stored before
   * that is shown as the card it lands on, and stays stored until changed.
   */
  const gpuChoosable = $derived(gpu?.choosable === true && (gpu.adapters?.length ?? 0) > 0);
  const gpuSelectValue = $derived.by(() => {
    const { gpuPreference: pref, gpuAdapter } = settings.preview;
    if (!gpuChoosable || gpuAdapter !== null || pref === "auto") return choiceValue(pref, gpuAdapter);
    const lands = pref === "high-performance" ? gpu?.highPerformance : pref === "low-power" ? gpu?.lowPower : null;
    return lands ? choiceValue(null, lands) : "auto";
  });
  const gpuRestart = $derived(
    gpu !== null && gpuNeedsRestart(settings.preview.gpuPreference, settings.preview.gpuAdapter, gpu.launch),
  );
  /*
   * What a frame costs in pixels, so 12 million pixels times eight samples is
   * visible without a stutter report. The viewport is most of the window, so
   * the window's size stands in for it.
   */
  const loadMegapixels = $derived(
    pixelLoad(
      window.innerWidth,
      window.innerHeight,
      window.devicePixelRatio,
      settings.preview.maxDpr,
      settings.preview.renderScale,
    ) / 1e6,
  );

  /** The levels-of-detail settings, read the way main and the viewer read them. */
  const lod = $derived(lodSettings(settings.preview));

  function lodModeLabel(mode: LodMode): string {
    if (mode === "off") return t("preview.lodMode.off");
    if (mode === "auto") return t("preview.lodMode.auto");
    return t("preview.lodMode.always");
  }

  function lodPixelsLabel(pixels: number): string {
    if (pixels === 1) return t("preview.lodPixels.1");
    if (pixels === 2) return t("preview.lodPixels.2");
    if (pixels === 4) return t("preview.lodPixels.4");
    return t("preview.lodPixels.8");
  }

  /** A triangle count as people say it: 42 k, 1.5 M. Truncated, never rounded up. */
  function triangleCount(count: number): string {
    if (count >= 1e6) return `${Math.floor(count / 1e5) / 10} M`;
    if (count >= 1e3) return `${Math.floor(count / 1e3)} k`;
    return String(count);
  }

  const lodStatusLine = $derived.by(() => {
    if (lodStatus === null) return t("preview.lodStatus.none");
    const triangles = triangleCount(lodStatus.triangles);
    if (lodStatus.state === "off") return t("preview.lodStatus.off", { triangles });
    if (lodStatus.state === "below") {
      return t("preview.lodStatus.below", { triangles, threshold: triangleCount(lod.autoTriangles) });
    }
    if (lodStatus.state === "pending") return t("preview.lodStatus.pending", { triangles });
    return t("preview.lodStatus.ready", { triangles });
  });

  async function copyStutterReport(): Promise<void> {
    const report = stutterReport();
    if (report === null) {
      stutterNote = t("preview.stutterReportEmpty");
      return;
    }
    /*
     * The GPU as main sees it, beside the renderer string the viewer reads.
     * `settings.gpuPreference` alone is the choice on screen, which cannot
     * tell "not restarted yet" from "asked for and ignored"; these can.
     */
    const status = gpu ?? (await api().getGpuStatus().catch(() => null));
    const context = typeof report.context === "object" && report.context !== null ? report.context : {};
    const full = {
      ...report,
      context: {
        ...context,
        gpuChoice: { preference: settings.preview.gpuPreference, adapter: settings.preview.gpuAdapter },
        gpuLaunch: status?.launch ?? null,
        gpuActive: status?.active ?? null,
        gpuHonoured: status?.honoured ?? null,
      },
    };
    await api().copyToClipboard(JSON.stringify(full, null, 2));
    const spikes = Array.isArray(report.spikes) ? report.spikes.length : 0;
    stutterNote = t("preview.stutterReportCopied", { count: spikes });
  }

  async function copy(what: "url" | "token" | "command" | "bridge", value: string): Promise<void> {
    if (value === "") return;
    await api().copyToClipboard(value);
    copied = what;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copied = null), 1500);
  }

  /*
   * The token is no longer required for there to be a command: with
   * authentication off there is a perfectly good one, it simply carries no
   * `--header`. Gating on the token emptied this field in the one
   * configuration where somebody most needs to see what they are serving.
   */
  const command = $derived(
    mcpStatus?.url ? connectCommand(mcpStatus.url, mcpStatus.token) : "",
  );
  /*
   * The same, for a client that will not speak HTTP.
   *
   * Shown beside the HTTP one rather than instead of it: some clients take
   * either, and the HTTP form is one fewer process. The bridge is here because
   * some take only stdio, and without this line it would be a file in the
   * install directory that nobody could be expected to find.
   */
  const bridge = $derived(mcpStatus?.bridge ? bridgeCommand(mcpStatus.bridge) : "");

  /*
   * The same rules main enforces, mirrored rather than reinvented -- the
   * arrangement `openCodeModelRequiresKey` and the era rule already have. A
   * renderer deciding this for itself would be a second answer to a question
   * that has one, and the two would drift.
   */
  const bindProblem = $derived(bindAddressRefusal(settings.mcp.bindAddress));
  const onLoopback = $derived(isLoopbackAddress(settings.mcp.bindAddress));

  /*
   * The development-builds box, drawn from what it means right now rather than
   * from the stored value: on a `-dev` build that nobody has touched it is
   * ticked, because that is what the check does. The first change writes a
   * real boolean, and from then on the box means what it says.
   */
  const includeDevBuilds = $derived(
    effectiveIncludeDevBuilds(settings.updates, updateStatus?.currentVersion ?? ""),
  );
  const updateBusy = $derived(
    updateStatus?.state === "checking" || updateStatus?.state === "downloading",
  );

  /*
   * Download only where this copy can replace itself *and* the release
   * carries what it needs to. Everywhere else the same row offers the page:
   * a button that can only fail is worse than a link that works.
   */
  const canDownload = $derived(
    updateStatus !== null &&
      updateStatus.inApp &&
      updateStatus.latest !== null &&
      updateStatus.latest.installable &&
      (updateStatus.state === "available" || updateStatus.state === "error"),
  );

  const updateLabel = $derived.by(() => {
    const status = updateStatus;
    switch (status?.state) {
      case "checking":
        return t("updates.state.checking");
      case "upToDate":
        return t("updates.state.upToDate");
      case "available":
        return t(
          status.latest?.prerelease ? "updates.state.availableDev" : "updates.state.available",
          { version: status.latest?.version ?? "" },
        );
      case "downloading":
        return t("updates.state.downloading", {
          percent: String(Math.round(status.progress?.percent ?? 0)),
        });
      case "ready":
        return t("updates.state.ready", { version: status.latest?.version ?? "" });
      // Main's own sentence, which is the one that says what went wrong.
      case "error":
        return status.message ?? t("updates.state.error");
      default:
        return t("updates.state.idle");
    }
  });

  /*
   * Why this copy offers a page rather than a download, in words -- and only
   * while there is a release on offer, since with nothing to install there is
   * nothing to explain.
   */
  const manualReason = $derived.by(() => {
    const status = updateStatus;
    if (status === null || status.latest === null) return null;
    if (!status.inApp) return t(`updates.manual.${status.kind}`);
    return status.latest.installable ? null : t("updates.manual.metadata");
  });

  /*
   * The state in words.
   *
   * An error carries main's own message, which is not translated -- it arrives
   * already phrased, like every other `Failure.message`, and it is the one that
   * names the port. The generic key is the fallback for an error with nothing
   * to say.
   */
  const stateLabel = $derived.by(() => {
    switch (dotFor(mcpStatus)) {
      case "active":
        // The count *is* the state here, so it is said once rather than beside
        // a label that says the same thing less precisely.
        return tn("mcp.clients", mcpStatus?.clients ?? 0);
      case "listening":
        return t("mcp.stateListening");
      // Said in words as well as painted on the dot: a colour only means
      // something to somebody who already knows what it means.
      case "unauthenticated":
        return t("mcp.stateUnauthenticated");
      case "error":
        return mcpStatus?.message ?? t("mcp.stateError");
      case "starting":
        return t("mcp.stateStarting");
      default:
        return t("mcp.stateOff");
    }
  });

  /*
   * The rail: four groups, in the order they are reached for. What changes
   * how the build looks comes before what changes how fast it is drawn, and
   * both before the connections, which are set once.
   */
  const RAIL: readonly { key: string; entries: readonly { id: Category; key: string }[] }[] = [
    {
      key: "settings.group.app",
      entries: [
        { id: "general", key: "settings.general" },
        { id: "updates", key: "settings.updates" },
      ],
    },
    {
      key: "settings.group.viewport",
      entries: [
        { id: "scene", key: "settings.scene" },
        { id: "lighting", key: "settings.lighting" },
        { id: "textures", key: "settings.textures" },
      ],
    },
    {
      key: "settings.group.performance",
      entries: [
        { id: "performance", key: "settings.performance" },
        { id: "lod", key: "settings.lod" },
        { id: "diagnostics", key: "settings.diagnostics" },
      ],
    },
    {
      key: "settings.group.connections",
      entries: [
        { id: "providers", key: "settings.providers" },
        { id: "mcp", key: "settings.mcp" },
      ],
    },
  ];

  let category = $state<Category>("general");

  const paneTitle = $derived(
    RAIL.flatMap((group) => group.entries).find((entry) => entry.id === category)?.key ?? "settings.title",
  );

  /*
   * Opening on a named pane, when the caller had one in mind.
   *
   * The MCP indicator opens this modal to say something about the MCP server,
   * and landing on General would make it a button that appears to do nothing.
   * Only while `open`, so choosing a pane by hand is not overwritten on the next
   * paint; `startOn` is cleared by the caller on close.
   */
  $effect(() => {
    if (open && startOn !== null) category = startOn;
  });

  const preview = $derived(settings.preview);

  const num = (event: Event) => Number((event.currentTarget as HTMLInputElement).value);
</script>

<!--
  The rows every pane is made of. Declared out here, not inside the dialog: a
  snippet that is a direct child of a component is passed to it as a prop.
-->
{#snippet mesh()}
  <span class="rebuilds pixel" title={t("settings.rebuildsTitle")}>{t("settings.rebuilds")}</span>
{/snippet}

{#snippet toggle(
  label: string,
  value: boolean,
  set: (value: boolean) => void,
  hint: string | null = null,
  disabled: boolean = false,
  rebuilds: boolean = false,
)}
  <div class="toggle">
    <label class="check">
      <input type="checkbox" checked={value} {disabled} onchange={(event) => set(event.currentTarget.checked)} />
      <span>{label}</span>
      {#if rebuilds}{@render mesh()}{/if}
    </label>
    {#if hint !== null}<p class="hint">{hint}</p>{/if}
  </div>
{/snippet}

{#snippet slider(
  id: string,
  label: string,
  shown: string,
  range: { min: number; max: number; step: number },
  value: number,
  set: (value: number) => void,
  hint: string | null = null,
)}
  <!-- The name and the value apart: `.slider-head` in app.css says why. -->
  <div class="field">
    <div class="slider-head">
      <label for={id}>{label}</label>
      <output for={id}>{shown}</output>
    </div>
    <input
      {id}
      type="range"
      min={range.min}
      max={range.max}
      step={range.step}
      {value}
      aria-valuetext={shown}
      oninput={(event) => set(num(event))}
    />
    {#if hint !== null}<p class="hint">{hint}</p>{/if}
  </div>
{/snippet}

<Modal {open} title={t("settings.title")} {onclose} width={880} height={640} flush>
  <div class="layout">
    <nav class="rail" aria-label={t("settings.title")}>
      {#each RAIL as group (group.key)}
        <p class="group pixel">{t(group.key)}</p>
        {#each group.entries as entry (entry.id)}
          <button
            class="rail-item"
            class:active={category === entry.id}
            aria-current={category === entry.id ? "page" : undefined}
            onclick={() => (category = entry.id)}
          >
            {t(entry.key)}
          </button>
        {/each}
      {/each}
    </nav>

    <div class="pane">
      <h3 class="pane-title">{t(paneTitle)}</h3>

      {#if category === "general"}
        <section>
          <h4>{t("settings.appearance")}</h4>
          <div class="field">
            <label for="theme">{t("settings.theme")}</label>
            <select
              id="theme"
              value={settings.ui.theme}
              onchange={(event) => onuichange({ theme: event.currentTarget.value as Theme })}
            >
              {#each THEMES as theme (theme)}
                <option value={theme}>{t(`settings.theme.${theme}`)}</option>
              {/each}
            </select>
            <p class="hint">{t("settings.themeHint")}</p>
          </div>

          <div class="field">
            <label for="language">{t("settings.language")}</label>
            <select
              id="language"
              value={settings.ui.language}
              onchange={(event) => onuichange({ language: event.currentTarget.value as Language })}
            >
              {#each LANGUAGES as language (language)}
                <option value={language}>{t(`settings.language.${language}`)}</option>
              {/each}
            </select>
            <p class="hint">{t("settings.languageHint")}</p>
          </div>
        </section>

        <section>
          <h4>{t("settings.schematic")}</h4>
          <div class="field">
            <label for="target-version">{t("settings.version")}</label>
            <select
              id="target-version"
              value={settings.version}
              onchange={(event) => onchange({ version: event.currentTarget.value })}
            >
              {#each versions as version (version)}
                <!-- The label a player knows, not the table's key: 26.2, not JE_26_2. -->
                <option value={version}>{mcVersion(version)?.label ?? version}</option>
              {/each}
            </select>
            <p class="hint">{t("settings.versionHint")}</p>
          </div>

          <div class="field">
            <label for="output-dir">{t("settings.outputDir")}</label>
            <div class="pick-row">
              <input
                id="output-dir"
                readonly
                value={settings.outputDir}
                placeholder={defaultOutputDir}
                title={settings.outputDir || defaultOutputDir}
              />
              <button onclick={onpickoutputdir} disabled={busy}>{t("common.choose")}</button>
              <button onclick={() => onchange({ outputDir: "" })} disabled={busy || settings.outputDir === ""}>
                {t("settings.outputDefault")}
              </button>
              <!-- The way to find a generated .mcfunction, which is the one
                   output the app never opens for you. -->
              <button onclick={onrevealoutputdir}>{t("common.open")}</button>
            </div>
            <p class="hint">{t("settings.outputHint")}</p>
          </div>
        </section>
      {:else if category === "scene"}
        <section>
          <h4>{t("settings.section.sky")}</h4>
          {@render toggle(t("preview.sky"), preview.sky, (sky) => onpreviewchange({ sky }), t("preview.skyHint"))}

          {#if preview.sky}
            {@render slider(
              "time-of-day",
              t("preview.timeOfDay"),
              clockLabel(preview.timeOfDay),
              PREVIEW_SETTING_RANGES.timeOfDay,
              preview.timeOfDay,
              (timeOfDay) => onpreviewchange({ timeOfDay }),
              t("preview.timeOfDayHint"),
            )}
            {@render toggle(t("preview.daylightCycle"), preview.daylightCycle, (daylightCycle) =>
              onpreviewchange({ daylightCycle }),
            )}
            {#if preview.daylightCycle}
              {@render slider(
                "daylight-speed",
                t("preview.daylightSpeed"),
                t("unit.gameMinutesPerSecond", { value: preview.daylightSpeed.toFixed(0) }),
                PREVIEW_SETTING_RANGES.daylightSpeed,
                preview.daylightSpeed,
                (daylightSpeed) => onpreviewchange({ daylightSpeed }),
              )}
            {/if}
          {:else}
            <!--
              With no sky there is no hour, so the light is placed by hand.
              Shown here rather than always, because with the sky on the sun's
              elevation is the time of day and two answers to that would be one
              too many.
            -->
            {@render slider(
              "sun-az",
              t("preview.sunAzimuth"),
              t("unit.degrees", { value: preview.sunAzimuthDeg.toFixed(0) }),
              PREVIEW_SETTING_RANGES.sunAzimuthDeg,
              preview.sunAzimuthDeg,
              (sunAzimuthDeg) => onpreviewchange({ sunAzimuthDeg }),
            )}
            {@render slider(
              "sun-el",
              t("preview.sunElevation"),
              t("unit.degrees", { value: preview.sunElevationDeg.toFixed(0) }),
              PREVIEW_SETTING_RANGES.sunElevationDeg,
              preview.sunElevationDeg,
              (sunElevationDeg) => onpreviewchange({ sunElevationDeg }),
            )}
          {/if}
        </section>

        <!--
          The floor. Nothing to do with the schematic -- it is not a block and
          is never saved -- but a build with nothing under it floats, and
          every shadow it casts falls into nothing and is invisible.
        -->
        <section>
          <h4>{t("settings.section.floor")}</h4>
          {@render toggle(t("preview.ground"), preview.ground, (ground) => onpreviewchange({ ground }), t("preview.groundHint"))}
          {#if preview.ground}
            <div class="field">
              <label for="ground-color">{t("preview.groundColor")}</label>
              <div class="pick-row">
                <input
                  id="ground-color"
                  class="swatch"
                  type="color"
                  value={preview.groundColor === "" ? themeGround : preview.groundColor}
                  oninput={(event) => onpreviewchange({ groundColor: event.currentTarget.value })}
                />
                <!--
                  Empty is not a colour, it is "whichever the theme says" -- so
                  there has to be a way back to it once a colour has been
                  picked, or the light theme keeps a dark floor for ever with
                  nothing on screen to say why.
                -->
                <button onclick={() => onpreviewchange({ groundColor: "" })} disabled={preview.groundColor === ""}>
                  {t("preview.groundFollowTheme")}
                </button>
              </div>
            </div>
          {/if}
          {@render toggle(t("preview.showGrid"), preview.showGrid, (showGrid) => onpreviewchange({ showGrid }))}
        </section>

        <section>
          <h4>{t("settings.section.camera")}</h4>
          {@render slider(
            "fly-speed",
            t("preview.flySpeed"),
            t("unit.blocksPerSecond", { value: preview.flySpeed.toFixed(0) }),
            PREVIEW_SETTING_RANGES.flySpeed,
            preview.flySpeed,
            (flySpeed) => onpreviewchange({ flySpeed }),
          )}
        </section>
      {:else if category === "lighting"}
        <!--
          Presets rather than shader packs: the renderer opens no connection
          of any kind, so there is nothing to download and no safe way to run
          GLSL somebody sent you. Each one is a bundle of renderer and light
          state, and `vanilla` is the identity.
        -->
        <div class="field">
          <label for="shader-mode">{t("preview.shaderMode")}</label>
          <select
            id="shader-mode"
            value={preview.shaderMode}
            onchange={(event) => onpreviewchange({ shaderMode: event.currentTarget.value as ShaderMode })}
          >
            {#each SHADER_MODES as mode (mode)}
              <option value={mode}>{t(`preview.shaderMode.${mode}`)}</option>
            {/each}
          </select>
          <p class="hint">{t(`preview.shaderMode.${preview.shaderMode}.hint`)}</p>
        </div>

        <section>
          <h4>{t("settings.section.sun")}</h4>
          {@render toggle(t("preview.shadows"), preview.shadows, (shadows) => onpreviewchange({ shadows }), t("preview.shadowsHint"))}
          {#if preview.shadows}
            <div class="field nested">
              <label for="shadow-quality">{t("preview.shadowQuality")}</label>
              <select
                id="shadow-quality"
                value={String(preview.shadowQuality)}
                onchange={(event) => onpreviewchange({ shadowQuality: Number(event.currentTarget.value) })}
              >
                {#each SHADOW_QUALITIES as size (size)}
                  <option value={String(size)}>{size}&#xd7;{size}</option>
                {/each}
              </select>
            </div>
          {/if}
          <!--
            Disabled rather than hidden where the sky is off, and it says which
            of the two it needs. The environment *is* the sky dome, so there is
            genuinely nothing to gather light from -- and a control that came
            and went with a checkbox above it would be one nobody ever learns
            is there. Same reason the impossible versions are shown disabled.
          -->
          {@render toggle(
            t("preview.globalIllumination"),
            preview.globalIllumination,
            (globalIllumination) => onpreviewchange({ globalIllumination }),
            preview.sky ? t("preview.globalIlluminationHint") : t("preview.globalIlluminationNeedsSky"),
            !preview.sky,
          )}
        </section>

        <!--
          The three that reach the mesher rather than the viewer, which is why
          they carry the badge: turning one on or off rebuilds the mesh.
        -->
        <section>
          <h4>{t("settings.section.blocks")}</h4>
          {@render toggle(
            t("preview.blockLight"),
            preview.blockLight,
            (blockLight) => onpreviewchange({ blockLight }),
            t("preview.blockLightHint"),
            false,
            true,
          )}
          {@render toggle(
            t("preview.smoothLighting"),
            preview.smoothLighting,
            (smoothLighting) => onpreviewchange({ smoothLighting }),
            t("preview.smoothLightingHint"),
            false,
            true,
          )}
          {@render toggle(
            t("preview.ambientOcclusion"),
            preview.ambientOcclusion,
            (ambientOcclusion) => onpreviewchange({ ambientOcclusion }),
            t("preview.ambientOcclusionHint"),
            false,
            true,
          )}
        </section>
      {:else if category === "textures"}
        <div class="field">
          <label for="resource-pack">{t("preview.resourcePack")} {@render mesh()}</label>
          <div class="pick-row">
            <input
              id="resource-pack"
              readonly
              value={resourcePackName ?? ""}
              placeholder={t("preview.resourcePackPlaceholder")}
            />
            <button onclick={onpickresourcepack} disabled={busy}>{t("common.choose")}</button>
            <button onclick={onclearresourcepack} disabled={busy || !resourcePackPath}>
              {t("common.reset")}
            </button>
          </div>
          <p class="hint">{t("preview.resourcePackHint")}</p>
        </div>

        <div class="field">
          <label for="biome-color">{t("preview.biomeColors")} {@render mesh()}</label>
          <div class="pick-row">
            <input
              id="biome-color"
              class="swatch"
              type="color"
              title={t("preview.foliage")}
              aria-label={t("preview.foliage")}
              value={preview.biomeColor}
              oninput={(event) => onpreviewchange({ biomeColor: event.currentTarget.value })}
            />
            <input
              id="water-color"
              class="swatch"
              type="color"
              title={t("preview.water")}
              aria-label={t("preview.water")}
              value={preview.waterColor}
              oninput={(event) => onpreviewchange({ waterColor: event.currentTarget.value })}
            />
            <button
              onclick={() => onpreviewchange({ biomeColor: DEFAULT_BIOME_COLOR, waterColor: DEFAULT_WATER_COLOR })}
              disabled={preview.biomeColor.toLowerCase() === DEFAULT_BIOME_COLOR &&
                preview.waterColor.toLowerCase() === DEFAULT_WATER_COLOR}
            >
              {t("preview.plains")}
            </button>
          </div>
          <p class="hint">{t("preview.biomeHint")}</p>
        </div>

        <!--
          Not a viewer toggle: main turns them back into air, because a
          barrier that is drawn has to stop culling its neighbours and that
          is a meshing decision. Changing it rebuilds.
        -->
        {@render toggle(
          t("preview.showMarkers"),
          preview.showMarkers,
          (showMarkers) => onpreviewchange({ showMarkers }),
          t("preview.showMarkersHint"),
          false,
          true,
        )}
      {:else if category === "performance"}
        <p class="hint lead">{t("settings.qualityHint")}</p>

        <section>
          <h4>{t("settings.section.card")}</h4>
          <div class="field">
            <label for="gpu-preference">{t("preview.gpuPreference")}</label>
            <select
              id="gpu-preference"
              value={gpuSelectValue}
              onchange={(event) => onpreviewchange(parseChoiceValue(event.currentTarget.value))}
            >
              {#each gpuChoosable ? (["auto"] as const) : GPU_PREFERENCES as pref (pref)}
                <option value={pref}>{gpuLabel(pref)}</option>
              {/each}
              {#if gpuChoosable && gpu?.adapters}
                {#each gpu.adapters as adapter (adapter.key)}
                  <option value={choiceValue(null, adapter.key)}>
                    {[adapter.name, formatMemory(adapter.dedicatedMemory)].filter((part) => part !== "").join(" · ")}
                  </option>
                {/each}
              {/if}
            </select>
            <p class="hint">{t("preview.gpuPreferenceHint")}</p>
            {#if gpu?.active}
              <p class="hint">
                {t("preview.gpuInUse", { name: adapterName(gpu.active.adapter) ?? gpu.active.renderer })}
              </p>
            {/if}
            {#if gpu && !gpu.choosable && gpu.adapters && gpu.adapters.length > 1}
              <p class="hint">
                {t("preview.gpuDetected", { names: gpu.adapters.map((adapter) => adapter.name).join(", ") })}
              </p>
            {/if}
            {#if gpu?.honoured === false}
              <p class="callout warn">{t("preview.gpuNotHonoured", { name: gpu.launch.adapterName ?? "" })}</p>
            {:else if gpu?.launch.note === "adapter-missing"}
              <p class="callout warn">{t("preview.gpuAdapterMissing")}</p>
            {:else if gpu?.launch.note === "enumeration-failed"}
              <p class="callout warn">{t("preview.gpuEnumerationFailed")}</p>
            {/if}
            {#if gpuRestart}
              <button class="primary restart" type="button" onclick={() => void api().relaunchApp()}>
                {t("preview.gpuPreferenceRestart")}
              </button>
            {/if}
          </div>
        </section>

        <section>
          <h4>{t("settings.section.resolution")}</h4>
          <!--
            Live, which is the whole reason it is not the context's own
            `antialias` flag: that one is fixed for the life of the WebGL
            context, so a setting built on it would do nothing until the app
            was restarted.
          -->
          <div class="field">
            <label for="antialias">{t("preview.antialias")}</label>
            <select
              id="antialias"
              value={String(preview.antialias)}
              onchange={(event) => onpreviewchange({ antialias: Number(event.currentTarget.value) })}
            >
              {#each AA_LEVELS as level (level)}
                <option value={String(level)}>
                  {level === 0 ? t("preview.antialias.off") : `${level}× MSAA`}
                </option>
              {/each}
            </select>
            <p class="hint">{t("preview.antialiasHint")}</p>
          </div>
          {@render slider(
            "render-scale",
            t("preview.renderScale"),
            t("unit.times", { value: preview.renderScale.toFixed(1) }),
            PREVIEW_SETTING_RANGES.renderScale,
            preview.renderScale,
            (renderScale) => onpreviewchange({ renderScale }),
          )}
          {@render slider(
            "max-dpr",
            t("preview.maxDpr"),
            preview.maxDpr.toFixed(1),
            PREVIEW_SETTING_RANGES.maxDpr,
            preview.maxDpr,
            (maxDpr) => onpreviewchange({ maxDpr }),
            t("preview.pixelLoad", {
              pixels: loadMegapixels.toFixed(1),
              samples: Math.max(1, preview.antialias),
            }),
          )}
        </section>

        <section>
          <h4>{t("settings.section.frames")}</h4>
          <div class="field">
            <label for="max-fps">{t("preview.maxFps")}</label>
            <select
              id="max-fps"
              value={String(fpsCap(preview.maxFps))}
              onchange={(event) => onpreviewchange({ maxFps: Number(event.currentTarget.value) })}
            >
              {#each FPS_CAPS as cap (cap)}
                <option value={String(cap)}>
                  {cap === 0 ? t("preview.maxFps.off") : `${cap} FPS`}
                </option>
              {/each}
            </select>
            <p class="hint">{t("preview.maxFpsHint")}</p>
          </div>
          {@render slider(
            "max-distance",
            t("preview.maxDrawDistance"),
            t("unit.blocks", { value: preview.maxDrawDistance.toFixed(0) }),
            PREVIEW_SETTING_RANGES.maxDrawDistance,
            preview.maxDrawDistance,
            (maxDrawDistance) => onpreviewchange({ maxDrawDistance }),
          )}
        </section>
      {:else if category === "lod"}
        <!--
          What the open schematic is doing with these, first: it is the answer
          to "why does this build have none", and it was the last line of the
          pane, under six controls.
        -->
        <p class="callout lod-status" role="status">{lodStatusLine}</p>

        <div class="field">
          <label for="lod-mode">{t("preview.lodMode")}</label>
          <select
            id="lod-mode"
            value={lod.mode}
            onchange={(event) => onpreviewchange({ lodMode: event.currentTarget.value as LodMode })}
          >
            {#each LOD_MODES as mode (mode)}
              <option value={mode}>{lodModeLabel(mode)}</option>
            {/each}
          </select>
          <p class="hint">{t("preview.lodModeHint")}</p>
        </div>
        <div class="field">
          <label for="lod-pixels">{t("preview.lodPixels")}</label>
          <select
            id="lod-pixels"
            value={String(lod.pixels)}
            disabled={lod.mode === "off"}
            onchange={(event) => onpreviewchange({ lodPixels: Number(event.currentTarget.value) })}
          >
            {#each LOD_PIXELS as pixels (pixels)}
              <option value={String(pixels)}>{lodPixelsLabel(pixels)}</option>
            {/each}
          </select>
          <p class="hint">{t("preview.lodPixelsHint")}</p>
        </div>
        <!--
          Disabled outside Automatic rather than hidden, the impossible
          versions' rule: a control that vanishes is one nobody learns exists.
        -->
        <div class="field">
          <div class="slider-head">
            <label for="lod-auto">{t("preview.lodAutoTriangles")}</label>
            <output for="lod-auto">{t("unit.triangles", { value: triangleCount(lod.autoTriangles) })}</output>
          </div>
          <input
            id="lod-auto"
            type="range"
            aria-valuetext={t("unit.triangles", { value: triangleCount(lod.autoTriangles) })}
            min={LOD_AUTO_TRIANGLES.min}
            max={LOD_AUTO_TRIANGLES.max}
            step={LOD_AUTO_TRIANGLES.step}
            value={lod.autoTriangles}
            disabled={lod.mode !== "auto"}
            oninput={(event) => onpreviewchange({ lodAutoTriangles: num(event) })}
          />
          <p class="hint">{t("preview.lodAutoTrianglesHint")}</p>
        </div>
        {@render toggle(
          t("preview.lodShapes"),
          lod.shapes,
          (shapes) => onpreviewchange({ lodShapes: shapes }),
          t("preview.lodShapesHint"),
          lod.mode === "off",
        )}
        {@render toggle(
          t("preview.lodCoarse"),
          lod.coarse,
          (coarse) => onpreviewchange({ lodCoarse: coarse }),
          t("preview.lodCoarseHint"),
          lod.mode === "off",
        )}
        {@render toggle(t("preview.lodTint"), lod.tint, (tint) => onpreviewchange({ lodTint: tint }), null, lod.mode === "off")}
        <!-- The colours the viewport mixes each level towards, from `lod.ts`'s own table. -->
        <p class="hint lod-legend">
          <span class="lod-swatch" style:background={tintColour("lod1")}></span>{t("preview.lodTint.shapes")}
          <span class="lod-swatch" style:background={tintColour("lod2")}></span>{t("preview.lodTint.coarse2")}
          <span class="lod-swatch" style:background={tintColour("lod3")}></span>{t("preview.lodTint.coarse3")}
        </p>
      {:else if category === "diagnostics"}
        <p class="hint lead">{t("settings.diagnosticsHint")}</p>
        {@render toggle(t("preview.showFps"), preview.showFps, (showFps) => onpreviewchange({ showFps }), t("preview.showFpsHint"))}
        {@render toggle(t("preview.wireframe"), preview.wireframe, (wireframe) => onpreviewchange({ wireframe }), t("preview.wireframeHint"))}
        <!--
          The report is built by the viewer, which registers it while it is
          diagnosing; the pane only asks for it. See `frame_profiler.ts`.
        -->
        {@render toggle(
          t("preview.frameDiagnostics"),
          preview.frameDiagnostics,
          (frameDiagnostics) => onpreviewchange({ frameDiagnostics }),
          t("preview.frameDiagnosticsHint"),
        )}
        <div class="field report">
          <button type="button" onclick={() => void copyStutterReport()}>
            {t("preview.copyStutterReport")}
          </button>
          {#if stutterNote}
            <p class="hint" role="status">{stutterNote}</p>
          {/if}
        </div>
        {@render toggle(
          t("preview.alwaysDraw"),
          preview.alwaysDraw,
          (alwaysDraw) => onpreviewchange({ alwaysDraw }),
          t("preview.alwaysDrawHint"),
        )}
      {:else if category === "mcp"}
        <section>
          <h4>{t("settings.section.server")}</h4>
          {@render toggle(t("mcp.enable"), settings.mcp.enabled, (enabled) => onmcpenabled(enabled), t("mcp.enableHint"), busy)}

          <!--
            The status is main's, not the checkbox's. They disagree exactly when
            it matters — a port already held by a second copy of the app — and
            that disagreement is the thing this row exists to show.
          -->
          <div class="field">
            <span class="label">{t("mcp.status")}</span>
            <p class="state">
              <span class="dot" style={`background: var(${dotColor(dotFor(mcpStatus))})`}></span>
              <span>{stateLabel}</span>
            </p>
          </div>

          <!--
            A line of its own rather than a clause inside the state.

            It used to be the *label* of the `active` state, which meant the
            unauthenticated state displaced it -- a warning arrived and the
            count silently left. Two facts, two lines: what the server is doing,
            and how many clients are on it.
          -->
          {#if mcpStatus !== null && mcpStatus.state === "listening"}
            <div class="field">
              <span class="label">{t("mcp.clients")}</span>
              <p class="state">{tn("mcp.clients", mcpStatus.clients)}</p>
            </div>
          {/if}
        </section>

        {#if mcpStatus?.url}
          <section>
            <h4>{t("settings.section.connect")}</h4>
            <div class="field">
              <label for="mcp-url">{t("mcp.url")}</label>
              <div class="pick-row">
                <input id="mcp-url" class="mono" readonly value={mcpStatus.url} />
                <button onclick={() => copy("url", mcpStatus?.url ?? "")}>
                  {copied === "url" ? t("mcp.copied") : t("mcp.copy")}
                </button>
              </div>
            </div>

            <!--
              Shown from the **setting**, not from the status.

              This is the pane where the token is configured, and the intent is
              what is being configured: tick the box and you need the string
              immediately, whatever the listener has caught up to. Keyed on the
              status it vanished the moment authentication was turned off and
              did not come back when it was turned on again, because nothing
              restarted the listener -- the dot is where reality belongs.
            -->
            {#if settings.mcp.requireAuth}
              <div class="field">
                <label for="mcp-token">{t("mcp.token")}</label>
                <div class="pick-row">
                  <input
                    id="mcp-token"
                    class="mono"
                    readonly
                    value={revealed ? (mcpStatus.token ?? "") : maskToken(mcpStatus.token)}
                  />
                  <!--
                    Icons, with the words in `title` and `aria-label`: a glyph is
                    not a label, and three of them in a row would otherwise be
                    three buttons nobody can tell apart from a screen reader.
                  -->
                  <button
                    class="icon"
                    onclick={() => (revealed = !revealed)}
                    title={revealed ? t("mcp.hide") : t("mcp.reveal")}
                    aria-label={revealed ? t("mcp.hide") : t("mcp.reveal")}
                  >
                    <Icon name={revealed ? "eyeOff" : "eye"} />
                  </button>
                  <button
                    class="icon"
                    onclick={() => copy("token", mcpStatus?.token ?? "")}
                    title={copied === "token" ? t("mcp.copied") : t("mcp.copy")}
                    aria-label={t("mcp.copy")}
                  >
                    <Icon name={copied === "token" ? "check" : "copy"} />
                  </button>
                  <button
                    class="icon"
                    onclick={onmcpregenerate}
                    disabled={busy}
                    title={t("mcp.regenerate")}
                    aria-label={t("mcp.regenerate")}
                  >
                    <Icon name="rotate" />
                  </button>
                </div>
                <p class="hint">{t("mcp.tokenHint")}</p>
              </div>
            {/if}

            <div class="field">
              <label for="mcp-command">{t("mcp.command")}</label>
              <div class="pick-row">
                <input id="mcp-command" class="mono" readonly value={command} title={command} />
                <button onclick={() => copy("command", command)}>
                  {copied === "command" ? t("mcp.copied") : t("mcp.copy")}
                </button>
              </div>
              <p class="hint">{t("mcp.commandHint")}</p>
            </div>

            {#if bridge !== ""}
              <div class="field">
                <label for="mcp-bridge">{t("mcp.bridge")}</label>
                <div class="pick-row">
                  <input id="mcp-bridge" class="mono" readonly value={bridge} title={bridge} />
                  <button onclick={() => copy("bridge", bridge)}>
                    {copied === "bridge" ? t("mcp.copied") : t("mcp.copy")}
                  </button>
                </div>
                <p class="hint">{t("mcp.bridgeHint")}</p>
              </div>
            {/if}
          </section>
        {/if}

        <section>
          <h4>{t("settings.section.access")}</h4>
          <div class="field">
            <label for="mcp-bind">{t("mcp.bindAddress")}</label>
            <input
              id="mcp-bind"
              class="mono"
              value={settings.mcp.bindAddress}
              disabled={busy}
              onchange={(event) => onchange({ mcp: { ...settings.mcp, bindAddress: event.currentTarget.value } })}
            />
            {#if bindProblem !== null}
              <p class="hint bad">{bindProblem}</p>
            {:else}
              <p class="hint">{t("mcp.bindAddressHint")}</p>
            {/if}
          </div>

          <div class="field">
            <label for="mcp-port">{t("mcp.port")}</label>
            <input
              id="mcp-port"
              class="port"
              type="number"
              min={MCP_PORT.min}
              max={MCP_PORT.max}
              value={settings.mcp.port}
              onchange={(event) => onchange({ mcp: { ...settings.mcp, port: Number(event.currentTarget.value) } })}
            />
            <p class="hint">{t("mcp.portHint")}</p>
          </div>

          <!--
            Off is offered on loopback only. The two together are an anonymous
            write endpoint on somebody's files over the network, and main
            refuses to start in that state -- so the box is disabled rather
            than being a way to arrive at a server that will not run.
          -->
          <div class="toggle">
            <label class="check">
              <input
                type="checkbox"
                checked={settings.mcp.requireAuth}
                disabled={busy || !onLoopback}
                onchange={(event) => onchange({ mcp: { ...settings.mcp, requireAuth: event.currentTarget.checked } })}
              />
              <span>{t("mcp.requireAuth")}</span>
            </label>
            <p class="hint" class:warn={!settings.mcp.requireAuth}>{t("mcp.requireAuthHint")}</p>
          </div>

          <div class="field">
            <label for="mcp-root">{t("mcp.root")}</label>
            <div class="pick-row">
              <input
                id="mcp-root"
                readonly
                value={settings.mcp.root}
                placeholder={defaultOutputDir}
                title={settings.mcp.root || defaultOutputDir}
              />
              <button onclick={onpickmcproot} disabled={busy}>{t("common.choose")}</button>
              <button
                onclick={() => onchange({ mcp: { ...settings.mcp, root: "" } })}
                disabled={busy || settings.mcp.root === ""}>{t("mcp.rootDefault")}</button
              >
            </div>
            <p class="hint">{t("mcp.rootHint")}</p>
          </div>

          {@render toggle(
            t("mcp.allowDelete"),
            settings.mcp.allowDelete,
            (allowDelete) => onchange({ mcp: { ...settings.mcp, allowDelete } }),
            t("mcp.allowDeleteHint"),
            busy,
          )}
        </section>

        <!--
          Letting somebody else's model edit your build is only reasonable if
          you can see what it did. Newest first, because that is the one
          anybody is looking for.
        -->
        <section>
          <h4>{t("mcp.activity")}</h4>
          {#if mcpActivity.length === 0}
            <p class="hint">{t("mcp.activityEmpty")}</p>
          {:else}
            <ul class="activity sunken">
              {#each mcpActivity as call, index (`${call.at}-${index}`)}
                <li class:failed={!call.ok}>
                  <span class="when">{new Date(call.at).toLocaleTimeString()}</span>
                  <span class="tool">{call.tool}</span>
                  <span class="summary">{call.summary}</span>
                  <!-- In words, not only in colour: the summary of a failed
                       call is the error text, which on its own reads like an
                       unusually chatty success. -->
                  {#if !call.ok}<span class="tag">{t("mcp.activityFailed")}</span>{/if}
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      {:else if category === "updates"}
        <section>
          <h4>{t("settings.section.thisCopy")}</h4>
          <div class="field">
            <span class="label">{t("updates.installed")}</span>
            <p class="state">
              {updateStatus === null
                ? "—"
                : t("updates.installedValue", {
                    version: updateStatus.currentVersion,
                    kind: t(`updates.kind.${updateStatus.kind}`),
                  })}
            </p>
          </div>

          <div class="field">
            <span class="label">{t("updates.status")}</span>
            <p class="state">{updateLabel}</p>
            {#if updateStatus?.state === "downloading"}
              <progress class="download" max="100" value={updateStatus.progress?.percent ?? 0}></progress>
            {/if}
            {#if manualReason !== null}
              <p class="hint">{manualReason}</p>
            {/if}
            {#if updateStatus?.state === "ready"}
              <p class="hint">{t("updates.readyHint")}</p>
            {/if}
            {#if updateStatus?.checkedAt}
              <p class="hint">
                {t("updates.checkedAt", { time: new Date(updateStatus.checkedAt).toLocaleString() })}
              </p>
            {/if}
          </div>

          <div class="pick-row update-actions">
            <button onclick={oncheckupdates} disabled={updateBusy || updateStatus?.state === "ready"}>
              {t("updates.checkNow")}
            </button>
            {#if canDownload}
              <button class="primary" onclick={ondownloadupdate}>{t("updates.download")}</button>
            {/if}
            {#if updateStatus?.state === "ready"}
              <button class="primary" onclick={oninstallupdate}>{t("updates.install")}</button>
            {/if}
            <!--
              One link, to the release page, named for what it is for here: the
              download itself where this copy cannot install, the notes where
              it can. It reaches the system browser through
              `setWindowOpenHandler`, like About's links.
            -->
            {#if updateStatus?.latest}
              <a href={updateStatus.latest.pageUrl} target="_blank" rel="noreferrer">
                {manualReason !== null ? t("updates.openPage") : t("updates.notes")}
              </a>
            {/if}
          </div>
        </section>

        <section>
          <h4>{t("settings.section.checking")}</h4>
          {@render toggle(
            t("updates.checkOnStartup"),
            settings.updates.checkOnStartup,
            (checkOnStartup) => onupdateschange({ checkOnStartup }),
            t("updates.checkOnStartupHint"),
          )}
          {@render toggle(
            t("updates.includeDev"),
            includeDevBuilds,
            (includeDevBuilds) => onupdateschange({ includeDevBuilds }),
            t("updates.includeDevHint"),
            updateBusy,
          )}
        </section>
      {:else}
        <p class="hint lead">{t("settings.providersHint")}</p>
        <ApiKeysSection {settings} {keyStatus} {onchange} {onsavekey} {onclearkey} {onrevealpath} />
      {/if}
    </div>
  </div>
</Modal>

<style>
  /* The rail beside the pane, filling the dialog's body; each scrolls alone. */
  .layout {
    flex: 1 1 auto;
    display: grid;
    grid-template-columns: 200px minmax(0, 1fr);
    min-height: 0;
    border-top: var(--bevel) solid var(--bevel-lo);
  }

  /*
   * A well down the left, like the strip along the top of a docked panel: the
   * chosen pane is a slab standing out of it and joined to the pane, as the
   * chosen tab is joined to its panel.
   */
  /* The edge is an inset shadow rather than a border, so the chosen item can
     paint over it: a child's background lies above its parent's shadow. */
  .rail {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-height: 0;
    padding: var(--space-3) 0 var(--space-4) var(--space-3);
    background: var(--bg);
    box-shadow: inset calc(-1 * var(--bevel)) 0 0 var(--bevel-lo);
    overflow-x: hidden;
    overflow-y: auto;
  }

  .group {
    margin: var(--space-4) 0 var(--space-1) var(--space-3);
    font-size: var(--text-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-dim);
  }

  .group:first-child {
    margin-top: var(--space-1);
  }

  .rail-item {
    min-height: var(--control-h);
    padding: 0 var(--space-3);
    border-color: transparent;
    background: none;
    color: var(--text-dim);
    font-size: var(--text-md);
    text-align: left;
  }

  .rail-item:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text);
  }

  .rail-item.active,
  .rail-item.active:hover:not(:disabled) {
    border-color: var(--bevel-hi) var(--bg-panel) var(--bevel-lo) var(--bevel-hi);
    background: var(--bg-panel);
    color: var(--text);
    font-weight: 700;
  }

  /* `min-height: 0` so the pane scrolls inside the dialog rather than growing
     it past the window -- the same grid-child rule the app shell needs. */
  .pane {
    min-height: 0;
    padding: var(--space-4) var(--space-6) var(--space-6);
    overflow-y: auto;
  }

  .pane-title {
    margin: 0 0 var(--space-4);
    font-family: var(--font-pixel);
    font-size: var(--text-xl);
    font-weight: 500;
    letter-spacing: 0.02em;
    color: var(--text);
  }

  /* A section is a heading over its rows, with a groove before the next. */
  section + section,
  .field + section,
  .lead + section {
    margin-top: var(--space-5);
    padding-top: var(--space-4);
    border-top: var(--bevel) solid var(--bevel-lo);
    box-shadow: inset 0 var(--bevel) 0 var(--bevel-hi);
  }

  .lead + section {
    margin-top: var(--space-4);
  }

  h4 {
    margin: 0 0 var(--space-4);
    font-family: var(--font-pixel);
    font-size: var(--text-sm);
    font-weight: 500;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-dim);
  }

  .lead {
    margin: 0 0 var(--space-4);
  }

  /* A check box and its words on one line, read as the label of the row. */
  .toggle {
    margin-bottom: var(--space-4);
  }

  .check {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    color: var(--text);
    font-size: var(--text-md);
  }

  /* The hint lines up with the words, not with the box. */
  .toggle .hint {
    margin: var(--space-1) 0 0 30px;
  }

  .field > label {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    color: var(--text);
    font-size: var(--text-md);
  }

  .field.nested {
    margin-left: 30px;
  }

  /* As wide as the slider under it, so the value sits over its end. */
  .slider-head {
    max-width: 420px;
  }

  .slider-head > label {
    color: var(--text);
    font-size: var(--text-md);
  }

  /* A choice or a slider is as wide as it needs to be read, not as the pane:
     across 640px a select is a bar, and the eye loses the label. */
  .field > select,
  .field > input[type="range"],
  .field > input:not([type]) {
    display: block;
    max-width: 420px;
  }

  /*
   * What rebuilds the preview, beside its own name: a small gold tag, in the
   * pixel face, with the reason in its title.
   */
  .rebuilds {
    flex: none;
    padding: 0 var(--space-2);
    border: 1px solid var(--warn);
    color: var(--warn);
    font-size: var(--text-xs);
    line-height: 16px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    cursor: help;
  }

  .pick-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .pick-row input {
    flex: 1;
    min-width: 0;
  }

  /* `.pick-row input` is a class+type selector and outranks a bare `.swatch`,
     so this has to match at least as specifically or the swatch stretches. */
  .pick-row input.swatch {
    flex: 0 0 56px;
    height: var(--control-h);
  }

  .restart {
    margin-top: var(--space-3);
  }

  .callout {
    margin-top: var(--space-3);
  }

  .port {
    width: 140px;
  }

  /* A label for a row that is read, not edited -- the status and the activity
     list have no control to be the `for` of. */
  .label {
    display: block;
    margin-bottom: var(--space-2);
    font-size: var(--text-sm);
    color: var(--text-dim);
  }

  .state {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin: 0;
    font-size: var(--text-md);
  }

  .state .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: var(--radius-round);
  }

  /* Text to paste into a terminal, set the way a terminal will show it: in a
     proportional face a token's 0 and O, and l and 1, are one guess apart. */
  input.mono {
    font-family: var(--mono);
    font-size: var(--text-sm);
  }

  .activity {
    list-style: none;
    margin: 0;
    padding: var(--space-2) var(--space-3);
    max-height: 220px;
    overflow-y: auto;
    font-size: var(--text-sm);
  }

  .activity li {
    display: flex;
    gap: var(--space-3);
    padding: var(--space-1) 0;
  }

  .activity li + li {
    border-top: 1px solid var(--border);
  }

  .activity .when {
    flex: none;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }

  .activity .tool {
    flex: none;
    font-family: var(--mono);
  }

  /* The summary is the long one, so it is the one that gives way. */
  .activity .summary {
    flex: 1;
    color: var(--text-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .activity .tag,
  .activity li.failed .tool {
    flex: none;
    color: var(--danger);
  }

  /* A refused value, and a permitted one worth knowing about. Two colours
     because they are two different things: an address that cannot be bound
     is a mistake, and a server with no token is a decision. */
  .hint.bad {
    color: var(--danger);
  }

  .hint.warn {
    color: var(--warn);
  }

  .lod-status {
    margin: 0 0 var(--space-5);
  }

  /* The diagnostic tints' legend, painted from the viewport's own numbers. */
  .lod-legend {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    margin: calc(-1 * var(--space-2)) 0 0 30px;
  }

  .lod-swatch {
    display: inline-block;
    width: 10px;
    height: 10px;
    border: 1px solid var(--bevel-lo);
  }

  .report {
    margin-left: 30px;
  }

  .update-actions {
    flex-wrap: wrap;
  }

  .update-actions a {
    color: var(--accent-text);
    font-size: var(--text-sm);
  }

  progress.download {
    width: 100%;
    margin-top: var(--space-3);
  }
</style>
