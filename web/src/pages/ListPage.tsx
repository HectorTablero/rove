import { ListChecks } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useItems } from '@/api/hooks';
import { EmptyState } from '@/components/common/EmptyState';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';

/* Phase 0 placeholder: a flat list of saved items, newest first. Search, status filters and the
   item sheet arrive in Phase 1. */
export default function ListPage() {
  const { t } = useTranslation();
  const { data: items = [] } = useItems();

  return (
    <PageContainer>
      <PageHeader title={t('nav.list')} />
      {items.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title={t('list.emptyTitle')}
          description={t('list.emptyDescription')}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-lg border px-3 py-2">
              <p className="font-medium">{item.title}</p>
              <p className="text-xs text-muted-foreground">
                {t(`items.kind.${item.kind}`)} · {t(`items.status.${item.status}`)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}
