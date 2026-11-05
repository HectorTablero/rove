import type { ItemDto, ItemKind, ReviewDto, WhenDto } from '@rove/shared';
import { Check, Clapperboard, Star } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { coverSrc } from '@/lib/cover';
import { formatPrice } from '@/lib/price';
import { useRegion } from '@/lib/region';
import { detectSource, useTranslatedText } from '@/lib/translate';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { endsWithin, formatWhen, isMultiDay, otherYear, type Window } from '@/lib/when';

/* The list, one shape per kind rather than one card for everything.
 *
 * Events are tickets: a date stub, torn off by a dashed edge, then what and where and what it
 * costs. Films are a shelf of posters — the one thing every film feed reliably has. Places are a
 * quiet index: name, address, your stars. Status is a mark, not a badge. Suggestions are most of
 * the list, so they carry nothing; what you kept gets a bookmark ribbon hanging off the card's top
 * edge, and somewhere you have been a check. */

const GROUP_ORDER: ItemKind[] = ['event', 'film', 'place'];

export interface ListRowsProps {
  items: ItemDto[];
  reviews: Map<string, ReviewDto>;
  /** Group by kind under headings; off when the list is already filtered to one kind. */
  grouped: boolean;
  tz: string;
  /** The date filter's window, when one is on: events still running after it go below the rest. */
  window?: Window;
  onOpen: (id: string) => void;
}

export function ListRows({ items, reviews, grouped, tz, window, onOpen }: ListRowsProps) {
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
              <EventList rows={rows} reviews={reviews} tz={tz} window={window} onOpen={onOpen} />
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
  const translated = useTranslatedText(title, 'title');
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

/** A ribbon tucked into the card's top edge, as into a ticket. The card must be `relative`. */
function SavedRibbon({ status, className }: { status: ItemDto['status']; className?: string }) {
  const { t } = useTranslation();
  if (status !== 'saved') return null;
  return (
    <span
      className={cn(
        'pointer-events-none absolute top-0 h-5 w-3.5 bg-primary shadow-sm [clip-path:polygon(0_0,100%_0,100%_100%,50%_72%,0_100%)]',
        className,
      )}
    >
      <span className="sr-only">{t('items.status.saved')}</span>
    </span>
  );
}

/** A check for somewhere you have been. */
function StatusMark({ status, className }: { status: ItemDto['status']; className?: string }) {
  const { t } = useTranslation();
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

/* Inside a date filter, what happens in the window first; then, under a quieter heading, the
   long runs that are merely open during it (an exhibition through December). A range over by the
   window's end — begun before it or not — is in the first group: it is this window's to see. */
function EventList({
  rows,
  reviews,
  tz,
  window,
  onOpen,
}: {
  rows: ItemDto[];
  reviews: Map<string, ReviewDto>;
  tz: string;
  window: Window | undefined;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const events = rows.filter(
    (item): item is Extract<ItemDto, { kind: 'event' }> => item.kind === 'event',
  );
  const inside = window ? events.filter((e) => !e.when || endsWithin(e.when, window)) : events;
  const through = window ? events.filter((e) => e.when && !endsWithin(e.when, window)) : [];
  const list = (part: typeof events) => (
    <ul className="flex flex-col gap-2">
      {part.map((item) => (
        <li key={item.id}>
          <EventRow item={item} review={reviews.get(item.id)} tz={tz} onOpen={onOpen} />
        </li>
      ))}
    </ul>
  );
  return (
    <>
      {inside.length > 0 && list(inside)}
      {through.length > 0 && (
        <section aria-labelledby="list-running-through" className={cn(inside.length > 0 && 'mt-5')}>
          <h3
            id="list-running-through"
            className="mb-2 flex items-baseline gap-2 text-xs font-medium text-muted-foreground"
          >
            {t('list.runningThrough')}
            <span className="tabular-nums opacity-80">{through.length}</span>
          </h3>
          {list(through)}
        </section>
      )}
    </>
  );
}

const ROW =
  'w-full text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring';

const zoned = (iso: string, tz: string, lng: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(lng, { timeZone: tz, ...opts }).format(new Date(iso));

/** The stub's third line: the year, only when it is not this one. */
function StubYear({ iso, tz }: { iso: string; tz: string }) {
  if (!otherYear(iso, tz)) return null;
  return (
    <span className="mt-1 text-[10px] leading-none tabular-nums opacity-80">
      {zoned(iso, tz, 'en', { year: 'numeric' })}
    </span>
  );
}

/** The stub: day large and month small, or a run's two ends, in the region's clock. A dashed
    edge tears it off the ticket. Hovering it gives the date in full, weekday and times included;
    screen readers get that instead of the stub's fragments. */
function DateStub({ when, tz }: { when: WhenDto | null; tz: string }) {
  const { t, i18n } = useTranslation();
  const now = new Date().toISOString();
  const short = (iso: string) => zoned(iso, tz, i18n.language, { month: 'short', day: 'numeric' });
  // A run reads as three equal lines: its start ("Now" once it has begun — a start date from June
  // would only mislead), a lone dash, its end.
  const run = when !== null && isMultiDay(when);
  const full = when ? formatWhen(when, i18n.language) : null;
  const stub = (
    <span
      className={cn(
        'flex w-14 shrink-0 flex-col items-center justify-center border-r border-dashed py-2',
        when ? 'text-primary' : 'text-muted-foreground',
      )}
    >
      {full && <span className="sr-only">{full}</span>}
      {when && run ? (
        <span
          aria-hidden
          className="flex flex-col items-center text-center text-[11px] leading-tight font-medium"
        >
          {when.start < now ? (
            <span>{t('list.now')}</span>
          ) : (
            <>
              <span>{short(when.start)}</span>
              <StubYear iso={when.start} tz={tz} />
            </>
          )}
          <span aria-hidden className="opacity-60">
            –
          </span>
          <span>{short(when.end!)}</span>
          <StubYear iso={when.end!} tz={tz} />
        </span>
      ) : when ? (
        <span aria-hidden className="contents">
          <span className="text-xl leading-none font-semibold tabular-nums">
            {zoned(when.start, tz, i18n.language, { day: 'numeric' })}
          </span>
          <span className="mt-1 text-[11px] leading-none">
            {zoned(when.start, tz, i18n.language, { month: 'short' })}
          </span>
          <StubYear iso={when.start} tz={tz} />
        </span>
      ) : (
        <span className="px-1 text-center text-[11px] leading-tight">{t('list.noDate')}</span>
      )}
    </span>
  );
  if (!full) return stub;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{stub}</TooltipTrigger>
      <TooltipContent side="right">{full}</TooltipContent>
    </Tooltip>
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
  /* The stub already says the day; this line is only for what it cannot, the time. All-day
     events and runs have none, and their full dates are on the stub's hover. */
  const time =
    item.when && !item.when.allDay && !isMultiDay(item.when)
      ? // "19:30 – 21:30" when the source gave an end, else just the start.
        new Intl.DateTimeFormat(i18n.language, {
          timeZone: tz,
          hour: '2-digit',
          minute: '2-digit',
        }).formatRange(new Date(item.when.start), new Date(item.when.end ?? item.when.start))
      : null;
  const where = item.venue ?? item.location?.address ?? null;
  const price = formatPrice(item.price, t, i18n.language, region.currency);
  return (
    <button
      type="button"
      data-item-id={item.id}
      onClick={() => onOpen(item.id)}
      className={cn(
        ROW,
        'relative flex items-stretch rounded-xl border bg-card hover:bg-accent/40',
      )}
    >
      <SavedRibbon status={item.status} className="right-3" />
      <DateStub when={item.when} tz={tz} />
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-3 py-2.5">
        <Title title={item.title} />
        {where && <span className="truncate text-xs text-muted-foreground">{where}</span>}
        {time && <span className="text-xs text-muted-foreground">{time}</span>}
      </span>
      <span
        className={cn(
          'flex shrink-0 flex-col items-end justify-between gap-1 py-2.5 pr-3',
          item.status === 'saved' && 'pt-6',
        )}
      >
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
  const translated = useTranslatedText(item.title, 'title');
  return (
    <button
      type="button"
      data-item-id={item.id}
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
        <SavedRibbon status={item.status} className="right-2" />
        <StatusMark
          status={item.status}
          className="absolute top-1.5 right-1.5 rounded-full bg-background/90 p-0.5"
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
          {zoned(item.when.start, tz, i18n.language, {
            day: 'numeric',
            month: 'short',
            ...(otherYear(item.when.start, tz) ? { year: 'numeric' } : {}),
          })}
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
      data-item-id={item.id}
      onClick={() => onOpen(item.id)}
      className={cn(
        ROW,
        'relative flex items-center gap-3 px-3 py-2.5 hover:bg-accent/40',
        item.status === 'saved' && 'pr-9',
      )}
    >
      <SavedRibbon status={item.status} className="right-3" />
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
