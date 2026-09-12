/**
 * The URL a share-sheet launch carried, if any.
 *
 * The manifest declares `share_target` with `url`, `text` and `title` parameters, but Android does
 * not honour that split: when an app shares a link it arrives in `text`, often with the post's
 * caption in front of it, and `url` is empty. So every parameter is searched for the first thing
 * that parses as an http(s) URL, `url` first because when it *is* set it is the cleanest.
 *
 * Null rather than a guess when nothing parses: the add screen then opens empty, which is also
 * what typing the route by hand gets.
 */
export function sharedUrlFromParams(params: URLSearchParams): string | null {
  for (const key of ['url', 'text', 'title']) {
    const value = params.get(key);
    if (!value) continue;
    const found = firstUrlIn(value);
    if (found) return found;
  }
  return null;
}

/** The first http(s) URL in a piece of text, or null. */
export function firstUrlIn(text: string): string | null {
  /* Deliberately loose on the tail: share text puts the link at the end of a sentence, and a
     trailing full stop or closing bracket is punctuation, not path. Chinese punctuation counts —
     an XHS share reads "…复制后打开小红书 http://xhslink.com/m/abc，" with a full-width comma. */
  /* CJK characters end a URL too: a share caption runs straight into the link with no space, and
     no URL carries them unencoded. */
  const match = text.match(/https?:\/\/[^\s<>"'()（）「」【】，。；：！？、　-鿿]+/u);
  if (!match) return null;
  const candidate = match[0].replace(/[.,;:!?，。；：！？、]+$/u, '');
  try {
    return new URL(candidate).toString();
  } catch {
    return null;
  }
}
