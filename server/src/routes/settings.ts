import { settingsSchema } from '@rove/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../middleware/session';
import { jsonValidator } from '../middleware/validate';
import { UserSettings } from '../models/userSettings';
import { getSettings } from '../services/settingsService';

/* Write only — the client reads settings from its Dexie `meta` row, refreshed by GET /sync. */
export const settingsRouter = new Hono<AppEnv>().put(
  '/',
  jsonValidator(settingsSchema),
  async (c) => {
    const userId = c.get('userId');
    const { llmApiKey, ...input } = c.req.valid('json');
    await UserSettings.findOneAndUpdate(
      { userId },
      {
        $set: {
          ...input,
          // Optional in the schema so a replayed offline payload from a save that never touched
          // the key cannot wipe the stored one. An empty string is an explicit removal.
          ...(llmApiKey !== undefined ? { llmApiKey } : {}),
        },
        $setOnInsert: { userId },
      },
      { upsert: true },
    );
    return c.json(await getSettings(userId));
  },
);
