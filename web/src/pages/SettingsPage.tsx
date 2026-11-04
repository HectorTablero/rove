import type { SettingsDto } from '@rove/shared';
import { Moon, Sun, SunMoon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSaveSettings, useSettings } from '@/api/hooks';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { SecuritySection } from '@/components/security/SecuritySection';
import { AccountSection } from '@/components/settings/AccountSection';
import { ApiKeyField } from '@/components/settings/ApiKeyField';
import { DataSection } from '@/components/settings/DataSection';
import { SourcesSection } from '@/components/settings/SourcesSection';
import { notifyDeviceSaved, Section, SubToggleRow, ToggleRow } from '@/components/settings/Section';
import { VersionFooter } from '@/components/settings/VersionFooter';
import { LanguageSetting } from '@/components/settings/deviceSettings';
import { TranslationSetting } from '@/components/settings/TranslationSetting';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { notifyError, notifySuccess } from '@/lib/notify';
import { isNative } from '@/lib/native';
import { useSession } from '@/lib/authClient';
import { setPreference, usePreferences } from '@/lib/preferences';
import { useGeocodeUsage } from '@/lib/ingest';
import { useRegion } from '@/lib/region';
import { applyTheme, getTheme, type Theme } from '@/lib/theme';
import { cn } from '@/lib/utils';

/** The synced half of the settings, as the PUT body. The key is deliberately absent: it is sent
    exactly once, by `saveApiKey`, never re-sent by the autosave. */
const toPayload = (draft: SettingsDto) => ({
  regionId: draft.regionId,
  quietNotifications: draft.quietNotifications,
  llmBaseUrl: draft.llmBaseUrl,
  llmModel: draft.llmModel,
  pollSources: draft.pollSources,
});

export default function SettingsPage() {
  const { t } = useTranslation();
  const { data: session } = useSession();
  const { data: settings, isLoading } = useSettings();
  const saveSettings = useSaveSettings();

  const prefs = usePreferences();
  const region = useRegion();
  const usage = useGeocodeUsage(region.id, Boolean(session?.user));
  const [theme, setTheme] = useState<Theme>(getTheme());
  const [draft, setDraft] = useState<SettingsDto | null>(null);
  /* Bumped by every control that considers its change settled. It exists because a handler
     can't save the value it just set — setDraft hasn't been applied yet — so the request rides
     the same render as the change and is picked up by the effect below. */
  const [commitSignal, setCommitSignal] = useState(0);
  /** Serialized payload last written; null until the first load has settled. */
  const lastSaved = useRef<string | null>(null);
  /* The synced settings live on the server: without an account there is nowhere to save them, and
     the LLM key in particular has no server to be write-only *to*. */
  const accountRequired = !session?.user;

  const requestCommit = () => setCommitSignal((signal) => signal + 1);

  useEffect(() => {
    if (settings && !draft) setDraft(settings);
  }, [settings, draft]);

  const changeTheme = (value: Theme) => {
    if (value === theme) return;
    setTheme(value);
    applyTheme(value);
    notifyDeviceSaved(t('settings.general.savedOnDevice'));
  };

  /** Writes the current draft if it differs from what was last written. Safe to call freely. */
  const commit = () => {
    if (!draft || accountRequired) return;
    const serialized = JSON.stringify(toPayload(draft));
    if (lastSaved.current === null || lastSaved.current === serialized) return;

    /* Recorded before the write, and rewound on failure so the next commit sends this payload
       again. mutateAsync rather than mutate's callbacks, because react-query drops those once the
       component unmounts — and the save on the way out of the page is precisely the one whose
       confirmation the user has no other way of seeing. */
    const previous = lastSaved.current;
    lastSaved.current = serialized;
    void saveSettings
      .mutateAsync(toPayload(draft))
      .then(() => notifySuccess(t('settings.settingsSaved'), { important: true }))
      .catch(() => {
        lastSaved.current = previous;
        notifyError(t('errors.unknown'));
      });
  };

  // Record the settings as loaded, so the first real edit has something to differ from.
  useEffect(() => {
    if (!draft || lastSaved.current !== null) return;
    lastSaved.current = JSON.stringify(toPayload(draft));
  }, [draft]);

  useEffect(() => {
    if (commitSignal > 0) commit();
    // Runs only when a commit is asked for.
  }, [commitSignal]);

  /* The last save. Leaving the page is the normal way to finish with it, and a field edited and
     then navigated away from never blurs — so unmount is a real save point. pagehide covers the
     tab going away and visibilitychange the app being backgrounded on Android. */
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  });
  useEffect(() => {
    const flush = () => commitRef.current();
    const flushIfHidden = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flushIfHidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flushIfHidden);
      flush();
    };
  }, []);

  /** Store or clear the LLM key. Its own write rather than a field on the draft: the draft is what
      the autosave resends, and a key must be sent exactly once, when the user chooses to. */
  const saveApiKey = (value: string) => {
    if (!draft) return;
    void saveSettings
      .mutateAsync({ ...toPayload(draft), llmApiKey: value })
      .then(() =>
        notifySuccess(value ? t('settings.ai.keySaved') : t('settings.ai.keyRemoved'), {
          important: true,
        }),
      )
      .catch(() => notifyError(t('errors.unknown')));
  };

  return (
    <PageContainer>
      <PageHeader title={t('settings.title')} />
      <div className="flex flex-col gap-4">
        <Section
          title={t('settings.general.title')}
          advanced={
            (draft || isNative) && (
              <>
                {draft && (
                  <ToggleRow
                    id="quiet-notifications"
                    label={t('settings.general.quietNotifications')}
                    description={t('settings.general.quietNotificationsDescription')}
                    checked={draft.quietNotifications}
                    onCheckedChange={(checked) => {
                      setDraft({ ...draft, quietNotifications: checked });
                      requestCommit();
                    }}
                  />
                )}
                {isNative && (
                  <>
                    <ToggleRow
                      id="haptics"
                      label={t('settings.general.haptics')}
                      description={t('settings.general.hapticsDescription')}
                      checked={prefs.haptics}
                      onCheckedChange={(checked) => {
                        setPreference('haptics', checked);
                        notifyDeviceSaved(t('settings.general.savedOnDevice'));
                      }}
                    />
                    <ToggleRow
                      id="sync-wifi-only"
                      label={t('settings.advanced.wifiOnly')}
                      description={t('settings.advanced.wifiOnlyDescription')}
                      checked={prefs.syncOnWifiOnly}
                      onCheckedChange={(checked) => {
                        setPreference('syncOnWifiOnly', checked);
                        notifyDeviceSaved(t('settings.general.savedOnDevice'));
                      }}
                    >
                      {prefs.syncOnWifiOnly && (
                        <SubToggleRow
                          id="sync-hide-paused"
                          label={t('settings.advanced.hidePausedStatus')}
                          description={t('settings.advanced.hidePausedStatusDescription')}
                          checked={prefs.hidePausedSyncStatus}
                          onCheckedChange={(checked) => {
                            setPreference('hidePausedSyncStatus', checked);
                            notifyDeviceSaved(t('settings.general.savedOnDevice'));
                          }}
                        />
                      )}
                    </ToggleRow>
                  </>
                )}
              </>
            )
          }
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-8">
            <div className="flex flex-col gap-1.5">
              <Label>{t('settings.general.theme')}</Label>
              <div className="flex gap-1">
                {(
                  [
                    ['light', Sun, t('settings.general.themeLight')],
                    ['dark', Moon, t('settings.general.themeDark')],
                    ['auto', SunMoon, t('settings.general.themeAuto')],
                  ] as const
                ).map(([value, Icon, label]) => (
                  <Button
                    key={value}
                    variant={theme === value ? 'secondary' : 'outline'}
                    size="sm"
                    className={cn(
                      'gap-1.5 h-8',
                      theme === value && 'ring-[1.5px] ring-inset ring-ring',
                    )}
                    onClick={() => changeTheme(value)}
                  >
                    <Icon className="size-4" />
                    {label}
                  </Button>
                ))}
              </div>
            </div>
            <LanguageSetting />
          </div>
          <TranslationSetting />
        </Section>

        <Section title={t('settings.region.title')} description={t('settings.region.description')}>
          <div className="flex flex-col gap-1.5 text-sm">
            <p>
              <span className="font-medium">{region.name}</span>
              <span className="text-muted-foreground">
                {' '}
                · {region.tz} · {region.datum}
              </span>
            </p>
            {/* The one number that decides whether the add screen keeps working this month. Shown
                plainly rather than hidden until it bites: the search pool is small and monthly. */}
            {session?.user ? (
              usage.data ? (
                <p className="text-xs text-muted-foreground">
                  {usage.data.configured
                    ? t('settings.region.searches', {
                        calls: usage.data.calls,
                        limit: usage.data.limit,
                        stopAt: usage.data.stopAt,
                      })
                    : t('settings.region.notConfigured')}
                </p>
              ) : usage.isError ? (
                <p className="text-xs text-muted-foreground">
                  {t('settings.region.usageUnavailable')}
                </p>
              ) : null
            ) : (
              <p className="text-xs text-muted-foreground">{t('settings.region.signInForUsage')}</p>
            )}
          </div>
        </Section>

        {/* `settings` is required here, not just `draft`: hasLlmKey is read from the query rather
            than the draft, so a key saved on this visit is reflected without a remount. */}
        <Section title={t('settings.ai.title')} description={t('settings.ai.description')}>
          {isLoading || !draft || !settings ? (
            <Skeleton className="h-32" />
          ) : (
            <div className="flex flex-col gap-4">
              {accountRequired && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {t('settings.ai.signInRequired')}
                </p>
              )}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="llm-base-url">{t('settings.ai.baseUrl')}</Label>
                <Input
                  id="llm-base-url"
                  inputMode="url"
                  autoComplete="off"
                  placeholder={t('settings.ai.baseUrlPlaceholder')}
                  disabled={accountRequired}
                  value={draft.llmBaseUrl}
                  onChange={(e) => setDraft({ ...draft, llmBaseUrl: e.target.value })}
                  onBlur={requestCommit}
                />
                <p className="text-xs text-muted-foreground">{t('settings.ai.baseUrlHint')}</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="llm-model">{t('settings.ai.model')}</Label>
                <Input
                  id="llm-model"
                  autoComplete="off"
                  placeholder={t('settings.ai.modelPlaceholder')}
                  disabled={accountRequired}
                  value={draft.llmModel}
                  onChange={(e) => setDraft({ ...draft, llmModel: e.target.value })}
                  onBlur={requestCommit}
                />
              </div>
              <ApiKeyField
                id="llm-api-key"
                label={t('settings.ai.apiKey')}
                placeholder={t('settings.ai.apiKeyPlaceholder')}
                hasKey={settings.hasLlmKey}
                disabled={accountRequired}
                onSave={saveApiKey}
                hint={t('settings.ai.apiKeyHint')}
              />
            </div>
          )}
        </Section>

        <SourcesSection
          draft={draft}
          disabled={accountRequired}
          onChange={(pollSources) => {
            if (!draft) return;
            setDraft({ ...draft, pollSources });
            requestCommit();
          }}
        />

        <AccountSection />

        <SecuritySection />

        <DataSection />
      </div>

      <VersionFooter />
    </PageContainer>
  );
}
