import { App as CapApp } from '@capacitor/app';
import { Suspense } from 'react';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import AppLayout from './components/layout/AppLayout';
import { FullScreenSpinner } from './components/common/Spinner';
import { LockScreen } from './components/security/LockScreen';
import { useLockState } from './lib/appLock';
import { routeForUrl } from './lib/deepLinks';
import { isNative } from './lib/native';
import LoginPage from './pages/LoginPage';
import { AddPage, ListPage, MapPage, SettingsPage } from './pages/lazyPages';

function withSuspense(element: React.ReactNode) {
  return <Suspense fallback={<FullScreenSpinner />}>{element}</Suspense>;
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/map" replace /> },
      { path: 'map', element: withSuspense(<MapPage />) },
      { path: 'list', element: withSuspense(<ListPage />) },
      /* The share-sheet target as well as the typed-in entry point: the PWA manifest's
         `share_target` lands here with the shared text in the query string. */
      { path: 'add', element: withSuspense(<AddPage />) },
      { path: 'settings', element: withSuspense(<SettingsPage />) },
      { path: '*', element: <Navigate to="/map" replace /> },
    ],
  },
]);

// Hardware back button: close any open Radix layer first (they listen for
// Escape), then walk the history, and only exit the app from the root screen.
if (isNative) {
  void CapApp.addListener('backButton', ({ canGoBack }) => {
    const openLayer = document.querySelector('[role="dialog"], [data-state="open"][role="menu"]');
    if (openLayer) {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }),
      );
      return;
    }
    if (canGoBack) window.history.back();
    else void CapApp.exitApp();
  });

  /* App Links: a URL on this app's host opens here rather than in the browser.
     Both halves are needed, and they cover different launches — `appUrlOpen` fires when the app is
     already running, while a cold start from a link has already happened by the time any listener
     could be attached, and only `getLaunchUrl` still knows about it. */
  const openDeepLink = (url: string) => {
    const route = routeForUrl(url);
    // Ignored rather than redirected when unrecognised: see routeForUrl. Nothing is lost — the
    // app simply opens where it would have anyway.
    if (route) void router.navigate(route);
  };

  void CapApp.addListener('appUrlOpen', ({ url }) => openDeepLink(url));
  void CapApp.getLaunchUrl().then((launch) => {
    if (launch?.url) openDeepLink(launch.url);
  });
}

/**
 * The app lock, ahead of the router.
 *
 * `LockScreen` replaces the router rather than covering it, so while locked there is no route
 * mounted at all — nothing queries the store, nothing paints a place into the DOM behind a
 * translucent panel, and the Android recents thumbnail is of the lock screen itself.
 */
function AppLockGate() {
  const { locked } = useLockState();
  if (locked) return <LockScreen />;
  return <RouterProvider router={router} />;
}

export default function App() {
  return <AppLockGate />;
}
