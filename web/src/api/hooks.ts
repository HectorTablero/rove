import type {
  ItemCreateInput,
  ItemUpdateInput,
  ReviewUpdateInput,
  SettingsInput,
} from '@rove/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as mutations from '@/db/mutations';
import * as repo from '@/db/repo';
import { hapticWarning } from '@/lib/haptics';

/* All reads and writes go through the local Dexie store (see src/db); the sync engine reconciles
   with the server in the background. main.tsx invalidates every query after a pull lands. */

// --- Items ---

export const useItems = (filter: repo.ItemFilter = {}) =>
  useQuery({
    queryKey: ['items', filter],
    queryFn: () => repo.getItems(filter),
  });

export const useItem = (id: string) =>
  useQuery({
    queryKey: ['items', 'one', id],
    queryFn: () => repo.getItem(id),
  });

export function useCreateItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ItemCreateInput) => mutations.createItem(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['items'] }),
  });
}

export function useUpdateItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ItemUpdateInput }) =>
      mutations.updateItem(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['items'] }),
  });
}

export function useDeleteItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => mutations.deleteItem(id),
    onSuccess: () => {
      hapticWarning();
      qc.invalidateQueries();
    },
  });
}

// --- Reviews ---

/** Every review on the device, for surfaces that show many items at once (the map's tooltips). */
export const useReviews = () =>
  useQuery({
    queryKey: ['reviews'],
    queryFn: () => repo.getReviews(),
  });

export const useReview = (itemId: string) =>
  useQuery({
    queryKey: ['reviews', itemId],
    queryFn: () => repo.getReview(itemId),
  });

export function useUpsertReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, input }: { itemId: string; input: ReviewUpdateInput }) =>
      mutations.upsertReview(itemId, input),
    // The whole prefix: the one review, and the all-reviews query the map reads.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reviews'] }),
  });
}

// --- Settings ---

export const useSettings = () =>
  useQuery({
    queryKey: ['settings'],
    queryFn: () => repo.getSettings(),
  });

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SettingsInput) => mutations.saveSettings(input),
    onSuccess: (saved) => qc.setQueryData(['settings'], saved),
  });
}
