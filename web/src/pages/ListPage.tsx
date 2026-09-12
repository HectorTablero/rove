import type { ItemDto, ItemStatus } from '@rove/shared';
import { sourceById } from '@rove/shared';
import { AlertTriangle, CalendarDays, ListChecks, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useItems } from '@/api/hooks';
import { EmptyState } from '@/components/common/EmptyState';
import { ItemSheet } from '@/components/items/ItemSheet';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSession } from '@/lib/authClient';
import { recordAction, useShown } from '@/lib/impressions';
import { useRegion } from '@/lib/region';
import { useSourceStatus } from '@/lib/sources';
import { formatWhen } from '@/lib/when';
import { cn } from '@/lib/utils';

/* Everything saved, and everything the feeds suggested, in one list. "Suggested" is the inbox:
   candidates the pollers found that nobody has kept or dismissed yet. "This weekend" cuts across
   the tabs to the events actually happening in the coming days. */

type Filter = 'all' | 'candidate' | 'saved' | 'visited';

const FILTERS: Filter[] = ['all', 'candidate', 'saved', 'visited'];
const STATUSES: Record<Filter, ItemStatus[]> = {
  all: ['saved', 'visited', 'candidate'],
  candidate: ['candidate'],
  saved: ['saved'],
  visited: ['visited'],
};

export default function ListPage() {
  const { t, i18n } = useTranslation();
  const region = useRegion();
  const { data: session } = useSession();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [weekend, setWeekend] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  // Re-evaluated when the page mounts; a weekend does not change under a screen someone is reading.
  const now = useMemo(() => new Date(), []);
  const { data: items = [] } = useItems({
    query,
    status: STATUSES[filter],
    weekend: weekend ? { now, tz: region.tz } : undefined,
  });
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

  const filtered = Boolean(query) || filter !== 'all' || weekend;

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
        <div className="relative">
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
        <div className="flex items-center gap-2">
          <Tabs
            value={filter}
            onValueChange={(value) => setFilter(value as Filter)}
            className="min-w-0 flex-1"
          >
            <TabsList className="w-full">
              {FILTERS.map((value) => (
                <TabsTrigger key={value} value={value} className="flex-1">
                  {value === 'all' ? t('list.filterAll') : t(`items.status.${value}`)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Button
            variant={weekend ? 'secondary' : 'outline'}
            size="sm"
            aria-pressed={weekend}
            className={cn('h-9 shrink-0 gap-1.5', weekend && 'ring-[1.5px] ring-inset ring-ring')}
            onClick={() => setWeekend((on) => !on)}
          >
            <CalendarDays className="size-4" />
            {t('list.weekend')}
          </Button>
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={weekend ? CalendarDays : ListChecks}
          title={
            weekend
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
                className="flex w-full items-start justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-accent/50"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{item.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {subtitle(item, i18n.language)}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <Badge variant={item.status === 'visited' ? 'default' : 'outline'}>
                    {t(`items.status.${item.status}`)}
                  </Badge>
                  {item.kind !== 'place' && (
                    <span className="text-[10px] text-muted-foreground">
                      {t(`items.kind.${item.kind}`)}
                    </span>
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

/** The one line under a title: address for a place, time and venue for an event, release for a film. */
function subtitle(item: ItemDto, lng: string): string {
  if (item.kind === 'place') return item.location.address ?? '';
  const when = item.when ? formatWhen(item.when, lng) : null;
  if (item.kind === 'film') return when ?? '';
  return [when, item.venue ?? item.location?.address ?? null].filter(Boolean).join(' · ');
}
