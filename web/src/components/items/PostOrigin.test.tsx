import type { SnapshotDto } from '@rove/shared';
import { screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders';
import { aPlace, seed } from '@/test/seed';
import { PostOrigin } from './PostOrigin';

/* A place found in a post shows that post in its sheet: the sentence that names it, by any of its
   names, the source, and a link back. */

const T = '2026-11-01T00:00:00.000Z';
const post: SnapshotDto = {
  id: 's1',
  sourceId: 'xiaohongshu-share',
  url: 'https://xhslink.com/a',
  canonicalUrl: 'https://www.xiaohongshu.com/explore/1',
  fetchedAt: T,
  contentType: 'text/html',
  body: '',
  text: 'A hidden gem.\n📍Yunhai Square (盐田云海广场)\nOpening hours: 8:00 AM–5:30 PM',
  error: null,
  extraction: {
    model: 'm',
    at: T,
    mentions: [
      {
        nameText: '盐田云海广场',
        aliases: ['Yunhai Square'],
        addressText: null,
        searchText: null,
        evidence: '📍Yunhai Square (盐田云海广场)',
      },
    ],
  },
  createdAt: T,
  updatedAt: T,
};

it('quotes the post where it names the place, and links back to it', async () => {
  const item = aPlace({
    id: 'p',
    title: '云海广场',
    altTitles: ['盐田云海广场'],
    snapshotIds: ['s1'],
    sourceUrls: ['https://www.xiaohongshu.com/explore/1', 'https://example.com/review'],
  });
  await seed({ items: [item], snapshots: [post] });
  renderWithProviders(<PostOrigin item={item} />);

  expect(await screen.findByText('From the post')).toBeInTheDocument();
  expect(screen.getByRole('blockquote')).toHaveTextContent('📍Yunhai Square (盐田云海广场)');
  expect(screen.getByText('小红书')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open post' })).toHaveAttribute(
    'href',
    'https://www.xiaohongshu.com/explore/1',
  );
  // A link with no post kept stays listed by its site; the post's own link is not repeated.
  expect(screen.getByRole('link', { name: 'example.com' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'xiaohongshu.com' })).toBeNull();
});
