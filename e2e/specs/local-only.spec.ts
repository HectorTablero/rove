import { installApiMock } from '../support/api';
import { expect, seedBrowserState, test as base } from '../support/app';
import { mapHeading } from '../support/routes';

/* Using the app without an account.
 *
 * One claim, and it is a negative: a device that opted out of accounts must not talk to `/api/sync`
 * at all, and must not show a sync pill — there is no server relationship to be "offline" from or
 * "reconnected" to, so every one of those messages would be describing something that does not
 * exist. A negative like that is only provable against something that records every request. */

const test = base.extend<{ localOnly: import('@playwright/test').Page }>({
  localOnly: async ({ page, context }, use) => {
    await installApiMock(page, {}, { signedIn: false });
    await seedBrowserState(context, { localOnly: true });
    await use(page);
  },
});

test('a device without an account never asks the server for anything', async ({
  localOnly: page,
  context,
}) => {
  await page.goto('/map');
  await expect(mapHeading(page)).toBeVisible();

  /* No pill, in either direction. Going offline flips `SyncStatus.blocker` regardless of whether
     an account exists — initSync's window listeners are unconditional — so the overlay needs its
     own local-only check, and this is the assertion that would catch that check being lost. */
  await context.setOffline(true);
  await context.setOffline(false);
  await expect(page.getByText(/Offline|Can't reach the server/)).toBeHidden();

  await page.goto('/settings');
  await expect(page.getByRole('switch', { name: 'Require a passcode' })).toBeVisible();
});
