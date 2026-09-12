import { MapPinned } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useItems } from '@/api/hooks';
import { EmptyState } from '@/components/common/EmptyState';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';

/* Phase 0 placeholder. Phase 1 mounts the region's MapRenderer here — see regions/ — and draws
   every saved item as a marker. The count below is what proves the store is wired end to end. */
export default function MapPage() {
  const { t } = useTranslation();
  const { data: items = [] } = useItems({ status: ['saved', 'visited'] });

  return (
    <PageContainer>
      <PageHeader title={t('nav.map')} />
      <EmptyState
        icon={MapPinned}
        title={t('map.emptyTitle')}
        description={t('map.emptyDescription', { count: items.length })}
      />
    </PageContainer>
  );
}
