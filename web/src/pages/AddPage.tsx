import { Link2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { EmptyState } from '@/components/common/EmptyState';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { sharedUrlFromParams } from '@/lib/shareTarget';

/* Phase 0 placeholder for the intake screen. It already receives the share sheet: the manifest's
   `share_target` lands here with the shared text in the query string, and `sharedUrlFromParams`
   is what turns Android's habit of putting the URL in `text` into one URL. Phase 1 turns that URL
   into a snapshot, an extraction and a geocoded item. */
export default function AddPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const url = sharedUrlFromParams(params);

  return (
    <PageContainer>
      <PageHeader title={t('nav.add')} />
      <EmptyState
        icon={Link2}
        title={url ? t('add.receivedTitle') : t('add.emptyTitle')}
        description={url ?? t('add.emptyDescription')}
      />
    </PageContainer>
  );
}
