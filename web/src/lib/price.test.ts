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

  it('shows anything it cannot read exactly as printed', () => {
    expect(show('VIP 套票 请咨询')).toBe('VIP 套票 请咨询');
    expect(show('$20')).toBe('$20');
    expect(show('80/120/180元')).toBe('80/120/180元');
    expect(parsePrice('一二三')).toBeNull();
  });
});
