import type { ItemDto, MentionDto, SnapshotDto } from '@rove/shared';
import { sourceById } from '@rove/shared';
import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSnapshots } from '@/api/hooks';
import { Label } from '@/components/ui/label';
import { markMentions } from '@/lib/mentionMarks';

/* Where an item came from, in its sheet: each post it was found in (a pasted Instagram or 小红书
 * link, a feed's listing), quoted at the sentence that names it, with the source and a link back.
 * Links with no post kept on this device are still listed, as before, by their site. */

/** How much of a caption stands in for the quote when no extracted sentence names the item. */
const EXCERPT = 160;

const fold = (text: string) => text.normalize('NFKC').toLocaleLowerCase();

/** The sentence the extractor found this item in, or the caption's opening. */
function quoteFor(snapshot: SnapshotDto, names: Set<string>): string | null {
  const mention = snapshot.extraction?.mentions.find((m) =>
    [m.nameText, ...(m.aliases ?? [])].some((name) => names.has(fold(name))),
  );
  if (mention) return mention.evidence;
  const text = snapshot.text.trim();
  if (!text) return null;
  return text.length > EXCERPT ? `${text.slice(0, EXCERPT).trimEnd()}…` : text;
}

const sourceName = (id: string) => {
  try {
    return sourceById(id).name;
  } catch {
    return null; // a source this build no longer ships
  }
};

const hostname = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

export function PostOrigin({ item }: { item: ItemDto }) {
  const { t } = useTranslation();
  const { data: snapshots = [] } = useSnapshots(item.snapshotIds);
  const names = new Set([item.title, ...item.altTitles].map(fold));
  // The item's own names, marked in the quote the way the Add page marks a found place.
  const self: MentionDto = {
    nameText: item.title,
    aliases: item.altTitles,
    addressText: null,
    searchText: null,
    evidence: '',
  };
  const covered = new Set(snapshots.flatMap((s) => [s.url, s.canonicalUrl]));
  const others = item.sourceUrls.filter((url) => !covered.has(url));
  if (!snapshots.length && !others.length) return null;

  return (
    <div className="flex flex-col gap-2">
      {snapshots.length > 0 && <Label>{t('items.fromPost')}</Label>}
      {snapshots.map((snapshot) => {
        const quote = quoteFor(snapshot, names);
        const source = sourceName(snapshot.sourceId);
        return (
          <figure key={snapshot.id} className="flex flex-col gap-1.5">
            {quote && (
              <blockquote className="border-l-2 pl-3 text-sm whitespace-pre-line text-muted-foreground">
                {markMentions(quote, [self]).map((run, i) =>
                  run.mention === null ? (
                    <span key={i}>{run.text}</span>
                  ) : (
                    <mark key={i} className="bg-transparent font-medium text-foreground">
                      {run.text}
                    </mark>
                  ),
                )}
              </blockquote>
            )}
            <figcaption className="flex items-center gap-2 pl-3 text-xs text-muted-foreground">
              {source && <span>{source}</span>}
              <a
                href={snapshot.canonicalUrl ?? snapshot.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-2 hover:underline"
              >
                <ExternalLink className="size-3 shrink-0" />
                {t('items.openPost')}
              </a>
            </figcaption>
          </figure>
        );
      })}
      {others.length > 0 && (
        <div className="flex flex-col gap-1">
          <Label>{t('items.sources')}</Label>
          <ul className="flex flex-col gap-1">
            {others.map((url) => (
              <li key={url}>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex max-w-full items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
                >
                  <ExternalLink className="size-3 shrink-0" />
                  <span className="truncate">{hostname(url)}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
