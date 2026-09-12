import { describe, expect, it } from 'vitest';
import { firstUrlIn, sharedUrlFromParams } from './shareTarget';

describe('sharedUrlFromParams', () => {
  it('prefers url when the sharing app filled it', () => {
    const params = new URLSearchParams({ url: 'https://www.instagram.com/p/abc/', text: 'look' });
    expect(sharedUrlFromParams(params)).toBe('https://www.instagram.com/p/abc/');
  });

  it('finds the link inside text, which is where Android puts it', () => {
    const params = new URLSearchParams({
      text: '78 深圳宝藏咖啡馆 - 小红书 http://xhslink.com/m/1gJ5tOG6M1b，复制本条信息',
    });
    expect(sharedUrlFromParams(params)).toBe('http://xhslink.com/m/1gJ5tOG6M1b');
  });

  it('is null when nothing shared is a link', () => {
    expect(sharedUrlFromParams(new URLSearchParams({ text: 'just words' }))).toBeNull();
    expect(sharedUrlFromParams(new URLSearchParams())).toBeNull();
  });
});

describe('firstUrlIn', () => {
  it('drops trailing punctuation in either script', () => {
    expect(firstUrlIn('see https://example.com/a.')).toBe('https://example.com/a');
    expect(firstUrlIn('看这个 https://example.com/a。')).toBe('https://example.com/a');
    expect(firstUrlIn('(https://example.com/a)')).toBe('https://example.com/a');
  });

  it('keeps query strings, which carry the tokens share links depend on', () => {
    expect(
      firstUrlIn('x https://www.xiaohongshu.com/discovery/item/1?xsec_token=AB&type=normal'),
    ).toBe('https://www.xiaohongshu.com/discovery/item/1?xsec_token=AB&type=normal');
  });
});
