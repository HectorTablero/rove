import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import { renderWithProviders } from '@/test/renderWithProviders';
import { aPlace, seed } from '@/test/seed';

/* Unkeeping something you put nothing into just happens; one you rated asks first. */

vi.mock('@/lib/authClient', () => ({ useSession: () => ({ data: null }) }));

const { ItemSheet } = await import('./ItemSheet');

const T = '2026-08-01T09:00:00.000Z';
// A kept feed suggestion: saved, with the expiry only feed items carry.
const kept = aPlace({ id: 'k', title: 'Bionic Brew', expiresAt: '2999-01-01T00:00:00.000Z' });

beforeEach(() => seed({}));

const unkeep = async () => {
  const user = userEvent.setup();
  renderWithProviders(<ItemSheet itemId="k" onClose={() => {}} />);
  await user.click(await screen.findByRole('button', { name: 'Unkeep' }));
  return user;
};

it('unkeeps at once when there is nothing to lose', async () => {
  await seed({ items: [kept] });
  await unkeep();
  await waitFor(async () => expect((await db.items.get('k'))?.status).toBe('candidate'));
  expect(screen.queryByText('Unkeep this?')).toBeNull();
});

it('asks first when the item has a rating', async () => {
  await seed({
    items: [kept],
    reviews: [
      { id: 'r', itemId: 'k', rating: 4, notes: '', visits: [], createdAt: T, updatedAt: T },
    ],
  });
  const user = await unkeep();
  await screen.findByRole('dialog', { name: 'Unkeep this?' });
  expect((await db.items.get('k'))?.status).toBe('saved');

  await user.click(screen.getAllByRole('button', { name: 'Unkeep' }).at(-1)!);
  await waitFor(async () => expect((await db.items.get('k'))?.status).toBe('candidate'));
});

it('turns the copy button into a check once the name is copied', async () => {
  // Translated, so the original and its copy button show: a Chinese title, translation on.
  vi.spyOn(await import('@/lib/translate'), 'useTranslatedText').mockReturnValue('Happy Tea');
  await seed({ items: [{ ...kept, title: '喜茶' }] });
  const user = userEvent.setup();
  renderWithProviders(<ItemSheet itemId="k" onClose={() => {}} />);

  await user.click(await screen.findByRole('button', { name: 'Copy original name' }));

  expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  expect(await navigator.clipboard.readText()).toBe('喜茶');
});
