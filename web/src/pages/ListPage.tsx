import type { ItemDto, ItemKind, ItemStatus } from '@rove/shared';
import { sourceById } from '@rove/shared';
import { AlertTriangle, CalendarDays, ListChecks, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useItems } from '@/api/hooks';
import { EmptyState } from '@/components/common/EmptyState';
import { ItemSheet } from '@/components/items/ItemSheet';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ItemSort } from '@/db/repo';
import { useSession } from '@/lib/authClient';
import { recordAction, useShown } from '@/lib/impressions';
import { useRegion } from '@/lib/region';
import { useSourceStatus } from '@/lib/sources';
import { formatWhen, type WhenRange } from '@/lib/when';
import { cn } from '@/lib/utils';

/* Everything saved, and everything the feeds suggested, in one list. "Suggested" is the inbox:
   candidates the pollers found that nobody has kept or dismissed yet. Below the status tabs, one
   row of toggles narrows by kind and by time, and the feeds' own tags (摇滚, 展览, 音乐…) become
   a second row once there are any. */

type Filter = 'all' | 'candidate' | 'saved' | 'visited';

const FILTERS: Filter[] = ['all', 'candidate', 'saved', 'visited'];
const STATUSES: Record<Filter, ItemStatus[]> = {
  all: ['saved', 'visited', 'candidate'],
  candidate: ['candidate'],
  saved: ['saved'],
  visited: ['visited'],
};
const KINDS: ItemKind[] = ['place', 'event', 'film'];
const RANGES: WhenRange[] = ['today', 'weekend', 'week'];
const SORTS: ItemSort[] = ['newest', 'soonest', 'title'];
/** Enough tags to be useful on a phone without becoming a second page. */
const MAX_CATEGORY_CHIPS = 12;

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant={active ? 'secondary' : 'outline'}
      size="sm"
      aria-pressed={active}
      className={cn(
        'h-8 shrink-0 gap-1.5 rounded-full',
        active && 'ring-[1.5px] ring-inset ring-ring',
      )}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

export default function ListPage() {
  const { t, i18n } = useTranslation();
  const region = useRegion();
  const { data: session } = useSession();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [kind, setKind] = useState<ItemKind | null>(null);
  const [range, setRange] = useState<WhenRange | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<ItemSort>('newest');
  const [selected, setSelected] = useState<string | null>(null);
  // Re-evaluated when the page mounts; a weekend does not change under a screen someone is reading.
  const now = useMemo(() => new Date(), []);
  const { data: items = [] } = useItems({
    query,
    status: STATUSES[filter],
    kind: kind ? [kind] : undefined,
    when: range ? { range, now, tz: region.tz } : undefined,
    category: category ?? undefined,
    sort,
  });
  /* The tag chips come from everything under the current status tab, not from the filtered list,
     so picking one does not make the others disappear. Most frequent first. */
  const { data: pool = [] } = useItems({ status: STATUSES[filter] });
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of pool)
      for (const c of item.categories) counts.set(c, (counts.get(c) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, MAX_CATEGORY_CHIPS)
      .map(([name]) => name);
  }, [pool]);
  const status = useSourceStatus(Boolean(session?.user));
  const down = (status.data ?? []).filter((s) => s.down);
  useShown(
    items.map((i) => i.id),
    'list',
  );

  const open = (id: string) => {
    recordAction(id, 'list', 'open');
    setSelected(id);
  };

  const narrowed = Boolean(kind || range || category);
  const filtered = Boolean(query) || filter !== 'all' || narrowed;
  const clear = () => {
    setKind(null);
    setRange(null);
    setCategory(null);
  };

  return (
    <PageContainer>
      <PageHeader title={t('nav.list')} />
      <div className="mb-4 flex flex-col gap-3">
        {/* Loud, and named: a feed that answered nothing twice running is not "no events this
            week", it is a source that has stopped working, and the difference is the whole point. */}
        {down.length > 0 && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              {t('list.sourcesDown', {
                sources: down.map((s) => sourceById(s.sourceId).name).join(', '),
              })}
            </span>
          </p>
        )}
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              className="pl-9"
              placeholder={t('list.searchPlaceholder')}
              aria-label={t('common.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Select value={sort} onValueChange={(value) => setSort(value as ItemSort)}>
            <SelectTrigger className="w-36 shrink-0" aria-label={t('list.sort')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORTS.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`list.sorts.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Tabs value={filter} onValueChange={(value) => setFilter(value as Filter)}>
          <TabsList className="w-full">
            {FILTERS.map((value) => (
              <TabsTrigger key={value} value={value} className="flex-1">
                {value === 'all' ? t('list.filterAll') : t(`items.status.${value}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {/* One scrolling row on a phone rather than three wrapped ones. */}
        <div
          role="group"
          aria-label={t('list.filters')}
          className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1"
        >
          {KINDS.map((value) => (
            <Chip
              key={value}
              active={kind === value}
              onClick={() => setKind((on) => (on === value ? null : value))}
            >
              {t(`list.kinds.${value}`)}
            </Chip>
          ))}
          <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border" />
          {RANGES.map((value) => (
            <Chip
              key={value}
              active={range === value}
              onClick={() => setRange((on) => (on === value ? null : value))}
            >
              {value === 'weekend' && <CalendarDays className="size-4" />}
              {t(`list.ranges.${value}`)}
            </Chip>
          ))}
          {narrowed && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 shrink-0 gap-1 text-muted-foreground"
              onClick={clear}
            >
              <X className="size-4" />
              {t('list.clearFilters')}
            </Button>
          )}
        </div>
        {categories.length > 0 && (
          <div
            role="group"
            aria-label={t('list.categories')}
            className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1"
          >
            {categories.map((name) => (
              <Chip
                key={name}
                active={category === name}
                onClick={() => setCategory((on) => (on === name ? null : name))}
              >
                {name}
              </Chip>
            ))}
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={range ? CalendarDays : ListChecks}
          title={
            range === 'weekend' && !kind && !category
              ? t('list.weekendEmpty')
              : filtered
                ? t('common.noResults')
                : t('list.emptyTitle')
          }
          description={filtered ? undefined : t('list.emptyDescription')}
        />
      ) : (
        <ul aria-label={t('nav.list')} className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => open(item.id)}
                className="flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-accent/50"
              >
                <Cover item={item} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{item.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {subtitle(item, i18n.language)}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <Badge variant={item.status === 'visited' ? 'default' : 'outline'}>
                    {t(`items.status.${item.status}`)}
                  </Badge>
                  {item.price ? (
                    <span className="max-w-24 truncate text-[11px] text-muted-foreground">
                      {item.price}
                    </span>
                  ) : (
                    item.kind !== 'place' && (
                      <span className="text-[10px] text-muted-foreground">
                        {t(`items.kind.${item.kind}`)}
                      </span>
                    )
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <ItemSheet itemId={selected} onClose={() => setSelected(null)} />
    </PageContainer>
  );
}

/* A poster thumbnail when the source gave one. `no-referrer` because Douban's image CDN refuses
   hotlinks that carry a foreign Referer; a broken image hides itself rather than showing an icon. */
function Cover({ item }: { item: ItemDto }) {
  const [failed, setFailed] = useState(false);
  if (!item.coverUrl || failed) return null;
  return (
    <img
      src={item.coverUrl}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="size-12 shrink-0 rounded-md bg-muted object-cover"
    />
  );
}

/** The one line under a title: address for a place, time and venue for an event, release for a film. */
function subtitle(item: ItemDto, lng: string): string {
  if (item.kind === 'place') return item.location.address ?? '';
  const when = item.when ? formatWhen(item.when, lng) : null;
  if (item.kind === 'film') return when ?? '';
  return [when, item.venue ?? item.location?.address ?? null].filter(Boolean).join(' · ');
}
