import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { notifyError } from '@/lib/notify';
import { setPreference, usePreferences } from '@/lib/preferences';
import { useRegion } from '@/lib/region';
import { baseLanguage, engine, type Availability } from '@/lib/translate';
import { notifyDeviceSaved, ToggleRow } from './Section';

/* "Translate titles", per device. Only rendered where it can work: the device's engine must offer
   the region's language → the UI language (Chrome's Translator on desktop, ML Kit in the app), and
   the two must differ — a Chinese UI over Shenzhen's feeds has nothing to translate. Turning it on
   is the user gesture the browser requires before it downloads a model. */
export function TranslationSetting() {
  const { t, i18n } = useTranslation();
  const region = useRegion();
  const { autoTranslate } = usePreferences();
  const source = baseLanguage(region.locale);
  const target = baseLanguage(i18n.language);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [preparing, setPreparing] = useState(false);

  useEffect(() => {
    if (source === target) return;
    let cancelled = false;
    void engine.availability(source, target).then((state) => {
      if (!cancelled) setAvailability(state);
    });
    return () => {
      cancelled = true;
    };
  }, [source, target]);

  if (source === target || availability === null || availability === 'unavailable') return null;

  const toggle = async (checked: boolean) => {
    if (!checked) {
      setPreference('autoTranslate', false);
      notifyDeviceSaved(t('settings.general.savedOnDevice'));
      return;
    }
    setPreparing(true);
    try {
      await engine.prepare(source, target);
      setAvailability('available');
      setPreference('autoTranslate', true);
      notifyDeviceSaved(t('settings.general.savedOnDevice'));
    } catch {
      notifyError(t('settings.general.translateFailed'));
    } finally {
      setPreparing(false);
    }
  };

  return (
    <ToggleRow
      id="auto-translate"
      label={t('settings.general.translate')}
      description={
        preparing
          ? t('settings.general.translateDownloading')
          : availability === 'downloadable' && !autoTranslate
            ? t('settings.general.translateDescriptionDownload')
            : t('settings.general.translateDescription')
      }
      checked={autoTranslate}
      disabled={preparing}
      onCheckedChange={(checked) => void toggle(checked)}
    />
  );
}
