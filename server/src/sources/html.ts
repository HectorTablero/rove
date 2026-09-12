import { MAX_SNAPSHOT_BODY_BYTES, MAX_SNAPSHOT_TEXT_LENGTH } from '@rove/shared';
import { parse } from 'node-html-parser';

/* Shared HTML helpers for the resolvers: fetching like a browser, stripping what a snapshot must
   not keep, and reading the handful of tags every page has. */

/** A desktop Chrome UA. Both Instagram and Xiaohongshu serve their share pages to it; a bare
    `node-fetch` UA gets a login wall from one and a blank shell from the other. */
export const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

export interface Fetched {
  finalUrl: string;
  status: number;
  contentType: string;
  text: string;
}

/** Fetch a page following redirects, with a timeout and a size cap on what is read. */
export async function fetchPage(url: URL, init: RequestInit = {}): Promise<Fetched> {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: BROWSER_HEADERS,
    signal: AbortSignal.timeout(15_000),
    ...init,
  });
  // Read at most a few MB: a share page is ~1 MB of JS state; anything bigger is not a post.
  const reader = res.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.byteLength;
      if (total > 4 * 1024 * 1024) {
        await reader.cancel();
        break;
      }
    }
  }
  const text = new TextDecoder('utf-8').decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
  return {
    finalUrl: res.url || url.toString(),
    status: res.status,
    contentType: res.headers.get('content-type') ?? '',
    text,
  };
}

/** Drop scripts, styles and comments — none of it is content, and script is what a snapshot
    must never replay. Optional `keep` lets a resolver hold on to one state blob it already read. */
export function stripScripts(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

const encoder = new TextEncoder();

/** Cut a body to the snapshot cap on a character boundary, measured in UTF-8 bytes. */
export function capBody(body: string): string {
  if (encoder.encode(body).length <= MAX_SNAPSHOT_BODY_BYTES) return body;
  let lo = 0;
  let hi = body.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (encoder.encode(body.slice(0, mid)).length <= MAX_SNAPSHOT_BODY_BYTES) lo = mid;
    else hi = mid - 1;
  }
  return body.slice(0, lo);
}

export const capText = (text: string): string =>
  text.length > MAX_SNAPSHOT_TEXT_LENGTH ? text.slice(0, MAX_SNAPSHOT_TEXT_LENGTH) : text;

/** Collapse runs of whitespace, decode entities, trim. What every text field goes through. */
export const cleanText = (text: string): string =>
  decodeEntities(text)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

export interface OpenGraph {
  title: string | null;
  description: string | null;
}

/** `og:title` / `og:description`, falling back to `<title>` and `<meta name=description>`. */
export function readOpenGraph(html: string): OpenGraph {
  const root = parse(html);
  const meta = (selector: string): string | null => {
    const content = root.querySelector(selector)?.getAttribute('content');
    return content ? cleanText(content) : null;
  };
  const title =
    meta('meta[property="og:title"]') ??
    meta('meta[name="twitter:title"]') ??
    (root.querySelector('title')?.text ? cleanText(root.querySelector('title')!.text) : null);
  const description =
    meta('meta[property="og:description"]') ??
    meta('meta[name="twitter:description"]') ??
    meta('meta[name="description"]');
  return { title, description };
}

/** Strip tracking parameters that make one page look like several. */
export function canonicalize(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (
        /^(utm_|fbclid|igsh|igshid|ref|share_id|app_platform|app_version|xsec_source)/.test(key)
      ) {
        parsed.searchParams.delete(key);
      }
    }
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url;
  }
}
