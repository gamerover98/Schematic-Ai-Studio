/**
 * Whether the app has a usable API key for what it is about to ask a model.
 *
 * ## Why this is its own module
 *
 * The rule was written out three times -- twice in `ipc/handlers.ts`, once
 * before generation and once before an agent turn -- and **not at all** on the
 * MCP path, which is the one place where getting it wrong is unreadable. The
 * missing gate there produced the raw provider string:
 *
 * ```
 * generate_schematic  LLM API Error: Invalid API key.
 * ```
 *
 * `LlmError` prefixes `LLM API Error: ` and `Invalid API key.` is OpenCode
 * Zen's own answer to an empty key, so what a person sees is a sentence about
 * an API key arriving from a server they have just authenticated to with a
 * bearer token. It was reported, reasonably, as an MCP authentication problem.
 * It is not one: this is the app spending the *user's* provider budget, and the
 * key it wants is the one in the app's own settings.
 *
 * So the check is one function, and the sentence it returns names the provider.
 * The caller supplies the surroundings, because the two audiences want opposite
 * things: a person at the keyboard is already looking at the window that has
 * the field in it, and a model needs to be told which window that is.
 *
 * ## Why the path is a parameter
 *
 * `openCodeSnapshotPath()` reaches Electron and `services/resources.ts` with
 * it, which would put this out of reach of the suites. Injected as a string,
 * exactly as `ToolContext.legacyBlocksPath` and `DocumentSpec.run`'s third
 * parameter are, for the same reason.
 */

import { providerRequiresApiKey, type Provider } from "../../shared/settings.js";

export interface KeyCheck {
  provider: Provider;
  model: string;
  apiKey: string;
  /**
   * The pre-rename profile, when it has keys and this one does not.
   *
   * Said at the moment of the failure, which is the only moment somebody is
   * certain to be looking. The rename moved userData and nothing migrates, so
   * an install with working keys came back with none and generation stopped;
   * what surfaced was the provider's `Invalid API key.`, pointing at a key
   * that was set, in a folder the app had stopped reading. Two reports.
   */
  legacyProfilePath?: string | null;
}

/**
 * The reason this call cannot be made, or `null`.
 *
 * **OpenCode's free models are not an exception.** They used to be, per model,
 * and this function consulted the catalogue to find out; Zen now refuses a
 * request with no key from anything but the OpenCode client (a 403
 * `FreeTierError`), so every model needs one from here and the question has one
 * answer. Said before the request, in this app's words, because what came back
 * was the gateway's own sentence about a client this is not -- true, and
 * pointing at nothing the user can change.
 *
 * It is not worked around. The restriction is the provider's, and presenting
 * this app as the OpenCode client to get past it would be exactly what it
 * exists to prevent.
 */
export async function apiKeyRefusal(check: KeyCheck): Promise<string | null> {
  if (check.apiKey.trim() !== "") return null;
  if (!providerRequiresApiKey(check.provider)) return null;

  if (check.provider === "OpenCode") {
    return withLegacyHint(
      `OpenCode Zen needs an API key to be used from this app: its free tier only works ` +
        `inside OpenCode itself, so ${check.model || "every model"} is refused without one, ` +
        `free ones included. Create a key at https://opencode.ai/auth and paste it under ` +
        `Settings → LLM provider.`,
      check,
    );
  }

  return withLegacyHint(`No API key is set for ${check.provider}.`, check);
}

/**
 * The sentence, plus where the old keys are when there are some.
 *
 * Appended rather than replacing: the first half is what is wrong and the
 * second is why it might be surprising. On a clean install the clause is
 * absent, so nothing invents a folder that was never there.
 */
function withLegacyHint(refusal: string, check: KeyCheck): string {
  const legacy = check.legacyProfilePath;
  if (legacy === undefined || legacy === null || legacy === "") return refusal;
  return (
    `${refusal} An earlier version of this app stored keys in ${legacy}, and this ` +
    `one does not read them — paste the key again under Settings → LLM provider.`
  );
}
