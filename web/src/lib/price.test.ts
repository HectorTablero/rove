import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { formatPrice, parsePrice } from './price';

const t = ((key: string, opts?: { price?: string }) =>
  key === 'price.from' ? `From ${opts?.price}` : key === 'price.free' ? 'Free' : key) as TFunction;
const show = (raw: string) => formatPrice(raw, t, 'en', 'CNY');

describe('formatPrice', () => {
  it('reads the shapes the Shenzhen feeds print', () => {
    expect(show('39.0元起')).toBe('From ¥39');
    expect(show('220.0元')).toBe('¥220');
    expect(show('¥56起')).toBe('From ¥56');
    expect(show('¥298')).toBe('¥298');
    expect(show('380-1680')).toBe('¥380–1,680');
    expect(show('¥180-280')).toBe('¥180–280');
    expect(show('免费')).toBe('Free');
    expect(show('49.5元')).toBe('¥49.5');
  });

  it('reads a list of price tiers as a range, however long', () => {
    // douban.com/event/38119896, full-width spaces and all.
    expect(show('1688元　1388元　1188元　888元　588元')).toBe('¥588–1,688');
    expect(show('80/120/180元')).toBe('¥80–180');
  });

  it('counts only the numbers marked as money inside a sentence', () => {
    expect(show('学生票 50元（限2人）')).toBe('¥50');
    expect(show('早鸟 ¥128 现场 ¥168 限量300张')).toBe('¥128–168');
  });

  it('shows anything it cannot read exactly as printed', () => {
    expect(show('VIP 套票 请咨询')).toBe('VIP 套票 请咨询');
    expect(show('$20')).toBe('$20');
    expect(parsePrice('一二三')).toBeNull();
  });
});
