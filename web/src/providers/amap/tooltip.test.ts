import { describe, expect, it, vi } from 'vitest';

vi.mock('@amap/amap-jsapi-loader', () => ({ default: { load: vi.fn() } }));
const { placeTip, tooltipHtml } = await import('./renderer');

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

describe('placeTip', () => {
  const bounds = { left: 0, top: 0, right: 800, bottom: 600 };
  const dotAt = (x: number, y: number) => ({
    left: x - 7,
    right: x + 7,
    top: y - 7,
    bottom: y + 7,
  });

  it('centres the card above a dot with room around it, the arrow straight down', () => {
    expect(placeTip(dotAt(400, 300), 200, 120, bounds)).toEqual({
      below: false,
      shift: 0,
      base: 100,
      tip: 100,
    });
  });

  it('keeps the card 8px inside the left edge, and leans the arrow out to a dot by it', () => {
    const { shift, base, tip } = placeTip(dotAt(4, 300), 200, 120, bounds);
    expect(4 - 100 + shift).toBe(8); // the card's left edge
    expect(tip).toBe(-4); // on the dot, past the card's edge
    expect(base).toBe(18); // still on the card, clear of its corner
  });

  it('keeps the card 8px inside the right edge', () => {
    const { shift } = placeTip(dotAt(790, 300), 200, 120, bounds);
    expect(790 + 100 + shift).toBe(792);
  });

  it('goes below a dot near the top, and stays above when below is no better', () => {
    expect(placeTip(dotAt(400, 40), 200, 120, bounds).below).toBe(true);
    expect(placeTip(dotAt(400, 300), 200, 120, bounds).below).toBe(false);
  });
});
