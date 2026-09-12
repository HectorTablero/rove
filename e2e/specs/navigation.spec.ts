import { expect, test } from '../support/app';
import { mapHeading, ROUTES } from '../support/routes';

/* Every route, actually resolved.
 *
 * This is the only check in the repo that can catch a broken chunk split. Each page is a lazy
 * `import()` behind a Suspense boundary, and the build assigns them to chunks via `manualChunks` /
 * `chunkFileNames` — so a route can be perfectly correct in source and still fail to load in the
 * artefact that ships. The dev server never reproduces that: it serves modules on demand and there
 * are no chunks at all. Hence `vite preview` over a real build (see playwright.config.ts).
 */

test('every lazy route resolves in the built bundle', async ({ app: page }) => {
  await page.goto('/map');
  await expect(mapHeading(page)).toBeVisible();

  for (const { path, proof } of ROUTES) {
    await page.goto(path);
    /* Waiting on the page's *own* content, not on the URL. A chunk that fails to load leaves the
       Suspense fallback on screen indefinitely, and the URL is already correct by then. */
    await expect(proof(page)).toBeVisible({ timeout: 20_000 });
  }
});

test('the share target lands on the add screen with the link filled in and read', async ({
  app: page,
  api,
}) => {
  /* What Android actually sends: the caption and the link together in `text`, `url` empty. */
  await page.goto(`/add?title=&text=${encodeURIComponent('看看这个 http://xhslink.com/m/abc，')}`);

  await expect(page.getByLabel('Link')).toHaveValue('http://xhslink.com/m/abc', {
    timeout: 20_000,
  });
  // Resolved on arrival, without a tap: the caption the mock server answers with is on screen.
  await expect(page.getByText(api.fixtures.caption)).toBeVisible({ timeout: 20_000 });
});

test('an unknown path lands on the map rather than nowhere', async ({ app: page }) => {
  await page.goto('/no-such-page');

  await expect(page).toHaveURL(/\/map$/);
  await expect(mapHeading(page)).toBeVisible();
});

test('the pull populates the list, newest first', async ({ app: page, api }) => {
  const place = (id: string, title: string, createdAt: string) => ({
    id,
    regionId: 'shenzhen',
    kind: 'place' as const,
    title,
    altTitles: [],
    categories: [],
    status: 'saved' as const,
    snapshotIds: [],
    sourceUrls: [],
    expiresAt: null,
    location: {
      point: { lon: 114.05, lat: 22.54, datum: 'GCJ02' as const },
      address: null,
      providerRef: null,
    },
    createdAt,
    updatedAt: createdAt,
  });
  api.state.items = [
    place('507f1f77bcf86cd799439011', '文和友', '2026-08-01T09:00:00.000Z'),
    place('507f1f77bcf86cd799439012', 'Bionic Brew', '2026-08-02T09:00:00.000Z'),
  ];

  await page.goto('/list');
  await expect(page.getByText('Bionic Brew')).toBeVisible({ timeout: 20_000 });
  const titles = await page.locator('li span.block.truncate.font-medium').allTextContents();
  expect(titles).toEqual(['Bionic Brew', '文和友']);
});
