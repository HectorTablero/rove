import { expect, test } from '../support/app';

/* The whole of Phase 1's promise, end to end in a real browser: a shared link becomes a saved
 * place with a datum-tagged location, it shows up in the list, and its rating and notes are
 * queued for the server as ordinary writes. The map tiles themselves are not asserted on: a build
 * may or may not carry a map key, and the SDK is not loaded from this harness. */

const SHARED = 'http://xhslink.com/m/1gJ5tOG6M1b';

test('a shared link becomes a saved, geocoded place', async ({ app: page, api }) => {
  await page.goto(`/add?text=${encodeURIComponent(`78 深圳宝藏咖啡馆 ${SHARED}，复制本条信息`)}`);

  // 1. The link was read and its caption is on screen; the snapshot was written locally.
  await expect(page.getByText(api.fixtures.caption)).toBeVisible({ timeout: 20_000 });
  await api.waitForCall('POST', /^\/api\/snapshots$/);
  // Without a model configured, the screen says so rather than pretending to have looked.
  await expect(page.getByText('Set an extraction model')).toBeVisible();

  // 2. Typing a name asks the geocoder; choosing a candidate shows it.
  await page.getByLabel('Place').fill('bionic');
  const option = page.getByRole('option', { name: /Bionic Brew/ });
  await expect(option).toBeVisible({ timeout: 20_000 });
  await option.click();
  // The preview names the candidate whether or not this build carries a map key.
  await expect(page.getByText('南山区 海上世界').last()).toBeVisible();

  // 3. Save → an item with the geocoder's GCJ-02 point and provider ref goes to the server.
  await page.getByRole('button', { name: 'Save' }).click();
  const post = await api.waitForCall('POST', /^\/api\/items$/, 20_000);
  const body = post.body as {
    kind: string;
    title: string;
    location: { point: { datum: string }; providerRef: { id: string } };
    sourceUrls: string[];
    snapshotIds: string[];
  };
  expect(body.kind).toBe('place');
  expect(body.title).toBe('bionic');
  expect(body.location.point.datum).toBe('GCJ02');
  expect(body.location.providerRef.id).toBe('B0FFH1TEST');
  expect(body.sourceUrls).toEqual([SHARED]);
  expect(body.snapshotIds).toHaveLength(1);

  // 4. The sheet opened on the saved place; rating and visiting queue ordinary writes.
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'bionic' })).toBeVisible();
  await sheet.getByRole('radio', { name: '4 stars' }).click();
  const review = await api.waitForCall('POST', /^\/api\/reviews$/, 20_000);
  expect((review.body as { rating: number }).rating).toBe(4);
  await sheet.getByRole('button', { name: 'Mark visited' }).click();
  const patch = await api.waitForCall('PATCH', /^\/api\/items\//, 20_000);
  expect((patch.body as { status: string }).status).toBe('visited');

  // 5. Closing lands on the list, where the place is, marked visited.
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(page).toHaveURL(/\/list$/);
  const row = page
    .getByRole('list', { name: 'List' })
    .getByRole('button')
    .filter({ hasText: 'bionic' });
  await expect(row).toBeVisible();
  await expect(row.getByText('Visited')).toBeVisible();
});

test('sharing the same place twice merges into one item', async ({ app: page, api }) => {
  await page.goto(`/add?text=${encodeURIComponent(SHARED)}`);
  await expect(page.getByText(api.fixtures.caption)).toBeVisible({ timeout: 20_000 });
  await page.getByLabel('Place').fill('Bionic Brew');
  await page.getByRole('option', { name: /Bionic Brew/ }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await api.waitForCall('POST', /^\/api\/items$/, 20_000);
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

  // A second post about the same POI: no second item, the existing one gains the link.
  await page.goto(`/add?text=${encodeURIComponent('https://www.instagram.com/p/C1abc/')}`);
  await expect(page.getByText(api.fixtures.caption)).toBeVisible({ timeout: 20_000 });
  await page.getByLabel('Place').fill('Bionic');
  await page.getByRole('option', { name: /Bionic Brew/ }).click();
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByText(/Already saved as Bionic Brew/)).toBeVisible({ timeout: 20_000 });
  const patch = await api.waitForCall('PATCH', /^\/api\/items\//, 20_000);
  expect((patch.body as { sourceUrls: string[] }).sourceUrls).toEqual([
    SHARED,
    'https://www.instagram.com/p/C1abc/',
  ]);
  expect(api.calls.filter((c) => c.method === 'POST' && c.path === '/api/items')).toHaveLength(1);
});

test('a post whose text cannot be read takes a pasted caption instead', async ({
  app: page,
  api,
}) => {
  // With a model configured: a failed read must still not be sent to it.
  api.state.settings = {
    ...api.state.settings,
    llmBaseUrl: 'https://llm.example/v1',
    llmModel: 'm',
  };
  await page.goto(`/add?text=${encodeURIComponent('https://www.instagram.com/p/UNREADABLE/')}`);

  await expect(page.getByText('caption_missing')).toBeVisible({ timeout: 20_000 });
  expect(api.calls.some((call) => call.path.includes('/ingest/extract'))).toBe(false);
  await page.getByLabel('Paste the caption').fill(api.fixtures.caption);
  await page.getByRole('button', { name: 'Find places in it' }).click();

  // The caption now reads like one the link carried, and is kept on the link's snapshot.
  await expect(page.getByText(api.fixtures.caption)).toBeVisible();
  await expect(page.getByText('caption_missing')).toBeHidden();
  const patch = await api.waitForCall('PATCH', /^\/api\/snapshots\//, 20_000);
  expect((patch.body as { text: string }).text).toBe(api.fixtures.caption);
});
