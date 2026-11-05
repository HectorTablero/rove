import type { ImpressionSurface } from '@rove/shared';
import { navigationById } from '@rove/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDeleteItem, useItem, useReview, useUpdateItem, useUpsertReview } from '@/api/hooks';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { recordAction } from '@/lib/impressions';
import { notifyError, notifySuccess } from '@/lib/notify';
import { useRegion } from '@/lib/region';

/* What you can do to one item, shared by the sheet and the right-click menu so the two never
   disagree: keep or dismiss a suggestion, navigate, mark visited, unkeep, copy the name, delete.
   Unkeeping or deleting something you put a rating, notes or visits into asks first; `dialogs`
   renders those questions and must stay mounted after the button that raised them. */
export function useItemActions(itemId: string, surface: ImpressionSurface, onGone?: () => void) {
  const { t } = useTranslation();
  const region = useRegion();
  const { data: item } = useItem(itemId);
  const { data: review } = useReview(itemId);
  const updateItem = useUpdateItem();
  const upsertReview = useUpsertReview();
  const deleteItem = useDeleteItem();
  const [confirm, setConfirm] = useState<'delete' | 'unkeep' | null>(null);

  const location = item && item.kind !== 'film' ? item.location : null;
  const visited = item?.status === 'visited';
  /* Only what a feed suggested can go back to being a suggestion; a place you added yourself
     never was one. Feed items carry an expiry, hand-added ones do not. */
  const canUnkeep = item?.status === 'saved' && item.expiresAt !== null;
  const invested = Boolean(review?.rating || review?.notes.trim() || review?.visits.length);
  const ask = (action: 'delete' | 'unkeep', run: () => void) =>
    invested ? setConfirm(action) : run();

  const keep = () => {
    recordAction(itemId, surface, 'save');
    updateItem.mutate({ id: itemId, input: { status: 'saved' } });
    notifySuccess(t('items.kept'), { important: true });
  };

  /* Back to the suggestions it came from, expiry and all — a mistaken keep, or a plan that fell
     through, without the finality of deleting it. */
  const unkeepNow = () => {
    updateItem.mutate({ id: itemId, input: { status: 'candidate' } });
    notifySuccess(t('items.unkept'));
  };

  const dismiss = () => {
    recordAction(itemId, surface, 'dismiss');
    updateItem.mutate({ id: itemId, input: { status: 'dismissed' } });
    onGone?.();
  };

  const navigate = () => {
    if (!item || !location) return;
    recordAction(itemId, surface, 'navigate');
    const url = navigationById(region.navigation).routeUrl(location.point, item.title);
    window.open(url, '_blank', 'noopener');
  };

  const toggleVisited = () => {
    updateItem.mutate({ id: itemId, input: { status: visited ? 'saved' : 'visited' } });
    if (!visited) {
      const now = new Date().toISOString();
      upsertReview.mutate({ itemId, input: { visits: [...(review?.visits ?? []), now] } });
      notifySuccess(t('items.markedVisited'));
    }
  };

  const copyTitle = () => {
    if (!item) return;
    void navigator.clipboard
      .writeText(item.title)
      .then(() => notifySuccess(t('items.copied')))
      .catch(() => notifyError(t('errors.unknown')));
  };

  const removeNow = () => {
    recordAction(itemId, surface, 'dismiss');
    deleteItem.mutate(itemId, {
      onSuccess: () => {
        notifySuccess(t('items.deleted'), { important: true });
        onGone?.();
      },
    });
  };

  const dialogs = (
    <>
      <ConfirmDialog
        open={confirm === 'delete'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t('items.deleteTitle')}
        description={t('items.deleteDescription')}
        confirmLabel={t('common.delete')}
        onConfirm={removeNow}
      />
      <ConfirmDialog
        open={confirm === 'unkeep'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t('items.unkeepTitle')}
        description={t('items.unkeepDescription')}
        confirmLabel={t('items.unkeep')}
        destructive={false}
        onConfirm={unkeepNow}
      />
    </>
  );

  return {
    item,
    review,
    location,
    visited,
    canUnkeep,
    keep,
    unkeep: () => ask('unkeep', unkeepNow),
    dismiss,
    navigate,
    toggleVisited,
    copyTitle,
    remove: () => ask('delete', removeNow),
    dialogs,
  };
}
