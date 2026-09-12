import { describe, expect, it } from 'vitest';
import { sourceForUrl } from './index';

const pick = (url: string, region = 'shenzhen') => sourceForUrl(new URL(url), region)?.id ?? null;

describe('sourceForUrl', () => {
  it('routes an Instagram post to oEmbed and a profile to nothing special', () => {
    expect(pick('https://www.instagram.com/p/C1abc/')).toBe('instagram-oembed');
    expect(pick('https://www.instagram.com/reel/C1abc/')).toBe('instagram-oembed');
    // A profile page is not a post: oEmbed cannot read it, so the generic fallback gets it.
    expect(pick('https://www.instagram.com/someone/')).toBe('generic-og');
  });

  it('routes every Xiaohongshu link shape to the share resolver', () => {
    expect(pick('http://xhslink.com/m/1gJ5tOG6M1b')).toBe('xiaohongshu-share');
    expect(pick('https://xhslink.cn/a/abc')).toBe('xiaohongshu-share');
    expect(pick('https://www.xiaohongshu.com/discovery/item/1?xsec_token=x')).toBe(
      'xiaohongshu-share',
    );
  });

  it('keeps a region-specific source out of a region it does not serve', () => {
    // Nothing else exists yet, so the generic page reader gets it — never null.
    expect(pick('http://xhslink.com/m/abc', 'somewhere-else')).toBe('generic-og');
  });

  it('refuses anything that is not http(s)', () => {
    expect(pick('ftp://example.com/x')).toBeNull();
    expect(pick('androidamap://navi?lat=1')).toBeNull();
  });
});
