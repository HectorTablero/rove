import { Download, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Spinner } from '@/components/common/Spinner';
import { DeleteAccountDialog } from '@/components/settings/DeleteAccountDialog';
import { Button } from '@/components/ui/button';
import { useSyncStatus } from '@/db/useSyncStatus';
import { useSession } from '@/lib/authClient';
import { backupFileName, buildBackupEnvelope } from '@/lib/backup';
import { resumingAccountDeletion } from '@/lib/deleteAccountResume';
import { saveTextFile } from '@/lib/fileSave';
import { notifyError, notifySuccess } from '@/lib/notify';
import { setPreference, usePreferences } from '@/lib/preferences';
import { isTelemetryConfigured } from '@/lib/telemetry';
import { notifyDeviceSaved, Section, ToggleRow } from './Section';

/** Getting the data out of the app, and the one switch over what leaves it. Import arrives with
    the first real data to restore (Phase 1); until then a file can be exported and kept. */
export function DataSection() {
  const { t } = useTranslation();
  const prefs = usePreferences();
  const { data: session } = useSession();
  /* Deleting the account is the one action on this page that *only* works online — everything else
     here reads or writes the local store. `paused` is not included: wi-fi-only holds back the
     background sync on purpose, and it should not silently veto something the user just asked for. */
  const { blocker } = useSyncStatus();
  const serverUnreachable = blocker === 'offline' || blocker === 'unreachable';
  const [exportingBackup, setExportingBackup] = useState(false);
  /* Open on arrival when this page load is the far side of a deletion re-authentication — the web
     has to leave for Google to prove who it is, and Settings is where it comes back to (see
     lib/deleteAccountResume.ts). Native never redirects and always gets `false`. */
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(resumingAccountDeletion);

  const handleExportBackup = async () => {
    setExportingBackup(true);
    try {
      const envelope = await buildBackupEnvelope();
      await saveTextFile(
        backupFileName(envelope),
        JSON.stringify(envelope, null, 2),
        'application/json',
      );
      notifySuccess(t('settings.data.exportDone'), { important: true });
    } catch {
      notifyError(t('errors.unknown'));
    } finally {
      setExportingBackup(false);
    }
  };

  return (
    <>
      <Section title={t('settings.data.title')} description={t('settings.data.description')}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              size="sm"
              className="w-fit gap-1.5 h-8"
              disabled={exportingBackup}
              onClick={() => void handleExportBackup()}
            >
              {exportingBackup ? (
                <Spinner className="size-3.5" />
              ) : (
                <Download className="size-3.5" />
              )}
              {t('settings.data.export')}
            </Button>
            <p className="text-xs text-muted-foreground">{t('settings.data.exportOmits')}</p>
          </div>

          {/* Only where the build actually reports somewhere. Telemetry used to be a decision
              made once, by whoever produced the bundle, with no way for the person running it
              to change their mind — this is that switch. */}
          {isTelemetryConfigured() && (
            <div className="border-t pt-4">
              <ToggleRow
                id="telemetry"
                label={t('settings.data.telemetry')}
                description={t('settings.data.telemetryDescription')}
                checked={prefs.telemetry}
                onCheckedChange={(checked) => {
                  setPreference('telemetry', checked);
                  notifyDeviceSaved(t('settings.general.savedOnDevice'));
                }}
              />
            </div>
          )}

          {session?.user && (
            <div className="flex flex-col gap-1 border-t pt-4">
              <Button
                variant="outline"
                size="sm"
                className="w-fit gap-1.5 h-8 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={serverUnreachable}
                onClick={() => setDeleteDialogOpen(true)}
              >
                <Trash2 className="size-3.5" />
                {t('settings.data.deleteAccount.action')}
              </Button>
              <p className="text-xs text-muted-foreground">
                {serverUnreachable
                  ? t('settings.data.deleteAccount.needsConnection')
                  : t('settings.data.deleteAccount.actionDescription')}
              </p>
            </div>
          )}
        </div>
      </Section>

      {session?.user && (
        <DeleteAccountDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen} />
      )}
    </>
  );
}
