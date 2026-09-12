import { DEFAULT_REGION_ID, regionById, type RegionDescriptor } from '@rove/shared';
import { useSettings } from '@/api/hooks';

/** The active region: the account's setting, or the default until settings have loaded. */
export function useRegion(): RegionDescriptor {
  const { data: settings } = useSettings();
  return regionById(settings?.regionId ?? DEFAULT_REGION_ID);
}
