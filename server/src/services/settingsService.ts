import type { SettingsDto } from '@rove/shared';
import { DEFAULT_SETTINGS } from '@rove/shared';
import { UserSettings } from '../models/userSettings';

/** Read the user's settings, creating the defaults row on first access. */
export async function getSettings(userId: string): Promise<SettingsDto> {
  const doc = await UserSettings.findOneAndUpdate(
    { userId },
    { $setOnInsert: { userId } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  ).lean();
  return {
    regionId: doc.regionId ?? DEFAULT_SETTINGS.regionId,
    quietNotifications: doc.quietNotifications ?? DEFAULT_SETTINGS.quietNotifications,
    llmBaseUrl: doc.llmBaseUrl ?? '',
    llmModel: doc.llmModel ?? '',
    // Presence only. The key stays here; see getLlmConfig.
    hasLlmKey: !!doc.llmApiKey?.trim(),
  };
}

/** Everything the extractor needs to call a model, in the clear. Server-side callers only. */
export interface LlmConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

/**
 * Read the LLM endpoint including its key.
 *
 * Kept apart from `getSettings` so the key cannot reach a response by accident: `getSettings` is
 * what the settings route and the sync payload return, and it has no field that could carry one.
 * Anything that needs the actual key has to ask for it by this name, which is a grep away from an
 * audit.
 */
export async function getLlmConfig(userId: string): Promise<LlmConfig> {
  const doc = await UserSettings.findOne({ userId }, 'llmBaseUrl llmModel llmApiKey').lean();
  return {
    baseUrl: doc?.llmBaseUrl?.trim() ?? '',
    model: doc?.llmModel?.trim() ?? '',
    apiKey: doc?.llmApiKey?.trim() ?? '',
  };
}
