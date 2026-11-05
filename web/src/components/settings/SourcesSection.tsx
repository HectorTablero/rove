import type { SettingsDto } from '@rove/shared';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Spinner } from '@/components/common/Spinner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/apiClient';
import { notifyError, notifySuccess } from '@/lib/notify';
import { useHour12 } from '@/lib/preferences';
import { useRegion } from '@/lib/region';
import { hourOptions } from '@/lib/when';
import { pollableSources, pollNow, useSourceStatus } from '@/lib/sources';
import { Section, ToggleRow } from './Section';

/* Two poll errors carry a value after the code (`poll.missing_param:showstart.cityCode`,
   `poll.rsshub_http_503`), so they cannot be looked up as-is. */
function pollErrorText(t: TFunction, code: string | null | undefined): string {
  if (code?.startsWith('poll.missing_param:'))
    return t('errors.codes.poll.missing_param', {
      param: code.slice('poll.missing_param:'.length),
    });
  const http = code?.match(/^poll\.rsshub_http_(\d+)$/);
  if (http) return t('errors.codes.poll.rsshub_http', { status: http[1] });
  return t(`errors.codes.${code}`, { defaultValue: code ?? t('errors.unknown') });
}

/* Which feeds the server reads for this account, what each did last, and a button to read them
   now. The tier is shown beside every source so what a feed costs — an API, a scraped page, an
   account at risk — is never hidden behind a switch. */
export function SourcesSection({
  draft,
  disabled,
  onChange,
}: {
  draft: SettingsDto | null;
  disabled: boolean;
  onChange: (pollSources: string[]) => void;
}) {
  const { t, i18n } = useTranslation();
  const hour12 = useHour12();
  const region = useRegion();
  const qc = useQueryClient();
  const status = useSourceStatus(!disabled);
  const [polling, setPolling] = useState(false);
  const sources = pollableSources(region);
  const enabled = new Set(draft?.pollSources ?? []);

  const toggle = (id: string, on: boolean) => {
    const next = new Set(enabled);
    if (on) next.add(id);
    else next.delete(id);
    onChange(sources.filter((s) => next.has(s.id)).map((s) => s.id));
  };

  const runNow = async () => {
    setPolling(true);
    try {
      const runs = await pollNow();
      const created = runs.reduce((sum, run) => sum + run.created, 0);
      const failed = runs.filter((run) => !run.ok);
      notifySuccess(t('settings.sources.polled', { count: created }), { important: true });
      for (const run of failed) {
        notifyError(pollErrorText(t, run.error));
      }
      await qc.invalidateQueries();
    } catch (err) {
      notifyError(
        err instanceof ApiError
          ? t(`errors.codes.${err.code}`, { defaultValue: t('errors.unknown') })
          : t('errors.unknown'),
      );
    } finally {
      setPolling(false);
    }
  };

  const lastRunText = (sourceId: string): string | null => {
    const entry = status.data?.find((s) => s.sourceId === sourceId);
    if (!entry?.lastRun) return enabled.has(sourceId) ? t('settings.sources.neverRun') : null;
    const when = new Intl.DateTimeFormat(i18n.language, {
      dateStyle: 'medium',
      timeStyle: 'short',
      ...hourOptions(hour12),
    }).format(new Date(entry.lastRun.at));
    if (!entry.lastRun.ok) {
      return t('settings.sources.lastFailed', {
        when,
        error: pollErrorText(t, entry.lastRun.error),
      });
    }
    return t('settings.sources.lastRun', {
      when,
      found: entry.lastRun.found,
      created: entry.lastRun.created,
    });
  };

  return (
    <Section title={t('settings.sources.title')} description={t('settings.sources.description')}>
      <div className="flex flex-col gap-4">
        {disabled && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {t('settings.sources.signInRequired')}
          </p>
        )}
        {sources.map((source) => {
          const entry = status.data?.find((s) => s.sourceId === source.id);
          const last = lastRunText(source.id);
          return (
            <ToggleRow
              key={source.id}
              id={`source-${source.id}`}
              label={source.name}
              description={t(`settings.sources.tier.${source.tier}`)}
              checked={enabled.has(source.id)}
              onCheckedChange={(checked) => toggle(source.id, checked)}
            >
              {(last || entry?.down) && (
                <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {entry?.down && <Badge variant="destructive">{t('settings.sources.down')}</Badge>}
                  {last}
                </p>
              )}
            </ToggleRow>
          );
        })}
        <Button
          variant="outline"
          size="sm"
          className="w-fit gap-1.5 h-8"
          disabled={disabled || polling || enabled.size === 0}
          onClick={() => void runNow()}
        >
          {polling ? <Spinner className="size-3.5" /> : <RefreshCw className="size-3.5" />}
          {t('settings.sources.pollNow')}
        </Button>
      </div>
    </Section>
  );
}
