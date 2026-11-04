import { expect, test } from '../support/app';

/* Title translation, with the browser's Translator faked: Chromium in CI has no on-device model,
   and what is under test is the app's side — the switch exists only where an engine does, and a
   translated title never hides the original. */

const place = {
  id: '507f1f77bcf86cd799439041',
  regionId: 'shenzhen',
  kind: 'place' as const,
  title: '海上世界',
  altTitles: [],
  categories: [],
  status: 'saved' as const,
  snapshotIds: [],
  sourceUrls: [],
  expiresAt: null,
  price: null,
  coverUrl: null,
  location: {
    point: { lon: 113.9167, lat: 22.4869, datum: 'GCJ02' as const },
    address: null,
    providerRef: null,
  },
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-08-01T09:00:00.000Z',
};

test('with an on-device translator, titles show translated with the original underneath', async ({
  app: page,
  api,
}) => {
  await page.addInitScript(() => {
    // Like Chrome: "downloadable" until the first create() fetches the model, "available" after,
    // across reloads.
    const KEY = 'e2e:translator-downloaded';
    (globalThis as unknown as { Translator: unknown }).Translator = {
      availability: async () => (localStorage.getItem(KEY) ? 'available' : 'downloadable'),
      create: async () => {
        localStorage.setItem(KEY, '1');
        return { translate: async (text: string) => `Sea World (${text.length})` };
      },
    };
  });
  api.state.items = [place];

  await page.goto('/settings');
  await page.getByRole('switch', { name: 'Translate titles' }).click();
  await expect(page.getByRole('switch', { name: 'Translate titles' })).toBeChecked();

  await page.goto('/list');
  const list = page.getByRole('list', { name: 'List' });
  await expect(list.getByText('Sea World (4)')).toBeVisible({ timeout: 20_000 });
  await expect(list.getByText('海上世界')).toBeVisible();

  await list.getByText('Sea World (4)').click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'Sea World (4)' })).toBeVisible();
  await expect(sheet.getByText('海上世界')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Copy original name' })).toBeVisible();
});

test('without a translator the switch is not offered', async ({ app: page }) => {
  await page.goto('/settings');
  await expect(page.getByText('Theme').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('switch', { name: 'Translate titles' })).toHaveCount(0);
});
