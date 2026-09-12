import type { ItemStatus } from '@rove/shared';
import { ListChecks, Search } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useItems } from '@/api/hooks';
import { EmptyState } from '@/components/common/EmptyState';
import { ItemSheet } from '@/components/items/ItemSheet';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { recordAction, useShown } from '@/lib/impressions';

type Filter = 'all' | ItemStatus;

const FILTERS: Filter[] = ['all', 'saved', 'visited', 'dismissed'];

export default function ListPage() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const { data: items = [] } = useItems({
    query,
    status: filter === 'all' ? ['saved', 'visited', 'candidate'] : [filter],
  });
  useShown(
    items.map((i) => i.id),
    'list',
  );

  const open = (id: string) => {
    recordAction(id, 'list', 'open');
    setSelected(id);
  };

  return (
    <PageContainer>
      <PageHeader title={t('nav.list')} />
      <div className="mb-4 flex flex-col gap-3">
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
        <Tabs value={filter} onValueChange={(value) => setFilter(value as Filter)}>
          <TabsList className="w-full">
            {FILTERS.map((value) => (
              <TabsTrigger key={value} value={value} className="flex-1">
                {value === 'all' ? t('list.filterAll') : t(`items.status.${value}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title={query || filter !== 'all' ? t('common.noResults') : t('list.emptyTitle')}
          description={query || filter !== 'all' ? undefined : t('list.emptyDescription')}
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
                  {item.kind !== 'film' && item.location?.address && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.location.address}
                    </span>
                  )}
                </span>
                <Badge
                  variant={item.status === 'visited' ? 'default' : 'outline'}
                  className="shrink-0"
                >
                  {t(`items.status.${item.status}`)}
                </Badge>
              </button>
            </li>
          ))}
        </ul>
      )}

      <ItemSheet itemId={selected} onClose={() => setSelected(null)} />
    </PageContainer>
  );
}
