import { afterEach, describe, expect, it, vi } from 'vitest';
import { coverRouter, refererFor } from './cover';

describe('refererFor', () => {
  it('serves Douban image hosts over https, and nothing else', () => {
    expect(refererFor('https://img3.doubanio.com/p/x.jpg')).toBe('https://www.douban.com/');
    expect(refererFor('http://img3.doubanio.com/p/x.jpg')).toBeNull();
    expect(refererFor('https://doubanio.com.evil.example/x.jpg')).toBeNull();
    expect(refererFor('https://example.com/x.jpg')).toBeNull();
    expect(refererFor('not a url')).toBeNull();
  });
});

describe('GET /api/cover', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('refuses a host it does not serve without fetching anything', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const res = await coverRouter.request(
      '/?url=' + encodeURIComponent('https://example.com/a.jpg'),
    );
    expect(res.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fetches with the Referer the CDN wants and caches the image', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/jpeg' } }),
    );
    vi.stubGlobal('fetch', fetch);
    const url = 'https://img3.doubanio.com/pview/event_poster/plarge/public/3f5829d10cdebcc.jpg';
    const res = await coverRouter.request('/?url=' + encodeURIComponent(url));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(fetch).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        headers: expect.objectContaining({ Referer: 'https://www.douban.com/' }),
      }),
    );
  });

  it('never passes on something that is not an image', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>', { headers: { 'Content-Type': 'text/html' } })),
    );
    const res = await coverRouter.request(
      '/?url=' + encodeURIComponent('https://img1.doubanio.com/x'),
    );
    expect(res.status).toBe(404);
  });
});
