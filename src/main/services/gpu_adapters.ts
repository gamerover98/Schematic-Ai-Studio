/**
 * The graphics adapters on this machine, and the one asked for at launch.
 *
 * Chromium chooses its adapter when the GPU process starts, before the app is
 * ready, and offers two levers. `force_high_performance_gpu` and its opposite
 * pick by power. `--use-adapter-luid=<high>,<low>` picks one adapter by its
 * LUID, which is the only way to name the third of three. That switch is
 * real -- it is in Electron 33's binary and `ui/gl/gl_display.cc` parses it,
 * high part signed and low part unsigned -- and a LUID that names nothing is
 * harmless: the D3D11 display fails on it and Chromium falls back to the
 * default adapter, measured on this app's own Electron.
 *
 * **A LUID is not a name.** Windows assigns one when the adapter starts and
 * it changes at every boot, so the setting stores a stable key
 * (`vendor:device:subsys:revision#n`) and the LUID is looked up at launch.
 * Electron does not expose LUIDs at all -- `app.getGPUInfo` enumerates vendor,
 * device, revision, subsystem, `active` and a power preference, and nothing
 * else -- so the list comes from DXGI, through PowerShell and a few lines of
 * C#. No native dependency: `powershell.exe` ships with every Windows this
 * app supports, and the C# is compiled by .NET at run time.
 *
 * That costs about a second, so it is paid once per boot: the list is kept in
 * `userData/gpu-adapters.json` with the time the machine booted, and a launch
 * in the same boot reads it back for nothing.
 *
 * Electron-free: `node:child_process` only, so the suites reach the parsing,
 * the keys, the cache and the launch plan.
 */

import { spawn, spawnSync } from "node:child_process";

import { gpuSwitchFor } from "./gpu_preference.js";
import type { GpuPreference } from "../../shared/settings.js";
import type { GpuAdapterInfo, GpuLaunch, GpuStatus } from "../../shared/ipc.js";

export interface GpuAdapter {
  /** Stable across boots; what the setting stores. */
  key: string;
  name: string;
  vendorId: number;
  deviceId: number;
  subSysId: number;
  revision: number;
  /** Bytes of the adapter's own memory; a few hundred MB on an integrated GPU. */
  dedicatedMemory: number;
  /** `"<high>,<low>"`, exactly as the switch takes it. Valid for this boot only. */
  luid: string;
}

export interface AdapterList {
  adapters: GpuAdapter[];
  /** LUIDs in DXGI's high-performance order, most powerful first. */
  highPerformance: string[];
  /** LUIDs in DXGI's minimum-power order. */
  lowPower: string[];
}

/** `DXGI_ADAPTER_FLAG_SOFTWARE`: the Basic Render Driver, never a choice. */
const SOFTWARE_ADAPTER = 2;

/** What `--use-adapter-luid` accepts: a signed high part, an unsigned low part. */
const LUID = /^-?\d{1,10},\d{1,10}$/;

function hex(n: number): string {
  return (n >>> 0).toString(16);
}

/**
 * The adapters DXGI reported, software ones dropped and each given its key.
 *
 * Two identical cards share every id, so the `#n` suffix counts them in
 * DXGI's order. That order is the bus order and does not move between boots.
 */
export function parseDxgiOutput(text: string): AdapterList | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const raw = parsed as { adapters?: unknown; highPerformance?: unknown; lowPower?: unknown };
  if (!Array.isArray(raw.adapters)) return null;
  const seen = new Map<string, number>();
  const adapters: GpuAdapter[] = [];
  for (const item of raw.adapters as Record<string, unknown>[]) {
    if (typeof item !== "object" || item === null) continue;
    const num = (field: string): number => (typeof item[field] === "number" ? (item[field] as number) : 0);
    if ((num("flags") & SOFTWARE_ADAPTER) !== 0) continue;
    const luid = typeof item.luid === "string" ? item.luid : "";
    if (!LUID.test(luid)) continue;
    const base = `${hex(num("vendorId"))}:${hex(num("deviceId"))}:${hex(num("subSysId"))}:${hex(num("revision"))}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    adapters.push({
      key: `${base}#${n}`,
      name: typeof item.name === "string" && item.name.trim() !== "" ? item.name.trim() : base,
      vendorId: num("vendorId"),
      deviceId: num("deviceId"),
      subSysId: num("subSysId"),
      revision: num("revision"),
      dedicatedMemory: num("dedicatedMemory"),
      luid,
    });
  }
  const known = new Set(adapters.map((adapter) => adapter.luid));
  const order = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((luid): luid is string => typeof luid === "string" && known.has(luid)) : [];
  return { adapters, highPerformance: order(raw.highPerformance), lowPower: order(raw.lowPower) };
}

/**
 * The enumeration, as PowerShell.
 *
 * `IDXGIFactory1::EnumAdapters1` and `GetDesc1` for the list, and
 * `IDXGIFactory6::EnumAdapterByGpuPreference` for the two orders where the
 * system has it (Windows 10 1803 on). The COM interfaces declare every
 * method up to the one called, because a C# COM import is a vtable layout
 * and nothing else.
 */
export const DXGI_SCRIPT = String.raw`$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class SasDxgi {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct Desc1 {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Description;
    public uint VendorId; public uint DeviceId; public uint SubSysId; public uint Revision;
    public UIntPtr DedicatedVideoMemory; public UIntPtr DedicatedSystemMemory; public UIntPtr SharedSystemMemory;
    public uint LuidLow; public int LuidHigh; public uint Flags;
  }
  [ComImport, Guid("29038f61-3839-4626-91fd-086879011a05"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAdapter1 {
    void SetPrivateData(); void SetPrivateDataInterface(); void GetPrivateData(); void GetParent();
    void EnumOutputs(); void GetDesc(); void CheckInterfaceSupport();
    [PreserveSig] int GetDesc1(out Desc1 desc);
  }
  [ComImport, Guid("770aae78-f26f-4dba-a829-253c83d1b387"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IFactory1 {
    void SetPrivateData(); void SetPrivateDataInterface(); void GetPrivateData(); void GetParent();
    void EnumAdapters(); void MakeWindowAssociation(); void GetWindowAssociation(); void CreateSwapChain(); void CreateSoftwareAdapter();
    [PreserveSig] int EnumAdapters1(uint index, out IAdapter1 adapter);
    void IsCurrent();
  }
  [ComImport, Guid("c1b6694f-ff09-44a9-b03c-77900a0a1d17"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IFactory6 {
    void SetPrivateData(); void SetPrivateDataInterface(); void GetPrivateData(); void GetParent();
    void EnumAdapters(); void MakeWindowAssociation(); void GetWindowAssociation(); void CreateSwapChain(); void CreateSoftwareAdapter();
    void EnumAdapters1(); void IsCurrent();
    void IsWindowedStereoEnabled(); void CreateSwapChainForHwnd(); void CreateSwapChainForCoreWindow(); void GetSharedResourceAdapterLuid();
    void RegisterStereoStatusWindow(); void RegisterStereoStatusEvent(); void UnregisterStereoStatus();
    void RegisterOcclusionStatusWindow(); void RegisterOcclusionStatusEvent(); void UnregisterOcclusionStatus(); void CreateSwapChainForComposition();
    void GetCreationFlags();
    void EnumAdapterByLuid(); void EnumWarpAdapter();
    void CheckFeatureSupport();
    [PreserveSig] int EnumAdapterByGpuPreference(uint index, int preference, ref Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object adapter);
  }
  [DllImport("dxgi.dll")]
  static extern int CreateDXGIFactory1(ref Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object factory);
  static string Quote(string s) {
    var b = new StringBuilder("\"");
    foreach (char c in s) {
      if (c == '"' || c == '\\') { b.Append('\\'); b.Append(c); }
      else if (c < ' ') b.Append(' ');
      else b.Append(c);
    }
    return b.Append('"').ToString();
  }
  static string Luid(Desc1 d) { return d.LuidHigh + "," + d.LuidLow; }
  static string Order(object factory, int preference) {
    var f6 = factory as IFactory6;
    if (f6 == null) return "[]";
    var parts = new StringBuilder("[");
    Guid riid = typeof(IAdapter1).GUID;
    for (uint i = 0; i < 16; i++) {
      object raw;
      if (f6.EnumAdapterByGpuPreference(i, preference, ref riid, out raw) != 0) break;
      Desc1 d;
      if (((IAdapter1)raw).GetDesc1(out d) != 0) break;
      if (i > 0) parts.Append(',');
      parts.Append(Quote(Luid(d)));
    }
    return parts.Append(']').ToString();
  }
  public static string Json() {
    Guid riid = typeof(IFactory1).GUID;
    object raw;
    int hr = CreateDXGIFactory1(ref riid, out raw);
    if (hr != 0) throw new Exception("CreateDXGIFactory1 0x" + hr.ToString("x8"));
    var factory = (IFactory1)raw;
    var list = new StringBuilder("[");
    bool first = true;
    for (uint i = 0; i < 16; i++) {
      IAdapter1 adapter;
      if (factory.EnumAdapters1(i, out adapter) != 0) break;
      Desc1 d;
      if (adapter.GetDesc1(out d) != 0) continue;
      if (!first) list.Append(',');
      first = false;
      list.Append("{\"name\":").Append(Quote(d.Description))
        .Append(",\"vendorId\":").Append(d.VendorId)
        .Append(",\"deviceId\":").Append(d.DeviceId)
        .Append(",\"subSysId\":").Append(d.SubSysId)
        .Append(",\"revision\":").Append(d.Revision)
        .Append(",\"dedicatedMemory\":").Append(d.DedicatedVideoMemory.ToUInt64())
        .Append(",\"luid\":").Append(Quote(Luid(d)))
        .Append(",\"flags\":").Append(d.Flags).Append('}');
    }
    list.Append(']');
    return "{\"adapters\":" + list + ",\"highPerformance\":" + Order(raw, 2) + ",\"lowPower\":" + Order(raw, 1) + "}";
  }
}
'@
[SasDxgi]::Json()
`;

function powershellArgs(): string[] {
  // -EncodedCommand is UTF-16LE base64: no quoting of the C# survives otherwise.
  const encoded = Buffer.from(DXGI_SCRIPT, "utf16le").toString("base64");
  return ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded];
}

/** The last line of the output is the JSON; PowerShell may print before it. */
function lastLine(text: string): string {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  return lines.at(-1) ?? "";
}

/**
 * Blocking, for startup: the switch has to be appended before `ready`, and
 * there is nothing else the process could be doing yet.
 */
export function enumerateAdaptersSync(timeoutMs = 10_000): AdapterList | null {
  if (process.platform !== "win32") return null;
  try {
    const result = spawnSync("powershell.exe", powershellArgs(), {
      encoding: "utf8",
      timeout: timeoutMs,
      windowsHide: true,
    });
    if (result.status !== 0 || typeof result.stdout !== "string") return null;
    return parseDxgiOutput(lastLine(result.stdout));
  } catch {
    return null;
  }
}

/** The same, without holding the main process: for the pane and the check. */
export function enumerateAdapters(timeoutMs = 15_000): Promise<AdapterList | null> {
  if (process.platform !== "win32") return Promise.resolve(null);
  return new Promise((resolve) => {
    let out = "";
    let settled = false;
    const finish = (list: AdapterList | null): void => {
      if (settled) return;
      settled = true;
      resolve(list);
    };
    try {
      const child = spawn("powershell.exe", powershellArgs(), { windowsHide: true });
      const timer = setTimeout(() => {
        child.kill();
        finish(null);
      }, timeoutMs);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => (out += chunk));
      child.on("error", () => {
        clearTimeout(timer);
        finish(null);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        finish(code === 0 ? parseDxgiOutput(lastLine(out)) : null);
      });
    } catch {
      finish(null);
    }
  });
}

// ---------------------------------------------------------------------------
// The per-boot cache
// ---------------------------------------------------------------------------

export interface AdapterCache {
  /** When the machine booted, in seconds since the epoch. */
  boot: number;
  list: AdapterList;
  /** LUIDs that were passed at a launch and did not end up drawing. */
  badLuids: string[];
}

/**
 * The boot time, from the wall clock and the uptime.
 *
 * Both are read at slightly different instants, so two launches in one boot
 * can disagree by a second or so; `cacheForBoot` allows for it.
 */
export function bootTime(nowMs: number, uptimeSeconds: number): number {
  return Math.round(nowMs / 1000 - uptimeSeconds);
}

/** Two launches this far apart in boot time are the same boot. */
const SAME_BOOT_SECONDS = 90;

/** The cache in a file's text, if it belongs to this boot. Never throws. */
export function cacheForBoot(text: string | null, boot: number): AdapterCache | null {
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text) as Partial<AdapterCache> | null;
    if (typeof parsed?.boot !== "number" || Math.abs(parsed.boot - boot) > SAME_BOOT_SECONDS) return null;
    const list = parseDxgiOutput(
      JSON.stringify({
        adapters: (parsed.list?.adapters ?? []).map((adapter) => ({ ...adapter, flags: 0 })),
        highPerformance: parsed.list?.highPerformance,
        lowPower: parsed.list?.lowPower,
      }),
    );
    if (list === null) return null;
    const badLuids = Array.isArray(parsed.badLuids)
      ? parsed.badLuids.filter((luid): luid is string => typeof luid === "string")
      : [];
    return { boot: parsed.boot, list, badLuids };
  } catch {
    return null;
  }
}

export function adapterForKey(list: AdapterList, key: string): GpuAdapter | null {
  return list.adapters.find((adapter) => adapter.key === key) ?? null;
}

/** The adapter a preference would land on, by DXGI's own order. */
export function adapterForPreference(list: AdapterList, preference: GpuPreference): GpuAdapter | null {
  const order = preference === "high-performance" ? list.highPerformance : preference === "low-power" ? list.lowPower : [];
  const luid = order[0];
  return luid === undefined ? null : (list.adapters.find((adapter) => adapter.luid === luid) ?? null);
}

// ---------------------------------------------------------------------------
// The launch plan
// ---------------------------------------------------------------------------

export interface GpuChoice {
  preference: GpuPreference;
  adapter: string | null;
}

export interface GpuLaunchPlan {
  /** Chromium switches to append, in order. */
  switches: Array<{ name: string; value?: string }>;
  launch: GpuLaunch;
  /** A fresh cache to write, when the list had to be read this launch. */
  cacheToWrite: AdapterCache | null;
}

/**
 * What to append before `ready`, decided from the choice and what is known.
 *
 * Pure apart from `enumerate`, which is called only when a particular adapter
 * is chosen and the cache cannot name its LUID for this boot.
 *
 * A preference stays on Chromium's own switch: measured on this app's
 * Electron, `force_high_performance_gpu` does move a hybrid laptop onto its
 * discrete GPU, and it costs no enumeration. It looked broken only because
 * the setting was never read (see `settings_file.ts`).
 */
export function planGpuLaunch(input: {
  choice: GpuChoice;
  platform: string;
  boot: number;
  cachedText: string | null;
  enumerate: () => AdapterList | null;
}): GpuLaunchPlan {
  const { choice } = input;
  const byPreference = (note: GpuLaunch["note"]): GpuLaunchPlan => {
    const name = gpuSwitchFor(choice.preference);
    return {
      switches: name === null ? [] : [{ name }],
      launch: {
        preference: choice.preference,
        adapter: choice.adapter,
        method: name === null ? "default" : "switch",
        luid: null,
        adapterName: null,
        note,
      },
      cacheToWrite: null,
    };
  };
  if (choice.adapter === null) return byPreference(null);
  if (input.platform !== "win32") return byPreference("unsupported-platform");

  let cache = cacheForBoot(input.cachedText, input.boot);
  let fresh: AdapterCache | null = null;
  let adapter = cache === null ? null : adapterForKey(cache.list, choice.adapter);
  if (adapter === null || cache?.badLuids.includes(adapter.luid) === true) {
    const list = input.enumerate();
    if (list === null) return byPreference("enumeration-failed");
    fresh = { boot: input.boot, list, badLuids: [] };
    cache = fresh;
    adapter = adapterForKey(list, choice.adapter);
  }
  if (adapter === null) {
    return { ...byPreference("adapter-missing"), cacheToWrite: fresh };
  }
  return {
    switches: [{ name: "use-adapter-luid", value: adapter.luid }],
    launch: {
      preference: choice.preference,
      adapter: choice.adapter,
      method: "luid",
      luid: adapter.luid,
      adapterName: adapter.name,
      note: null,
    },
    cacheToWrite: fresh,
  };
}

// ---------------------------------------------------------------------------
// What actually draws
// ---------------------------------------------------------------------------

/**
 * The device id in an ANGLE renderer string, such as
 * `ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Laptop GPU (0x0000249C) Direct3D11 ...)`.
 *
 * That string is what `app.getGPUInfo("complete").auxAttributes.glRenderer`
 * and WebGL's `UNMASKED_RENDERER_WEBGL` both report, so main can tell which
 * adapter is drawing without asking the window.
 */
export function rendererDeviceId(renderer: string): number | null {
  const match = /\(0x([0-9a-f]{4,8})\)/i.exec(renderer);
  return match === null ? null : Number.parseInt(match[1] ?? "", 16);
}

/** Whether the adapter that draws is the one a launch asked for. */
export function launchHonoured(launch: GpuLaunch, adapter: GpuAdapter | null, renderer: string): boolean | null {
  if (launch.method !== "luid" || adapter === null) return null;
  const device = rendererDeviceId(renderer);
  return device === null ? null : device === adapter.deviceId;
}

// ---------------------------------------------------------------------------
// The status the pane and the report read
// ---------------------------------------------------------------------------

/** One entry of `app.getGPUInfo(...).gpuDevice`, as far as this reads it. */
export interface ChromiumGpuDevice {
  vendorId?: number;
  deviceId?: number;
  /** Chromium's `gl::GpuPreference`: 2 low power, 3 high performance. */
  gpuPreference?: number;
  vendorString?: string;
  deviceString?: string;
}

const VENDORS: Record<number, string> = {
  0x10de: "NVIDIA",
  0x1002: "AMD",
  0x1022: "AMD",
  0x8086: "Intel",
  0x1414: "Microsoft",
  0x5143: "Qualcomm",
  0x106b: "Apple",
};

/** A device Chromium saw, as a pane entry; for where DXGI does not exist. */
function fromChromium(device: ChromiumGpuDevice, index: number): GpuAdapterInfo {
  const vendorId = device.vendorId ?? 0;
  const deviceId = device.deviceId ?? 0;
  const vendor = VENDORS[vendorId] ?? `0x${hex(vendorId)}`;
  const named = device.deviceString?.trim();
  return {
    key: `${hex(vendorId)}:${hex(deviceId)}:0:0#${index}`,
    name: named !== undefined && named !== "" ? named : `${vendor} 0x${hex(deviceId).padStart(4, "0")}`,
    vendorId,
    deviceId,
    dedicatedMemory: 0,
  };
}

/**
 * The status, from what main knows: the launch, DXGI's list (Windows), the
 * devices Chromium saw, and the renderer string it reports.
 *
 * Software adapters are never listed. Chromium's own list carries the Basic
 * Render Driver (vendor 0x1414); outside Windows there is no such thing.
 */
export function gpuStatusFrom(input: {
  platform: string;
  launch: GpuLaunch;
  list: AdapterList | null;
  devices: readonly ChromiumGpuDevice[];
  renderer: string | null;
}): GpuStatus {
  const { list, launch, renderer } = input;
  let adapters: GpuAdapterInfo[] | null;
  let highPerformance: string | null = null;
  let lowPower: string | null = null;
  if (list !== null) {
    adapters = list.adapters.map(({ key, name, vendorId, deviceId, dedicatedMemory }) => ({
      key,
      name,
      vendorId,
      deviceId,
      dedicatedMemory,
    }));
    highPerformance = adapterForPreference(list, "high-performance")?.key ?? null;
    lowPower = adapterForPreference(list, "low-power")?.key ?? null;
  } else if (input.platform !== "win32" && input.devices.length > 0) {
    const real = input.devices.filter((device) => device.vendorId !== 0x1414);
    adapters = real.map(fromChromium);
    highPerformance = adapters[real.findIndex((device) => device.gpuPreference === 3)]?.key ?? null;
    lowPower = adapters[real.findIndex((device) => device.gpuPreference === 2)]?.key ?? null;
  } else {
    adapters = null;
  }
  const device = renderer === null ? null : rendererDeviceId(renderer);
  const drawing = device === null ? null : (adapters?.find((adapter) => adapter.deviceId === device) ?? null);
  const asked = list === null || launch.adapter === null ? null : adapterForKey(list, launch.adapter);
  return {
    adapters,
    choosable: input.platform === "win32" && list !== null,
    highPerformance,
    lowPower,
    launch,
    active: renderer === null ? null : { renderer, adapter: drawing?.key ?? null },
    honoured: renderer === null ? null : launchHonoured(launch, asked, renderer),
  };
}
