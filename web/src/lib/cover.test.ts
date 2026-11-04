import { describe, expect, it } from 'vitest';
import { coverSrc } from './cover';

describe('coverSrc', () => {
  it('sends Douban posters through the proxy and leaves other hosts alone', () => {
    const douban = 'https://img3.doubanio.com/pview/event_poster/plarge/public/x.jpg';
    expect(coverSrc(douban)).toBe(`/api/cover?url=${encodeURIComponent(douban)}`);
    expect(coverSrc('https://p0.pipi.cn/a.jpg')).toBe('https://p0.pipi.cn/a.jpg');
    expect(coverSrc(null)).toBeNull();
    expect(coverSrc('not a url')).toBeNull();
  });
});
