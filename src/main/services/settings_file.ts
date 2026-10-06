/**
 * The shape of `settings.json`, and the one reading of it.
 *
 * Two readers need this file: the settings store, once the app is up, and the
 * GPU choice, which has to be made before `app.whenReady` and so cannot wait
 * for the store. They used to read it separately, and they disagreed about
 * where the settings are: the store wrote them under `settings`, and the GPU
 * reader looked for `preview` at the top. So the GPU preference read as
 * `"auto"` on every launch and the switch was never appended, while the pane
 * showed the choice saved and the test, built on the same wrong shape, passed.
 *
 * Electron-free, so `tests/services.ts` can write a file the way the store
 * writes it and read it back the way startup does.
 */

import { DEFAULT_SETTINGS, type Settings } from "../../shared/settings.js";
import type { RecentDocument } from "../../shared/ipc.js";
import { coerceSettings } from "./settings_coerce.js";
import { coerceRecents } from "./recent_documents.js";

export interface PersistedFile {
  settings: Settings;
  /** provider -> base64 ciphertext. Never plaintext. */
  encryptedKeys: Record<string, string>;
  /**
   * Recently opened schematics, most recent first.
   *
   * Beside `settings` rather than inside it, and for the same reason
   * `encryptedKeys` is: the renderer round-trips the whole `Settings` object on
   * every save. It holds a snapshot taken at startup, so a list that grew in
   * main since then would be overwritten by the stale one the moment the user
   * changed a preview slider — the file opened five minutes ago would silently
   * vanish from the list. Only main writes this.
   */
  recentDocuments: RecentDocument[];
  /**
   * The MCP server's bearer token.
   *
   * Beside `settings` for the same reason `recentDocuments` is: the renderer
   * round-trips the whole `Settings` object on every save from a snapshot taken
   * when it started, so a token regenerated in main since then would be
   * overwritten by the stale copy the moment somebody moved a slider.
   *
   * **Plaintext, deliberately.** The API keys next to it are encrypted because
   * they are credentials for a remote service that nothing else should ever
   * read. This one is displayed in the UI on purpose and written in the clear to
   * `mcp.json` so the stdio bridge — a dependency-free Node script with no way
   * to reach `safeStorage` — can send it. Encrypting one copy while another sits
   * in plaintext beside it would be theatre. What protects it is that it
   * authorises a loopback server and can be rotated in one click.
   */
  mcpToken: string | null;
}

/** What a missing or unreadable file stands for. */
export function emptyPersistedFile(): PersistedFile {
  return { settings: { ...DEFAULT_SETTINGS }, encryptedKeys: {}, recentDocuments: [], mcpToken: null };
}

/**
 * The file's text, coerced field by field.
 *
 * Throws what `JSON.parse` throws: the store treats a corrupt file as a reset
 * and needs to tell that apart from an I/O error.
 */
export function parsePersistedFile(text: string): PersistedFile {
  /*
   * A byte-order mark is stripped first. Nothing here writes one, but an
   * editor somebody opens the file with may, and `JSON.parse` refuses it --
   * which the store would read as a corrupt file and answer with the
   * defaults, writing them over every setting at the next save.
   */
  const parsed = JSON.parse(text.replace(/^\uFEFF/, "")) as Partial<PersistedFile> | null;
  return {
    settings: coerceSettings(parsed?.settings),
    encryptedKeys:
      parsed?.encryptedKeys && typeof parsed.encryptedKeys === "object" ? parsed.encryptedKeys : {},
    recentDocuments: coerceRecents(parsed?.recentDocuments),
    // An empty string is treated as absent by `chooseToken`, so a file edited
    // by hand into `""` heals into a fresh token rather than serving one.
    mcpToken: typeof parsed?.mcpToken === "string" ? parsed.mcpToken : null,
  };
}

/**
 * The settings in a file's text, never throwing.
 *
 * Startup is the least deserving place to fail, so no file, bad JSON or a
 * file of the wrong shape is the defaults.
 */
export function settingsFromFileText(text: string | null): Settings {
  if (text === null) return { ...DEFAULT_SETTINGS };
  try {
    return parsePersistedFile(text).settings;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
