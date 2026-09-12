import { expect, test } from '../support/app';
import { mapHeading } from '../support/routes';

/* The passcode, set the way a person sets it and then survived a restart.
 *
 * Deliberately not seeded as a pre-baked `appLock` blob. Doing that would mean this spec computing
 * a PBKDF2 hash of its own — a second implementation of the exact thing under test, which would
 * agree with the app right up until one of them changed. Driving the settings UI means the hash is
 * produced by the app, stored by the app, and verified by the app, and the test only ever asserts
 * on what a user can see.
 *
 * The other assertion here cannot be made anywhere but in a real browser: that while locked, no
 * content is *anywhere in the document*. `LockScreen` replaces the router rather than covering it,
 * so there is no route mounted behind it. */

const PASSCODE = '4821';
const SECRET = 'The private place I saved';

const secretPlace = {
  id: '507f1f77bcf86cd799439011',
  regionId: 'shenzhen',
  kind: 'place' as const,
  title: SECRET,
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
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-08-01T09:00:00.000Z',
};

/**
 * Turn the lock on through Settings → Security, exactly as a person would, navigating by clicking:
 * the lock's initial state is read at module load, so after a passcode exists every `page.goto` is
 * a restart that locks the app again.
 */
async function setPasscodeThroughSettings(page: import('@playwright/test').Page) {
  await page.getByRole('link', { name: 'Settings' }).first().click();
  await page.getByRole('switch', { name: 'Require a passcode' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('New passcode').fill(PASSCODE);
  await dialog.getByLabel('Confirm passcode').fill(PASSCODE);
  await dialog.getByRole('button', { name: 'Save' }).click();

  // `important: true`, so this one survives the quiet-notifications default.
  await expect(page.getByText('Passcode saved')).toBeVisible({ timeout: 20_000 });
}

test('the passcode survives a restart and hides everything until it is given', async ({
  app: page,
  api,
}) => {
  api.state.items = [secretPlace];

  // Pull it down first, so there is genuinely something in the local database to hide.
  await page.goto('/list');
  await expect(page.getByText(SECRET)).toBeVisible({ timeout: 20_000 });

  await setPasscodeThroughSettings(page);

  /* Back to the list by clicking, so the route sitting behind the lock is the one with something
     to hide. */
  await page.getByRole('link', { name: 'List' }).first().click();
  await expect(page.getByText(SECRET)).toBeVisible();

  await page.reload();

  await expect(page.getByText('Rove is locked')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(SECRET);
  await expect(page.getByRole('link', { name: 'Map' })).toHaveCount(0);

  await page.getByLabel('Passcode').fill('0000');
  await page.getByRole('button', { name: 'Unlock' }).click();

  await expect(page.getByRole('alert')).toHaveText('That passcode is not right.');
  await expect(page.locator('body')).not.toContainText(SECRET);
  await expect(page.getByLabel('Passcode')).toHaveValue('');

  await page.getByLabel('Passcode').fill(PASSCODE);
  await page.getByRole('button', { name: 'Unlock' }).click();

  // Straight back to the list that was behind it, intact — the lock hides, it never deletes.
  await expect(page.getByText(SECRET)).toBeVisible({ timeout: 20_000 });
});

test('the stored record is a salted hash and never the passcode', async ({ app: page }) => {
  await page.goto('/map');
  await expect(mapHeading(page)).toBeVisible();
  await setPasscodeThroughSettings(page);

  const stored = await page.evaluate(() => localStorage.getItem('appLock'));

  expect(stored).not.toBeNull();
  expect(stored).not.toContain(PASSCODE);

  const config = JSON.parse(stored!) as { hash: string; salt: string; iterations: number };
  expect(config.hash).toBeTruthy();
  expect(config.salt).toBeTruthy();
  expect(config.iterations).toBeGreaterThanOrEqual(100_000);
});

test('the lock is device-local, so it is not something the server can hand over', async ({
  app: page,
  api,
}) => {
  await page.goto('/map');
  await expect(mapHeading(page)).toBeVisible();
  await setPasscodeThroughSettings(page);

  const lockCalls = api.calls.filter(
    (call) => JSON.stringify(call.body ?? '').includes(PASSCODE) || /lock/i.test(call.path),
  );
  expect(lockCalls).toEqual([]);
});
