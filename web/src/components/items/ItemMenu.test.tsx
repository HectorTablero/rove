import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import { renderWithProviders } from '@/test/renderWithProviders';
import { aPlace, seed } from '@/test/seed';

/* Right-click on anything carrying data-item-id opens that item's menu; elsewhere the browser's
   own menu stays. The actions are the sheet's (useItemActions), so only the wiring is tested. */

vi.mock('@/lib/authClient', () => ({ useSession: () => ({ data: null }) }));

const { useItemMenu } = await import('./ItemMenu');

function Harness({ onOpenItem }: { onOpenItem: (id: string) => void }) {
  const { onContextMenu, menu } = useItemMenu('list', onOpenItem);
  return (
    <div onContextMenu={onContextMenu}>
      <button type="button" data-item-id="p">
        Row
      </button>
      <span>Elsewhere</span>
      {menu}
    </div>
  );
}

beforeEach(() => seed({ items: [aPlace({ id: 'p', title: 'Bionic Brew' })] }));

it('opens on a row and acts on that item', async () => {
  const onOpenItem = vi.fn();
  const user = userEvent.setup();
  renderWithProviders(<Harness onOpenItem={onOpenItem} />);

  fireEvent.contextMenu(screen.getByText('Row'), { clientX: 40, clientY: 40 });
  await user.click(await screen.findByRole('menuitem', { name: 'Mark visited' }));

  await waitFor(async () => expect((await db.items.get('p'))?.status).toBe('visited'));
});

it('leaves the browser menu alone off an item', () => {
  renderWithProviders(<Harness onOpenItem={() => {}} />);
  const event = fireEvent.contextMenu(screen.getByText('Elsewhere'));
  expect(event).toBe(true); // not prevented
  expect(screen.queryByRole('menu')).toBeNull();
});
