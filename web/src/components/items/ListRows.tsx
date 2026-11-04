import type { ItemDto, ItemKind, ReviewDto, WhenDto } from '@rove/shared';
import { Check, Clapperboard, Star } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { coverSrc } from '@/lib/cover';
import { formatPrice } from '@/lib/price';
import { useRegion } from '@/lib/region';
import { detectSource, useTranslatedText } from '@/lib/translate';
import { cn } from '@/lib/utils';

/* The list, one shape per kind rather than one card for everything.
 *
 * Events are tickets: a date stub, torn off by a dashed edge, then what and where and what it
 * costs. Films are a shelf of posters — the one thing every film feed reliably has. Places are a
 * quiet index: name, address, your stars. Status is a mark, not a badge: a dot for something new,
 * a check for somewhere you have been, nothing for the ordinary saved case. */

const GROUP_ORDER: ItemKind[] = ['event', 'film', 'place'];

export interface ListRowsProps {
  items: ItemDto[];
  reviews: Map<string, ReviewDto>;
  /** Group by kind under headings; off when the list is already filtered to one kind. */
  grouped: boolean;
  tz: string;
  onOpen: (id: string) => void;
}

export function ListRows({ items, reviews, grouped, tz, onOpen }: ListRowsProps) {
  const { t } = useTranslation();
  const groups = GROUP_ORDER.map((kind) => ({
    kind,
    items: items.filter((item) => item.kind === kind),
  })).filter((group) => group.items.length > 0);

  return (
    <ul aria-label={t('nav.list')} className="flex flex-col gap-7">
      {groups.map(({ kind, items: rows }) => (
        <li key={kind}>
          <section aria-labelledby={grouped ? `list-group-${kind}` : undefined}>
            {grouped && (
              <h2
                id={`list-group-${kind}`}
                className="mb-2.5 flex items-baseline gap-2 text-sm font-semibold"
              >
                {t(`list.kinds.${kind}`)}
                <span className="font-normal text-muted-foreground tabular-nums">
                  {rows.length}
                </span>
              </h2>
            )}
            {kind === 'film' ? (
              <ul
                className={cn(
                  grouped
                    ? '-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2'
                    : 'grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5',
                )}
              >
                {rows.map((item) =>
                  item.kind !== 'film' ? null : (
                    <li key={item.id} className={cn(grouped && 'w-28 shrink-0 snap-start')}>
                      <FilmCard item={item} tz={tz} onOpen={onOpen} />
                    </li>
                  ),
                )}
              </ul>
            ) : kind === 'event' ? (
              <ul className="flex flex-col gap-2">
                {rows.map((item) =>
                  item.kind !== 'event' ? null : (
                    <li key={item.id}>
                      <EventRow item={item} review={reviews.get(item.id)} tz={tz} onOpen={onOpen} />
                    </li>
                  ),
                )}
              </ul>
            ) : (
              <ul className="flex flex-col divide-y overflow-hidden rounded-xl border">
                {rows.map((item) =>
                  item.kind !== 'place' ? null : (
                    <li key={item.id}>
                      <PlaceRow item={item} review={reviews.get(item.id)} onOpen={onOpen} />
                    </li>
                  ),
                )}
              </ul>
            )}
          </section>
        </li>
      ))}
    </ul>
  );
}

/** The title in the UI language when translation is on, with the original underneath. */
function Title({ title, className }: { title: string; className?: string }) {
  const translated = useTranslatedText(title);
  return (
    <>
      <span className={cn('block truncate font-medium', className)}>{translated ?? title}</span>
      {translated && (
        <span
          lang={detectSource(title) ?? undefined}
          className="block truncate text-xs text-muted-foreground/80"
        >
          {title}
        </span>
      )}
    </>
  );
}

/** A dot for a suggestion nobody has looked at, a check for a place you have been. */
function StatusMark({ status, className }: { status: ItemDto['status']; className?: string }) {
  const { t } = useTranslation();
  if (status === 'candidate')
    return (
      <span className={cn('flex size-2 shrink-0 rounded-full bg-primary', className)}>
        <span className="sr-only">{t('items.status.candidate')}</span>
      </span>
    );
  if (status === 'visited')
    return (
      <span className={cn('shrink-0 text-primary', className)}>
        <Check className="size-4" aria-hidden />
        <span className="sr-only">{t('items.status.visited')}</span>
      </span>
    );
  return null;
}

/** Your rating, read-only and small. Nothing at all when there is none — no grey empty stars. */
function Stars({ rating }: { rating: number | null | undefined }) {
  const { t } = useTranslation();
  if (!rating) return null;
  return (
    <span className="flex shrink-0 items-center gap-px" title={t('list.rated', { count: rating })}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          aria-hidden
          className={cn(
            'size-3',
            n <= rating ? 'fill-primary text-primary' : 'fill-muted text-muted-foreground/40',
          )}
        />
      ))}
      <span className="sr-only">{t('list.rated', { count: rating })}</span>
    </span>
  );
}

const ROW =
  'w-full text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring';

const zoned = (iso: string, tz: string, lng: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(lng, { timeZone: tz, ...opts }).format(new Date(iso));

/** The stub: day large, month small, in the region's clock. A dashed edge tears it off the ticket. */
function DateStub({ when, tz }: { when: WhenDto | null; tz: string }) {
  const { t, i18n } = useTranslation();
  return (
    <span
      className={cn(
        'flex w-14 shrink-0 flex-col items-center justify-center border-r border-dashed py-2',
        when ? 'text-primary' : 'text-muted-foreground',
      )}
    >
      {when ? (
        <>
          <span className="text-xl leading-none font-semibold tabular-nums">
            {zoned(when.start, tz, i18n.language, { day: 'numeric' })}
          </span>
          <span className="mt-1 text-[11px] leading-none">
            {zoned(when.start, tz, i18n.language, { month: 'short' })}
          </span>
        </>
      ) : (
        <span className="px-1 text-center text-[11px] leading-tight">{t('list.noDate')}</span>
      )}
    </span>
  );
}

function EventRow({
  item,
  review,
  tz,
  onOpen,
}: {
  item: Extract<ItemDto, { kind: 'event' }>;
  review: ReviewDto | undefined;
  tz: string;
  onOpen: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const region = useRegion();
  const time =
    item.when && !item.when.allDay
      ? zoned(item.when.start, tz, i18n.language, {
          weekday: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })
      : item.when
        ? zoned(item.when.start, tz, i18n.language, { weekday: 'long' })
        : null;
  const where = item.venue ?? item.location?.address ?? null;
  const price = formatPrice(item.price, t, i18n.language, region.currency);
  return (
    <button
      type="button"
      onClick={() => onOpen(item.id)}
      className={cn(ROW, 'flex items-stretch rounded-xl border bg-card hover:bg-accent/40')}
    >
      <DateStub when={item.when} tz={tz} />
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-3 py-2.5">
        <Title title={item.title} />
        {where && <span className="truncate text-xs text-muted-foreground">{where}</span>}
        {time && <span className="text-xs text-muted-foreground">{time}</span>}
      </span>
      <span className="flex shrink-0 flex-col items-end justify-between gap-1 py-2.5 pr-3">
        <StatusMark status={item.status} className="mt-1" />
        <Stars rating={review?.rating} />
        {price && (
          <span className="mt-auto max-w-28 truncate text-sm font-medium tabular-nums">
            {price}
          </span>
        )}
      </span>
    </button>
  );
}

function FilmCard({
  item,
  tz,
  onOpen,
}: {
  item: Extract<ItemDto, { kind: 'film' }>;
  tz: string;
  onOpen: (id: string) => void;
}) {
  const { i18n } = useTranslation();
  const [failed, setFailed] = useState(false);
  const translated = useTranslatedText(item.title);
  return (
    <button
      type="button"
      onClick={() => onOpen(item.id)}
      className={cn(ROW, 'group flex flex-col gap-1.5 rounded-lg')}
    >
      <span className="relative block aspect-[2/3] w-full overflow-hidden rounded-lg bg-muted">
        {item.coverUrl && !failed ? (
          <img
            src={coverSrc(item.coverUrl) ?? undefined}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
            className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transition-none"
          />
        ) : (
          <span className="flex size-full items-center justify-center text-muted-foreground">
            <Clapperboard className="size-6" aria-hidden />
          </span>
        )}
        <StatusMark
          status={item.status}
          className="absolute top-1.5 right-1.5 ring-2 ring-background"
        />
      </span>
      <span className="line-clamp-2 text-xs leading-snug font-medium">
        {translated ?? item.title}
      </span>
      {translated && (
        <span
          lang={detectSource(item.title) ?? undefined}
          className="-mt-1 truncate text-[11px] text-muted-foreground/80"
        >
          {item.title}
        </span>
      )}
      {item.when && (
        <span className="-mt-1 text-[11px] text-muted-foreground">
          {zoned(item.when.start, tz, i18n.language, { day: 'numeric', month: 'short' })}
        </span>
      )}
    </button>
  );
}

function PlaceRow({
  item,
  review,
  onOpen,
}: {
  item: Extract<ItemDto, { kind: 'place' }>;
  review: ReviewDto | undefined;
  onOpen: (id: string) => void;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      onClick={() => onOpen(item.id)}
      className={cn(ROW, 'flex items-center gap-3 px-3 py-2.5 hover:bg-accent/40')}
    >
      {item.coverUrl && !failed && (
        <img
          src={coverSrc(item.coverUrl) ?? undefined}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="size-10 shrink-0 rounded-md bg-muted object-cover"
        />
      )}
      <span className="min-w-0 flex-1">
        <Title title={item.title} />
        {item.location.address && (
          <span className="block truncate text-xs text-muted-foreground">
            {item.location.address}
          </span>
        )}
      </span>
      <Stars rating={review?.rating} />
      <StatusMark status={item.status} />
    </button>
  );
}
