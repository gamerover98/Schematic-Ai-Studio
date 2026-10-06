/**
 * A provider as a person reads it.
 *
 * `PROVIDERS` are stored values -- they are what `settings.json` holds, so
 * they cannot be reworded -- and were printed as they are: "Custom (OpenAI
 * Compatible)", and "OpenCode" for what is OpenCode's model gateway, Zen. The
 * names go through the catalogue like every other word on screen. A value
 * this table does not know (an older profile, a name from main) is shown as
 * it came rather than as nothing.
 */

import type { Provider } from "../../../shared/settings.js";
import { t } from "./i18n.svelte.js";

const NAMES: Readonly<Record<Provider, string>> = {
  OpenAI: "provider.name.openai",
  "Google Gemini": "provider.name.gemini",
  OpenCode: "provider.name.opencode",
  "Custom (OpenAI Compatible)": "provider.name.custom",
};

export function providerLabel(provider: string): string {
  const key = (NAMES as Readonly<Record<string, string>>)[provider];
  return key === undefined ? provider : t(key);
}
