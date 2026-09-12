import { QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'framer-motion';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { Toaster } from './components/ui/sonner';
import { TooltipProvider } from './components/ui/tooltip';
import { initDb } from './db/storage';
import { initSync, onReconnected, onRejected, onSyncApplied } from './db/sync';
import { initAppLock } from './lib/appLock';
import { initAuthToken } from './lib/authToken';
import { initBackgroundSync } from './lib/backgroundSync';
import { initGlobalHaptics } from './lib/haptics';
import { initLiveUpdate } from './lib/liveUpdate';
import { isNative } from './lib/native';
import { notifyError, notifySuccess } from './lib/notify';
import { queryClient } from './lib/queryClient';
import { initReducedMotion, useReducedMotion } from './lib/reducedMotion';
import { initTelemetry } from './lib/telemetry';
import { logVersion } from './lib/version';
import i18n, { ensureLanguage } from './i18n';
import './index.css';

// First, so that anything failing below is reported.
initTelemetry();

// Every page, not just the landing page: the version is the first thing you want in the console
// when a page misbehaves, and a deep link into any route is just as likely as one into /map.
void logVersion();

// The Capacitor app ships its assets in the APK and updates them via Capgo (lib/liveUpdate.ts);
// a service worker would only fight that. On the web the worker *is* the update mechanism.
if (!isNative) {
  registerSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      // autoUpdate only re-checks on page load, so an installed PWA left open for days would
      // never notice a deploy. Re-check periodically, on reconnect, and whenever the tab is
      // brought back to the foreground. update() is a no-op offline.
      // (For this to find anything, sw.js must not be cached — see setCacheHeaders in server/app.ts.)
      if (!registration) return;
      const check = () => void registration.update().catch(() => {});
      setInterval(check, 60 * 60 * 1000);
      window.addEventListener('online', check);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    },
  });
}

/* Before initSync(), which is what used to open the database implicitly. Not awaited: the open is
   *initiated* here and every later query queues behind Dexie's own open promise, so ordering is
   all this needs. Awaiting would put a storage estimate in front of first paint. */
void initDb();
initSync();
initGlobalHaptics();
// Before the first render, so nothing gets one frame of the animation the user asked not to see.
initReducedMotion();
// Starts the background-grace clock. The initial locked state is read synchronously when the
// module loads, so a cold start is already locked before anything renders.
initAppLock();
// Server changes just landed in the local store: refresh everything on screen.
onSyncApplied(() => queryClient.invalidateQueries());
onReconnected(() => notifySuccess(i18n.t('sync.reconnected')));
/* The server refused a write outright and the queue moved on without it (db.deadLetter). The
   local copy still shows the change as saved, so this toast is the only moment a person is ever
   told — an error, never suppressed, rather than a console.warn nobody reads. */
onRejected((count) => notifyError(i18n.t('sync.rejected', { count })));

/**
 * Framer Motion animates in JavaScript, so the reduced-motion rules in index.css can't reach it.
 * "user" is Framer reading the media query itself; "always" is the same behaviour asked for on
 * behalf of a platform whose answer the media query never carried.
 */
function Motion({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion={useReducedMotion() ? 'always' : 'user'}>{children}</MotionConfig>
  );
}

async function bootstrap() {
  // The bearer token must be in memory before anything talks to the API.
  await initAuthToken();
  /* Only the detected language's strings are bundled separately (see i18n/index.ts), so they
     have to arrive before the first render or the UI would paint raw keys. Both awaits are
     guarded because this one call could otherwise take the whole app down: English is worth
     trying second because `fallbackLng` is 'en' and checkI18n guarantees it defines every key. */
  try {
    await ensureLanguage(i18n.language);
  } catch {
    await ensureLanguage('en').catch(() => {});
  }
  // Registered before the first render, and only after the token is loaded: Android can launch the
  // app directly into a background-fetch event, so the handler has to exist — and be able to
  // authenticate — by the time anything else runs.
  void initBackgroundSync();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <Motion>
            <TooltipProvider delayDuration={300}>
              <App />
              <Toaster position="top-center" />
            </TooltipProvider>
          </Motion>
        </QueryClientProvider>
      </ErrorBoundary>
    </StrictMode>,
  );
  // Boot splash (index.html) finishes its morph and fades out.
  (window as unknown as { __bootSplashHide?: () => void }).__bootSplashHide?.();

  // Deliberately last: initLiveUpdate() calls Capgo's notifyAppReady(), which marks the running
  // bundle as healthy. Reaching this line means the app actually rendered — so a live-updated
  // bundle that crashes on boot never reports itself as good, and Capgo rolls it back.
  void initLiveUpdate();
}

void bootstrap();
