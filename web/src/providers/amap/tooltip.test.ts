import { describe, expect, it, vi } from 'vitest';

vi.mock('@amap/amap-jsapi-loader', () => ({ default: { load: vi.fn() } }));
const { tooltipHtml } = await import('./renderer');

const base = {
  id: 'x',
  point: { lon: 113.9, lat: 22.5, datum: 'GCJ02' as const },
  title: 'Bionic <Brew>',
  status: 'visited' as const,
};
const tooltip = {
  kind: 'place' as const,
  kindLabel: 'Place',
  statusLabel: 'Visited',
  rating: 4,
  ratingLabel: 'Rated 4 stars',
  when: null,
  where: '南山区 "海上世界"',
  price: null,
  tags: ['bar'],
  visits: '2 visits',
  note: '<script>alert(1)</script>',
  coverUrl: null,
};

describe('tooltipHtml', () => {
  it('escapes every piece of text it is given', () => {
    const html = tooltipHtml({ ...base, tooltip });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<Brew>');
    expect(html).toContain('Bionic &#60;Brew&#62;');
    expect(html).toContain('&#34;海上世界&#34;');
  });

  it('fills as many stars as the rating, and omits what is missing', () => {
    const html = tooltipHtml({ ...base, tooltip });
    expect(html.match(/rove-tip-star is-on/g)).toHaveLength(4);
    expect(html.match(/class="rove-tip-star( is-on)?"/g)).toHaveLength(5);
    expect(html).not.toContain('rove-tip-fact-when');
    expect(html).not.toContain('rove-tip-cover');
    expect(html).toContain('data-kind="place"');
  });
});
