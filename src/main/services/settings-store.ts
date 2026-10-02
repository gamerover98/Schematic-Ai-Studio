/**
 * Settings + API-key persistence.
 *
 * Replaces `.env` (user requirement, Step 00 answer 3) and `component.py`'s
 * `st.text_input(type="password")`, which held keys in Streamlit session state
 * and lost them on every reload.
 *
 * ARCHITECTURE.md §3 "Secrets": keys are encrypted with Electron's
 * `safeStorage` (DPAPI on Windows, Keychain on macOS, libsecret/kwallet on
 * Linux) and the ciphertext is stored base64 in `settings.json` under
 * `app.getPath("userData")`. When `safeStorage.isEncryptionAvailable()` is
 * false -- a real case on Linux without a keyring daemon -- we keep the key in
 * memory for the session and **refuse to write it to disk**. Plaintext keys on
 * disk are exactly what the `.env` removal was for.
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";

import { app, safeStorage } from "electron";

import {
  PROVIDERS,
  type KeyStorageStatus,
  type Provider,
  type Settings,
} from "../../shared/settings.js";
import { forgetRecent, rememberRecent } from "./recent_documents.js";
import { coerceSettings } from "./settings_coerce.js";
import { emptyPersistedFile, parsePersistedFile, type PersistedFile } from "./settings_file.js";
import { orphanedProfile } from "./legacy_profile.js";
import { legacyUserDataDir } from "./resources.js";
import type { RecentDocument } from "../../shared/ipc.js";

/** Windows reaches the same file through paths differing only in case. */
const RECENTS_ARE_CASE_SENSITIVE = process.platform !== "win32";

function settingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

/** Session-only keys, used when encryption is unavailable. */
const memoryKeys = new Map<Provider, string>();

let cache: PersistedFile | null = null;



async function load(): Promise<PersistedFile> {
  if (cache) {
    return cache;
  }
  try {
    // The one reading of the file, shared with the GPU choice at startup.
    cache = parsePersistedFile(await readFile(settingsPath(), "utf-8"));
  } catch (err: unknown) {
    // RULEBOOK.md §1 "Standard library I/O": catch-ENOENT, rethrow-else. A
    // corrupt JSON file is also recoverable-by-reset here (SyntaxError), since
    // the alternative is an app that cannot start.
    const code = (err as { code?: string } | null)?.code;
    if (code !== "ENOENT" && !(err instanceof SyntaxError)) {
      throw err;
    }
    cache = emptyPersistedFile();
  }
  return cache;
}

async function persist(): Promise<void> {
  const data = await load();
  await mkdir(path.dirname(settingsPath()), { recursive: true });
  await writeFile(settingsPath(), JSON.stringify(data, null, 2), "utf-8");
}

export async function getSettings(): Promise<Settings> {
  return (await load()).settings;
}

/** The MCP server's stored token, or `null` if it has never had one. */
export async function getMcpToken(): Promise<string | null> {
  return (await load()).mcpToken;
}

/** Remembers a token across launches. See the note on `PersistedFile.mcpToken`. */
export async function setMcpToken(token: string): Promise<void> {
  const data = await load();
  data.mcpToken = token;
  await persist();
}

export async function setSettings(next: Settings): Promise<Settings> {
  const data = await load();
  data.settings = coerceSettings(next);
  await persist();
  return data.settings;
}

export async function getRecentDocuments(): Promise<RecentDocument[]> {
  return [...(await load()).recentDocuments];
}

/** Moves a path to the front of the list, or adds it there. */
export async function rememberRecentDocument(filePath: string): Promise<RecentDocument[]> {
  const data = await load();
  data.recentDocuments = rememberRecent(
    data.recentDocuments,
    filePath,
    RECENTS_ARE_CASE_SENSITIVE,
  );
  await persist();
  return [...data.recentDocuments];
}

/** Drops one — used when opening it fails, because it has moved or gone. */
export async function forgetRecentDocument(filePath: string): Promise<RecentDocument[]> {
  const data = await load();
  const before = data.recentDocuments.length;
  data.recentDocuments = forgetRecent(data.recentDocuments, filePath, RECENTS_ARE_CASE_SENSITIVE);
  if (data.recentDocuments.length !== before) {
    await persist();
  }
  return [...data.recentDocuments];
}

export async function getApiKey(provider: Provider): Promise<string> {
  const memory = memoryKeys.get(provider);
  if (memory !== undefined) {
    return memory;
  }
  const data = await load();
  const encoded = data.encryptedKeys[provider];
  if (!encoded) {
    return "";
  }
  if (!safeStorage.isEncryptionAvailable()) {
    // Ciphertext on disk we can no longer decrypt (keyring went away). Not an
    // error worth crashing on -- report "no key" and let the UI ask again.
    return "";
  }
  try {
    return safeStorage.decryptString(Buffer.from(encoded, "base64"));
  } catch {
    return "";
  }
}

export async function setApiKey(provider: Provider, apiKey: string): Promise<void> {
  const data = await load();
  const trimmed = apiKey.trim();
  if (trimmed === "") {
    delete data.encryptedKeys[provider];
    memoryKeys.delete(provider);
    await persist();
    return;
  }
  if (safeStorage.isEncryptionAvailable()) {
    data.encryptedKeys[provider] = safeStorage.encryptString(trimmed).toString("base64");
    memoryKeys.delete(provider);
    await persist();
    return;
  }
  // No OS-backed encryption: session-only, never written. The renderer learns
  // this from `KeyStorageStatus.encryptionAvailable` and warns.
  memoryKeys.set(provider, trimmed);
}

export async function clearApiKey(provider: Provider): Promise<void> {
  await setApiKey(provider, "");
}

/**
 * Whether stored ciphertext can actually be turned back into a key.
 *
 * `getApiKey` already answers `""` for all three of absent, no keyring, and
 * undecryptable -- which is right for a caller about to make a request and
 * wrong for the pane, which was reporting the *presence of bytes* as a saved
 * key. That is how "I have set the key" and "Invalid API key" came to be
 * true at the same time.
 */
function decrypts(encoded: string | undefined): boolean {
  if (!encoded) return false;
  if (!safeStorage.isEncryptionAvailable()) return false;
  try {
    return safeStorage.decryptString(Buffer.from(encoded, "base64")).trim() !== "";
  } catch {
    return false;
  }
}

export async function getKeyStatus(): Promise<KeyStorageStatus> {
  const data = await load();
  const encryptionAvailable = safeStorage.isEncryptionAvailable();
  /*
   * Asked here because this is the answer about *stored keys*, which is the
   * question the pane is already asking. `null` once this profile has one of
   * its own -- `orphanedProfile`'s rule -- so the notice cannot outlive its
   * cause.
   */
  const legacyProfile = await orphanedProfile(
    app.getPath("userData"),
    legacyUserDataDir(),
  );
  return {
    encryptionAvailable,
    legacyProfile,
    keys: PROVIDERS.map((provider) => {
      const stored = data.encryptedKeys[provider];
      const usable = memoryKeys.has(provider) || decrypts(stored);
      return {
        provider,
        hasKey: usable,
        // Bytes on disk that yield nothing. Reported rather than folded into
        // `hasKey: false`, so the pane can say which of the two it is.
        ...(usable || !stored ? {} : { unreadable: true }),
      };
    }),
  };
}

/** Test seam: drops the in-process cache so the next read hits disk. */
export function resetCacheForTests(): void {
  cache = null;
  memoryKeys.clear();
}
