import type { ItemDto } from '@rove/shared';
import { screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders';
import { aPlace } from '@/test/seed';
import { ListRows } from './ListRows';

/* An event row's date line says only what the stub cannot: the time. The full date is the stub's
   hover, and what a screen reader hears. */

const TZ = 'Asia/Shanghai';
const event = (id: string, when: Record<string, unknown>): ItemDto =>
  ({
    ...aPlace({ id, title: id }),
    kind: 'event',
    venue: null,
    location: null,
    when: { tz: TZ, end: null, allDay: false, ...when },
  }) as ItemDto;

const render = (items: ItemDto[]) =>
  renderWithProviders(
    <ListRows items={items} reviews={new Map()} grouped={false} tz={TZ} onOpen={() => {}} />,
  );

it('shows the time of a timed event, and no weekday line for an all-day one', () => {
  render([
    event('Gig', { start: '2026-11-07T11:30:00.000Z', end: '2026-11-07T13:30:00.000Z' }),
    event('Fair', { start: '2026-11-08T00:00:00.000Z', allDay: true }),
  ]);
  const gig = screen.getByRole('button', { name: /Gig/ });
  expect(gig).toHaveTextContent(/7:30\s*–\s*9:30\sPM/);
  expect(screen.getByRole('button', { name: /Fair/ })).not.toHaveTextContent('Sunday');
  expect(gig).toHaveTextContent(/Sat, Nov 7/);
});
