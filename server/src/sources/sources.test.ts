import { describe, expect, it } from 'vitest';
import { SOURCES } from '@rove/shared';
import { canonicalize, capBody, readOpenGraph, stripScripts } from './html';
import { RESOLVERS } from './index';
import { readEmbedCaption, shortcodeOf } from './instagramOembed';
import { readNoteState } from './xiaohongshuShare';

/* The parsers, against fixtures shaped like the real pages — no network in tests. The fetching
   half is a `fetch` with a UA; what can go wrong is here, in what is read out of the markup. */

describe('registry', () => {
  it('has a resolver for every source manifest, and nothing else', () => {
    expect(RESOLVERS.map((r) => r.id).sort()).toEqual(SOURCES.map((s) => s.id).sort());
  });
});

describe('xiaohongshu: readNoteState', () => {
  const page = (state: string) =>
    `<html><head><title>x</title></head><body><script>window.__INITIAL_STATE__=${state};</script></body></html>`;

  it('finds the note wherever the state keeps it, and survives `undefined`', () => {
    const state = `{"note":{"noteDetailMap":{"abc":{"note":{"noteId":"abc","title":"深圳宝藏咖啡馆","desc":"在南山的 Bionic Brew…","tagList":[{"name":"咖啡"}],"user":{"nickname":"小明"},"time":1720000000,"extra":undefined}}}}}`;
    const note = readNoteState(page(state));
    expect(note?.title).toBe('深圳宝藏咖啡馆');
    expect(note?.desc).toContain('Bionic Brew');
    expect(note?.tagList?.[0].name).toBe('咖啡');
    expect(note?.user?.nickname).toBe('小明');
  });

  it('is null when the blob is missing, so the caller falls back rather than guessing', () => {
    expect(readNoteState('<html><body>login please</body></html>')).toBeNull();
    expect(readNoteState(page('{not json'))).toBeNull();
  });
});

describe('instagram', () => {
  it('reads the shortcode from every post URL shape', () => {
    expect(shortcodeOf(new URL('https://www.instagram.com/p/C1abc_-/'))).toBe('C1abc_-');
    expect(shortcodeOf(new URL('https://www.instagram.com/reel/C1abc/?igsh=x'))).toBe('C1abc');
    expect(shortcodeOf(new URL('https://www.instagram.com/someone/'))).toBeNull();
  });

  it('reads the caption out of the captioned embed, minus the username link', () => {
    const html = `<div class="Caption"><a class="CaptionUsername" href="/x/">shenzhen.eats</a>
      Best 云吞 in 福田: 老街 wonton house, 华强北地铁站 B 出口 🍜
      <div class="CaptionComments">View all 12 comments</div></div>`;
    const caption = readEmbedCaption(html);
    expect(caption).toContain('老街 wonton house');
    expect(caption).not.toContain('shenzhen.eats');
    expect(caption).not.toContain('View all');
    expect(readEmbedCaption('<div>no caption block</div>')).toBeNull();
  });
});

describe('html helpers', () => {
  it('reads Open Graph with the plain tags as fallback', () => {
    const html = `<html><head><title>Page &amp; title</title>
      <meta property="og:description" content="A &#x1F35C; place"></head></html>`;
    expect(readOpenGraph(html)).toEqual({ title: 'Page & title', description: 'A 🍜 place' });
  });

  it('strips scripts and styles and nothing else', () => {
    const html = '<p>keep</p><script>alert(1)</script><style>p{}</style><!-- c --><b>me</b>';
    expect(stripScripts(html)).toBe('<p>keep</p><b>me</b>');
  });

  it('caps a body on a character boundary measured in bytes', () => {
    const capped = capBody('汉'.repeat(200_000)); // 600 kB
    expect(new TextEncoder().encode(capped).length).toBeLessThanOrEqual(262_144);
    expect(capped.endsWith('汉')).toBe(true);
  });

  it('drops tracking parameters and keeps the ones that identify the content', () => {
    expect(
      canonicalize(
        'https://www.xiaohongshu.com/discovery/item/1?xsec_token=T&app_platform=ios&share_id=9',
      ),
    ).toBe('https://www.xiaohongshu.com/discovery/item/1?xsec_token=T');
    expect(canonicalize('https://www.instagram.com/p/C1/?igsh=abc#x')).toBe(
      'https://www.instagram.com/p/C1/',
    );
  });
});
