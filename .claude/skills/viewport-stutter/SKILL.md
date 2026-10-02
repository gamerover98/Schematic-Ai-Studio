---
name: viewport-stutter
description: Diagnose and fix frame-rate drops and stutters in the 3D viewport from a stutter report. Use when the user pastes a stutter report (the JSON copied by Settings → Quality → "Copy stutter report"), a "[stutter]" line from the developer console, or says the viewport drops to a few FPS, stutters, hitches, freezes briefly while orbiting, flying, editing, or at regular intervals.
---

# Fixing viewport stutters

The viewport draws in `animate` in `src/renderer/src/lib/Viewer.svelte`.
A stutter is one interval between two drawn frames that took far longer than
usual. **Measure first, then fix**: every change here starts from a report,
names the phase the report blamed, and ends with a report showing that phase
gone. A fix without a before-and-after number is a guess.

## The instrument

`src/renderer/src/lib/frame_profiler.ts` records, per interval: `gap` (wall
clock between drawn frames), `work` (what the loop measured itself doing, split
into `phases`), and `outside = gap - work`. It keeps the **spikes** —
`gap > max(50 ms, 3 × median)`, below 2 s — each with its `culprit`, the
`events` of that interval and the browser's **Long Animation Frame** entries
that overlap it. `CLAUDE.md` has the reasoning under "A stutter is measured
before it is fixed".

How the user produces a report:

1. Settings → Quality: **Show the frame counter** and **Diagnose stutters**.
2. Reproduce. The counter shows `worst N ms · culprit` for the last 2 s.
3. **Copy stutter report**, paste it. Optionally Help → Toggle Developer
   Tools (Ctrl+Shift+I) → Performance: each phase is a `viewer:<phase>` measure,
   each spike a `[stutter]` line in the console.

If the user reports stutters without a report, ask for one with these steps
before touching code.

## Reading a report

Frames that drew nothing are in the report too: the loop wakes on every
refresh and the interval closes before it decides to draw, so a still scene is
a run of ~16 ms intervals with no phases, not one long gap. A spike is still a
late refresh or a long frame.

Start with `culprits` (spikes counted by culprit), then `frames` (p50/p95/p99/
max), then the individual `spikes`. Check `context.settings` — GI, shadows,
AA, `maxDpr`, `renderScale`, sky — and `context.gpu`: a software renderer
(`SwiftShader`, `Microsoft Basic Render Driver`) explains everything and is
fixed by the GPU driver, not by code.

**Then check which card drew, before anything else.** `context.gpu` is the
card that drew. `context.gpuLaunch` is what main asked Chromium for, and
`context.gpuHonoured` is `false` when a particular card was asked for and
another one drew. `settings.gpuPreference` is only the choice on screen: it
cannot tell "not restarted yet" from "ignored", and it once hid a startup
that never applied the choice at all (Report 3). An integrated GPU in
`context.gpu` on a machine with a discrete one is the first thing to fix, in
the pane (Settings → Quality → Graphics card), before reading any phase.
`gpuLoad.pixels × msaaSamples` is the other half: 12 M px × 8 on an iGPU is a
slideshow whatever the code does.

Each spike's `reading` is the first inference. Then:

| culprit / evidence | where to look | usual fix |
|---|---|---|
| `hover raycast`, `block outline raycast` | `pickBlockAt` → `raycaster.intersectObject(loaded, true)`, `faceAt`, `gizmoAt`; throttled by `HIGHLIGHT_INTERVAL_MS` | raycast only when the pointer or camera actually moved since the last one; then a per-chunk BVH or a voxel DDA against the document grid instead of triangles |
| `environment` + event `environment rebuilt`, periodic ~1 s | `buildEnvironment` (`pmrem.fromScene`), `ENVIRONMENT_MS`, `environmentStale` set by `applySky` | rebuild only when the daylight changed visibly (threshold on sun direction/colour), a longer interval, or a smaller cube |
| `scene pass` | triangles/draw calls in `context`, shadows, `maxDrawDistance`, AA | shadows are a whole extra pass; check `shadowQuality`, far-plane culling, chunk count; frustum culling is per chunk already |
| `sky pass`, `anti-aliasing copy` | `renderFrame` | resolution: `maxDpr × renderScale × canvas`; MSAA level |
| `texture animations: first upload` holds the time, `: uploads` costs nothing | the first `texSubImage2D` of the tick waits for the GPU to finish with the atlas: **the GPU is behind** | not the uploads' fault. Check `gpuLoad` (pixels × MSAA samples, shadows) and `display`. Ask for a report on the other screen and with lower renderScale/MSAA before touching code. On a hybrid-GPU laptop, the external display can be the whole difference |
| `texture animations: uploads` grows with `animations uploaded.count` | `playAnimations`: only tiles marked `active` by `refreshAnimated` (via `animationsUsed`) are uploaded | per-upload cost: fewer uploads per tick (frame-time batching), or one packed strip per tick |
| `outside the loop` + event `mesh delta applied` / `mesh rebuilt` with large `kilobytes` | the payload `$effect`, `applyDelta`, `buildModel`, `chunkMesh` (`computeBoundingSphere/Box`) | spread chunk uploads across frames; reuse `BufferGeometry` and update attributes in place |
| `outside the loop` + Long Animation Frame scripts | the `scripts[].fn` / `invoker` named | that function; often a Svelte `$effect` firing more often than it should |
| `outside the loop`, no scripts, no events | GPU, compositor, GC — see `readingOf` | lower resolution/AA to test the GPU hypothesis; look for per-frame allocation for GC |
| `mesh answered by main` with a large `ms` | main process | not a frame drop by itself — main is another process; it only delays the picture |

When the report does not settle it, ask for a DevTools Performance recording of
the moment, or add a finer `lap` inside the suspect phase — temporarily if it
is only for this investigation.

## Found so far

- **Report 1** (RTX 3080 Laptop, ANGLE/D3D11, window on the external HDMI/DP
  monitor; smooth on the laptop panel): 50/50 spikes in `texture animations`,
  85-443 ms, on an 11x12x11 document with 34 animated textures, none of them
  in the document. Fix: only tiles the mesh draws are played
  (`atlas_animation.ts`). The time was very likely a GPU wait surfacing at the
  first upload, so the next report is expected either clean, or with the wait
  moved to another phase. That will be `scene pass`, or `outside the loop`
  with no scripts, and will point at the display or GPU load rather than at
  the code.
- **Report 2** (same machine and screen, after fix 1): texture animations
  down to 1-2 ms. 50/50 spikes were now `outside the loop`, 390-800 ms, each with
  `mesh answered by main` (6 s rising to 29.6 s) and `mesh rebuilt` with
  `atlas: true`. The tell is that `at - ms` is the same instant for every
  answer: a **burst** of ~50 requests left together, most likely a colour picker
  dragged, and the window applied each stale answer with a 27 MB atlas. Fix:
  `refreshDocument` goes through `coalesce.ts`, so one request is in flight and
  at most one more waits behind it.

  How to spot it again: `mesh answered by main` whose `ms` grows by about one
  spike interval per spike.

- **Report 3** (same laptop, window on the **laptop panel**, which the AMD
  iGPU drives; 21x24x22 document): p50 67 ms, `gpu` = AMD Radeon with
  `gpuPreference: high-performance` in the settings. Three causes in one
  report:
  1. **The preference was never applied.** `gpu_preference.ts` read
     `preview` from the top of `settings.json`, and the store writes it under
     `settings`, so every launch read `auto`. The test agreed with the parser,
     not with the file. Now one reader, `settings_file.ts`, is shared with the
     store, and a card can be chosen by name (`--use-adapter-luid`, DXGI list
     through PowerShell). `gpu_runtime.ts` checks which card draws.
  2. **`compass` 225 ms and 103 ms** was not the compass. three r171 resolves
     the multisampled target at the end of every `render()`, colour and depth,
     and the frame made three calls into it (sky, scene, compass). The 104 px
     compass paid a full-screen blit at 12 M px × 8 samples. Fixed: the sky
     is in the world's render (on the far plane), the compass has its own
     small target, so a frame resolves once.
  3. **`mesh answered by main` 454 ms with `atlas: true`** on a tiny document:
     the atlas repacked because an edit introduced a texture, which
     invalidates every chunk and resends 27 MB.

  Lesson for reading: ask which screen the window was on. Report 1 was the
  external monitor, which the dGPU drives, and looked like a different
  machine.

## Fixing

- **One culprit per change**, the biggest first by `culprits` count × typical
  `gap`. Say which spikes it should remove.
- The loop rules in `CLAUDE.md` still hold: the frame cap's early return stays
  before `clock.getDelta()`; `renderFrame` on request (`aimCamera`) stays
  unthrottled; the hover rules (`pointerOnHandle`, `hoverSource`) keep their
  answers; nothing the raycaster sees may change (`tests/ui.ts` walks every
  `intersectObject`).
- **The viewport draws on demand** (`render_demand.ts`). Anything new that
  changes the picture has to ask for a frame: a prop is covered by the
  invalidation effect (and `tests/ui.ts` fails if it is not in its list), an
  input by the wake listeners, the camera by comparison. Something that
  changes the scene from a timer, a promise or an internal variable must call
  `invalidate()`, or the picture freezes. "Always draw" (`preview.alwaysDraw`)
  tells a missed invalidation from anything else: if it fixes the symptom, an
  `invalidate()` is missing.
- **Something that casts a shadow and moves calls `shadowsStale()`**; the map
  is not redrawn every frame any more.
- **"mesh answered by main" carries `main`**: main's own steps in ms (light,
  diff, mesh chunks, atlas, ship...). A long answer with small steps was a
  wait, not work. For an edit that is slow in main, reproduce it with
  `npm run bench:edit` before changing anything: it prints the same steps.
- **An edit must cost what it touches.** The document records the cells it
  writes (`writeVoxel`, `doc.changes`) and keeps counts (`doc.counts`); a new
  write path that bypasses them breaks both, and `tests/document.ts` refuses
  it. A new texture goes into the atlas reserve (`appendTiles`); a full repack
  shows up as `atlas` taking ~150 ms and the payload carrying the whole sheet.
- **One `render()` into `aaTarget` per frame.** Every further render into a
  multisampled target is a full-screen resolve; draw extra passes into a target
  of their own, the compass's arrangement.
- **New work in the loop gets a `lap`**, new work outside it a `note`, through
  the existing `stamp`/`lap`/`note` helpers so diagnosing stays free when off.
- Put the decision in a plain module when it can be tested (`frameDue`,
  `selection_drag.ts`'s pattern): rAF and the GPU cannot be observed in the
  test harness.
- Record what was found and why the fix is shaped that way in `CLAUDE.md`, in
  the section of the thing that was fixed — the measured before/after numbers
  included.

## Verifying

1. `scripts/check.sh` (or `scripts\check.ps1`) — typecheck plus every suite.
2. Ask the user for a new report under the same conditions, and compare
   `culprits`, p95/p99 and max against the one before. The fix is done when the
   culprit it targeted has left the report.

## Must not

- Change a setting's default to hide a stutter (turning GI or shadows off for
  everyone is not a fix).
- Remove or weaken the profiler hooks, or make them run when diagnostics are
  off.
- Guess without a report.
