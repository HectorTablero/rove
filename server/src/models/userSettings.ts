import { DEFAULT_SETTINGS } from '@rove/shared';
import { model, Schema } from 'mongoose';

const userSettingsSchema = new Schema(
  {
    userId: { type: String, required: true, unique: true },
    regionId: { type: String, default: DEFAULT_SETTINGS.regionId },
    quietNotifications: { type: Boolean, default: DEFAULT_SETTINGS.quietNotifications },
    llmBaseUrl: { type: String, default: DEFAULT_SETTINGS.llmBaseUrl },
    llmModel: { type: String, default: DEFAULT_SETTINGS.llmModel },
    /* The key, and the only place it lives. Absent from SettingsDto by design — `getSettings`
       reports `hasLlmKey` instead — so it is readable only through `getLlmConfig`, and no response
       can carry it by accident. */
    llmApiKey: { type: String, default: '' },
    pollSources: { type: [String], default: [] },
  },
  { timestamps: true },
);

export const UserSettings = model('UserSettings', userSettingsSchema);
