import { DEFAULT_SETTINGS } from '@rove/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { modelDouble, resetModels } from '../test/mongooseDouble';
import { postJson, routeApp, USER_ID } from '../test/routeApp';

/* One route, and one decision inside it that is worth more than the route: the LLM key is optional
 * in the schema *specifically* so that a PUT replayed from a save that never touched the key — or
 * from a client that predates it — cannot blank the stored one. That is a difference between
 * `undefined` and `''` in a `$set`, which is invisible in a response body and irreversible for the
 * user. */

const UserSettings = modelDouble();
const settings = vi.hoisted(() => ({ getSettings: vi.fn() }));

vi.mock('../models/userSettings', () => ({ UserSettings }));
vi.mock('../services/settingsService', () => settings);

const { settingsRouter } = await import('./settings');

const app = routeApp('/settings', settingsRouter);

const validBody = (patch: Record<string, unknown> = {}) => ({
  regionId: 'shenzhen',
  quietNotifications: true,
  llmBaseUrl: 'http://spark.local:8000/v1',
  llmModel: 'qwen3',
  ...patch,
});

const updateSet = () =>
  (UserSettings.findOneAndUpdate.mock.calls[0]?.[1] as { $set: Record<string, unknown> }).$set;

beforeEach(() => {
  resetModels(UserSettings);
  settings.getSettings.mockReset();
  settings.getSettings.mockResolvedValue(DEFAULT_SETTINGS);
});

describe('PUT /settings', () => {
  it('upserts the caller’s own settings and answers with the stored view', async () => {
    const res = await postJson(app, '/settings', validBody(), 'PUT');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(DEFAULT_SETTINGS);
    const [filter, update, options] = UserSettings.findOneAndUpdate.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(filter).toEqual({ userId: USER_ID });
    expect(options).toEqual({ upsert: true });
    expect(update).toMatchObject({ $setOnInsert: { userId: USER_ID } });
  });

  it('answers from getSettings rather than echoing the request', async () => {
    /* The response is the *stored* view, which is not the same shape as the input: the key goes
       up and never comes back, replaced by `hasLlmKey`. Echoing the body would send the key
       straight back to the browser. */
    const res = await postJson(app, '/settings', validBody({ llmApiKey: 'sk-secret' }), 'PUT');

    expect(await res.text()).not.toContain('sk-secret');
    expect(settings.getSettings).toHaveBeenCalledWith(USER_ID);
  });

  it('leaves the key untouched when the body does not mention it', async () => {
    await postJson(app, '/settings', validBody(), 'PUT');

    expect('llmApiKey' in updateSet()).toBe(false);
  });

  it('stores a key that was sent, and an empty string as a removal', async () => {
    await postJson(app, '/settings', validBody({ llmApiKey: 'sk-new' }), 'PUT');
    expect(updateSet().llmApiKey).toBe('sk-new');

    resetModels(UserSettings);
    await postJson(app, '/settings', validBody({ llmApiKey: '' }), 'PUT');
    expect(updateSet().llmApiKey).toBe('');
  });

  it('normalises the base URL so the endpoint path can be appended', async () => {
    await postJson(
      app,
      '/settings',
      validBody({ llmBaseUrl: 'http://spark.local:8000/v1/' }),
      'PUT',
    );

    expect(updateSet().llmBaseUrl).toBe('http://spark.local:8000/v1');
  });

  it('refuses a body that is not settings', async () => {
    const res = await postJson(app, '/settings', { regionId: 'Shenzhen!' }, 'PUT');

    expect(res.status).toBe(400);
    expect(UserSettings.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
