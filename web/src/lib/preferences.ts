import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveWeekStart, type WeekStart } from './dates';

/**
 * Device-local UI preferences — the "General" block of the Settings page.
 *
 * Deliberately *not* part of the synced SettingsDto: nothing here changes what the server
 * computes, so paying for a Mongoose field, a Zod field and a sync payload would buy nothing.
 * It also means these keep working in local-only mode, exactly like the theme and the language
 * (which predate this store and still own their own localStorage keys).
 *
 * Adding a preference is one line in the interface plus one in DEFAULT_PREFERENCES; unknown keys
 * found in storage are dropped and missing ones fall back, so an older build reading a newer
 * blob (or the reverse) degrades to the default instead of throwing.
 */
export interface Preferences {
  /** Which day the month grids start on. 'auto' follows the active language's own convention. */
  weekStartsOn: WeekStart | 'auto';
  /** Whether times read as 09:00 or 9 AM. 'auto' follows the active language, like weekStartsOn. */
  hourCycle: '12' | '24' | 'auto';
  /** The light tick on every button press. Native only; a no-op on the web either way. */
  haptics: boolean;
  /** Advanced: hold back sync until the device is on wi-fi. Off by default — the store is text,
      so a month of syncing costs less than one photo, and the failure mode of this being on by
      mistake is an app that silently stops backing itself up. */
  syncOnWifiOnly: boolean;
  /** Keep the "waiting for wi-fi" pill off screen even when writes are queued.
      Only ever hides *that* pill: going offline and the server being unreachable are failures
      rather than a setting doing its job, and they keep announcing themselves regardless. */
  hidePausedSyncStatus: boolean;
  /** Send crash reports and usage metrics. Whether there is anywhere to send them is decided at
      build time; this is whether to. Device-local like everything else here, and deliberately
      outside the synced settings so opting out on a phone can't be undone by a laptop. */
  telemetry: boolean;
  /** Whether a first-run tour has been shown on this device. Here rather than in the synced
      settings because signing out runs clearLocalData(), so a synced flag would reset and greet
      a long-time user as a new one. Set on reaching AppLayout as well. */
  onboardingSeen: boolean;
  /** Translate item titles into the UI language on the device (lib/translate.ts). Off by
      default: turning it on downloads a translation model, which should be a choice. */
  autoTranslate: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  weekStartsOn: 'auto',
  hourCycle: 'auto',
  haptics: true,
  syncOnWifiOnly: false,
  // Off: the pill is the only thing that says writes are piling up on purpose, so hiding it has
  // to be asked for.
  hidePausedSyncStatus: false,
  // On by default: this is the only way a crash on someone else's device is ever seen, and the
  // switch is one tap away for anyone who would rather it weren't.
  telemetry: true,
  // False: a device that has never stored a preference blob has, by definition, never run the app.
  onboardingSeen: false,
  autoTranslate: false,
};

const STORAGE_KEY = 'preferences';

function load(): Preferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    return { ...DEFAULT_PREFERENCES, ...(JSON.parse(raw) as Partial<Preferences>) };
  } catch {
    // Corrupt or unavailable storage is not worth crashing the app over.
    return DEFAULT_PREFERENCES;
  }
}

/* useSyncExternalStore compares snapshots by identity, so this object is replaced only when
   something actually changes — returning a fresh load() per read would loop forever. */
let current: Preferences = load();
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getPreferences = (): Preferences => current;

export function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]) {
  if (current[key] === value) return;
  current = { ...current, [key]: value };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Private-mode storage failures shouldn't lose the in-memory change.
  }
  emit();
}

export function resetPreferences() {
  current = { ...DEFAULT_PREFERENCES };
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* see above */
  }
  emit();
}

/* Another tab changing a preference should be reflected here too. `storage` only fires in *other*
   documents, so this can't feed back into the write above. Guarded because this is the one
   statement in the module that assumes a browser: the node-environment `logic` tests import it. */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    current = load();
    emit();
  });
}

/** Subscribe from outside React — the sync engine re-evaluates wi-fi-only on every change. */
export const subscribePreferences = (listener: () => void) => subscribe(listener);

export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribe, getPreferences, getPreferences);
}

/** True when the active language (or the user's override) writes times as 9 AM rather than 09:00. */
export function resolveHour12(hourCycle: Preferences['hourCycle'], lng: string): boolean {
  if (hourCycle !== 'auto') return hourCycle === '12';
  // Intl is the authority on what a locale actually does; en-US is 12h, es/it/ja/zh are 24h.
  return new Intl.DateTimeFormat(lng, { hour: 'numeric' }).resolvedOptions().hour12 ?? false;
}

/** Whether to render times as 12- or 24-hour, with 'auto' already resolved against the language. */
export function useHour12(): boolean {
  const { i18n } = useTranslation();
  const { hourCycle } = usePreferences();
  return resolveHour12(hourCycle, i18n.language);
}

/** The first column of every month grid, with 'auto' already resolved against the language. */
export function useWeekStart(): WeekStart {
  const { i18n } = useTranslation();
  const { weekStartsOn } = usePreferences();
  return resolveWeekStart(weekStartsOn, i18n.language);
}
