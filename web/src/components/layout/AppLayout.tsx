import { CloudOff, ListChecks, MapPinned, Plus, ServerOff, Settings, WifiOff } from 'lucide-react';
import { AnimatedLogo } from '@/components/icons/AnimatedLogo';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, NavLink, Outlet } from 'react-router';
import { useItems } from '@/api/hooks';
import { FullScreenSpinner } from '@/components/common/Spinner';
import { shouldShowBlocker } from '@/components/layout/syncPill';
import { forceSyncNow, kick, type SyncBlocker } from '@/db/sync';
import { useSyncStatus } from '@/db/useSyncStatus';
import { useSession } from '@/lib/authClient';
import { cancelIdle, onIdle } from '@/lib/idle';
import { isLocalOnly, setLocalOnly } from '@/lib/localOnly';
import { isNative } from '@/lib/native';
import { setPreference, usePreferences } from '@/lib/preferences';
import { cacheUser, getCachedUser } from '@/lib/sessionCache';
import { getUpdateState, subscribeToUpdateState, type UpdateState } from '@/lib/liveUpdate';
import { dismissUpdate, isDismissed } from '@/lib/updateCheck';
import { cn } from '@/lib/utils';
import { pageLoaders } from '@/pages/lazyPages';

interface NavItem {
  to: string;
  icon: LucideIcon;
  labelKey: string;
}

/* Four screens, and the same four on the sidebar and the phone bar: there is no seventh label to
   run out of room for. Add sits between the two views it feeds and Settings last. */
const NAV: NavItem[] = [
  { to: '/map', icon: MapPinned, labelKey: 'nav.map' },
  { to: '/list', icon: ListChecks, labelKey: 'nav.list' },
  { to: '/add', icon: Plus, labelKey: 'nav.add' },
  { to: '/settings', icon: Settings, labelKey: 'nav.settings' },
];

/** New suggestions waiting in the list, for the badge on its tab. Reactive: every pull invalidates. */
function useCandidateCount(): number {
  const { data } = useItems({ status: ['candidate'] });
  return data?.length ?? 0;
}

function CountBadge({ count }: { count: number }) {
  const { t } = useTranslation();
  if (count <= 0) return null;
  return (
    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
      <span className="sr-only">{t('list.candidateCount', { count })}</span>
      <span aria-hidden>{count > 99 ? '99+' : count}</span>
    </span>
  );
}

function SidebarLink({ item, badge = 0 }: { item: NavItem; badge?: number }) {
  const { t } = useTranslation();
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          isActive
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
        )
      }
    >
      <item.icon className="size-4.5 shrink-0" />
      <span className="flex-1 truncate">{t(item.labelKey)}</span>
      <CountBadge count={badge} />
    </NavLink>
  );
}

function Sidebar({ candidates }: { candidates: number }) {
  const { t } = useTranslation();
  return (
    <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r bg-sidebar px-3 py-5 md:flex">
      <NavLink to="/map" className="mb-6 flex items-center gap-2.5 px-3">
        <AnimatedLogo className="size-5" strokeColor="var(--foreground)" />
        <span className="text-base font-semibold tracking-tight">{t('app.name')}</span>
      </NavLink>
      <nav className="flex flex-1 flex-col gap-1">
        {NAV.filter((item) => item.to !== '/settings').map((item) => (
          <SidebarLink key={item.to} item={item} badge={item.to === '/list' ? candidates : 0} />
        ))}
        <div className="mt-auto flex flex-col gap-1">
          <SidebarLink item={NAV[NAV.length - 1]} />
        </div>
      </nav>
    </aside>
  );
}

const TAB_SLOT =
  'flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors relative';

function TabBar({ candidates }: { candidates: number }) {
  const { t } = useTranslation();
  return (
    <nav
      data-bottom-bar
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80',
        // The app always uses the tab bar, even in landscape widths.
        !isNative && 'md:hidden',
      )}
    >
      <div className="flex items-stretch justify-around pb-[var(--inset-bottom)]">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(TAB_SLOT, isActive ? 'text-primary' : 'text-muted-foreground')
            }
          >
            {({ isActive }) => (
              <>
                <span className="relative flex items-center justify-center rounded-full p-1 transition-colors">
                  <item.icon
                    className={cn('size-5 transition-transform', isActive && 'scale-110')}
                  />
                  {item.to === '/list' && candidates > 0 && (
                    <span className="absolute -top-0.5 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] leading-none font-bold text-primary-foreground">
                      <span className="sr-only">
                        {t('list.candidateCount', { count: candidates })}
                      </span>
                      <span aria-hidden>{candidates > 9 ? '9+' : candidates}</span>
                    </span>
                  )}
                </span>
                <span className="truncate">{t(item.labelKey)}</span>
                {isActive && (
                  <span className="absolute -top-0.5 left-1/2 h-0.5 w-5 -translate-x-1/2 rounded-full bg-primary" />
                )}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

/* Ordinary updates are silent: the web PWA swaps itself via the service worker, and the Android
   app live-updates its bundle in the background (lib/liveUpdate.ts). This banner exists for the
   one case neither can handle — a release whose native shell differs from the installed APK, so
   only downloading a new APK can deliver it. */
function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateState>(getUpdateState);
  const [dismissed, setDismissed] = useState(true);
  const { t } = useTranslation();

  useEffect(() => subscribeToUpdateState(setUpdate), []);

  const version = update.kind === 'native-required' ? update.version : null;

  useEffect(() => {
    if (!version) return;
    void isDismissed(version).then(setDismissed);
  }, [version]);

  if (update.kind !== 'native-required' || dismissed) return null;

  return (
    <div className="sticky top-0 z-50 flex items-center justify-center gap-4 border-b border-blue-500/30 bg-blue-500/10 px-4 py-2 text-sm text-blue-600 dark:text-blue-400">
      {t('update.needsInstall', { version: update.version })}
      <a
        href={update.releaseUrl}
        target="_blank"
        rel="noreferrer"
        className="font-medium underline underline-offset-2 min-w-max"
      >
        {t('update.view')}
      </a>
      <button
        type="button"
        className="text-muted-foreground underline-offset-2 hover:underline"
        onClick={() => {
          void dismissUpdate(update.version);
          setDismissed(true);
        }}
      >
        {t('update.dismiss')}
      </button>
    </div>
  );
}

/**
 * What each blocker looks like in the pill: its icon, and (below) its wording.
 *
 * `paused` is the reason this is a table rather than a boolean. It is not a failure — nothing is
 * broken, the app is holding writes back because it was told to — so calling it "Offline" would be
 * wrong in the other direction, and it is the only one of the three the user can act on from here.
 */
const BLOCKER_ICON: Record<NonNullable<SyncBlocker>, LucideIcon> = {
  offline: CloudOff,
  unreachable: ServerOff,
  paused: WifiOff,
};

/** Session-expired banner + a pill naming whatever is currently stopping sync. */
function SyncStatusOverlay() {
  const status = useSyncStatus();
  const { hidePausedSyncStatus } = usePreferences();
  const { t } = useTranslation();

  // Nothing to report for a device that was never linked to an account — there's no server
  // relationship to be "offline" from or "reconnected" to.
  if (isLocalOnly()) return null;

  if (status.needsAuth) {
    return (
      <div
        role="alert"
        className="sticky top-0 z-50 flex items-center justify-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-600 dark:text-amber-400"
      >
        {t('sync.sessionExpired')}
        <Link to="/login" className="font-medium underline underline-offset-2">
          {t('auth.signInWithGoogle')}
        </Link>
      </div>
    );
  }
  // The rule, and why it is what it is, lives in ./syncPill next to its tests.
  const showBlocker = shouldShowBlocker(status.blocker, status.pending, hidePausedSyncStatus);

  const Icon = showBlocker && status.blocker ? BLOCKER_ICON[status.blocker] : null;
  /* Written out per branch rather than assembled from a template key, so checkI18n can see that
     every one of these strings is used. `paused` has no zero-pending wording, because showBlocker
     never lets it reach the screen with nothing queued. */
  const label =
    !showBlocker || !status.blocker
      ? null
      : status.blocker === 'paused'
        ? t('sync.pausedPending', { count: status.pending })
        : status.blocker === 'unreachable'
          ? status.pending > 0
            ? t('sync.unreachablePending', { count: status.pending })
            : t('sync.unreachable')
          : status.pending > 0
            ? t('sync.offlinePending', { count: status.pending })
            : t('sync.offline');

  /* The wrapper is always mounted and the *pill* is what comes and goes, so that going offline is a
     text change inside an existing live region rather than a whole region appearing at once — the
     first is announced reliably, the second only sometimes. */
  return (
    <div
      role="status"
      className={cn(
        'pointer-events-none fixed left-1/2 z-50 max-w-[calc(100vw-2rem)] -translate-x-1/2 bottom-[calc(5.5rem+var(--inset-bottom))]',
        !isNative && 'md:bottom-4',
      )}
    >
      {Icon && (
        <span
          className={cn(
            'flex items-center gap-1.5 rounded-full border bg-background/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur',
            status.blocker === 'paused' && 'pointer-events-auto',
          )}
        >
          <Icon aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">{label}</span>
          {status.blocker === 'paused' && (
            <button
              type="button"
              disabled={status.syncing}
              onClick={() => void forceSyncNow()}
              className="-mr-1.5 shrink-0 rounded-full px-2 py-0.5 font-medium text-foreground underline-offset-2 hover:bg-accent hover:underline disabled:opacity-50"
            >
              {t('sync.syncAnyway')}
            </button>
          )}
        </span>
      )}
    </div>
  );
}

/** Invisible until focused, first in the tab order, so a keyboard user is not four stops from
    the content on every navigation. */
function SkipToContentLink() {
  const { t } = useTranslation();
  return (
    <a
      href="#main"
      onClick={(e) => {
        e.preventDefault();
        document.getElementById('main')?.focus();
      }}
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:border focus:bg-popover focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-popover-foreground focus:shadow-md focus:outline-none focus:ring-2 focus:ring-ring"
    >
      {t('common.skipToContent')}
    </a>
  );
}

export default function AppLayout() {
  const { data: session, isPending, error } = useSession();
  const cached = getCachedUser();
  const candidates = useCandidateCount();

  useEffect(() => {
    if (session?.user) {
      cacheUser({
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
      });
      // A real session now exists — whether this is a brand-new sign-in or an account just
      // linked from Settings, local-only mode is over. The kick() below drains anything queued
      // in the outbox while local-only, exactly like an ordinary reconnect-and-sync.
      setLocalOnly(false);
      kick('signin');
    }
    // Reaching this layout at all falsifies a first-run tour's premise, so record it here too.
    if (session?.user || isLocalOnly()) setPreference('onboardingSeen', true);
  }, [session]);

  // Warm the route chunk cache once the shell is up and idle, so navigating
  // between tabs doesn't pay a network round-trip. Skipped on metered
  // connections (Save-Data) since it's a pure UX nicety, not a requirement.
  useEffect(() => {
    if (!session?.user) return;
    const saveData = (navigator as { connection?: { saveData?: boolean } }).connection?.saveData;
    if (saveData) return;
    const handle = onIdle(() => {
      for (const load of Object.values(pageLoaders)) void load();
    });
    return () => cancelIdle(handle);
  }, [session]);

  if (!session?.user && !isLocalOnly()) {
    // With a cached user, stay usable while the session check is pending or the
    // network is down (local-first). A definitive "signed out" still redirects.
    const offlineUsable = !!cached && (isPending || !!error);
    if (!offlineUsable) {
      if (isPending) return <FullScreenSpinner />;
      return <Navigate to="/login" replace />;
    }
  }

  return (
    <div className="flex min-h-dvh">
      {!isNative && <SkipToContentLink />}
      {!isNative && <Sidebar candidates={candidates} />}
      <main
        id="main"
        tabIndex={-1}
        className={cn(
          'min-w-0 flex-1 pt-[var(--inset-top)] pb-[calc(5.5rem+var(--inset-bottom))]',
          !isNative && 'md:pb-0',
        )}
      >
        <UpdateBanner />
        <SyncStatusOverlay />
        <Outlet />
      </main>
      <TabBar candidates={candidates} />
    </div>
  );
}
