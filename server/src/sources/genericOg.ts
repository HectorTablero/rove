import {
  canonicalize,
  capBody,
  capText,
  cleanText,
  fetchPage,
  readOpenGraph,
  stripScripts,
} from './html';
import { failed, type Resolver } from './types';

/* The fallback: any page, read through its Open Graph tags. Also what the two specific resolvers
   degrade to when their own path fails, which is why it is exported as a function too. */

export async function resolveOpenGraph(url: URL) {
  let page;
  try {
    page = await fetchPage(url);
  } catch {
    return failed('fetch_failed', url);
  }
  if (page.status >= 400) return failed(`http_${page.status}`, url);
  if (!/html/i.test(page.contentType)) return failed('not_html', url);

  const og = readOpenGraph(page.text);
  const text = capText(cleanText([og.title, og.description].filter(Boolean).join('\n')));
  return {
    canonicalUrl: canonicalize(page.finalUrl),
    contentType: page.contentType,
    body: capBody(stripScripts(page.text)),
    text,
    error: text ? null : 'no_text',
    title: og.title,
  };
}

export const genericOgResolver: Resolver = { id: 'generic-og', resolve: resolveOpenGraph };
