import { lazy } from 'react';

// Shared between the router (for on-demand loading) and the idle-time
// preloader (for warming the cache ahead of navigation). Kept in one place
// so both sides reference the same import() specifiers.
export const pageLoaders = {
  map: () => import('./MapPage'),
  list: () => import('./ListPage'),
  add: () => import('./AddPage'),
  settings: () => import('./SettingsPage'),
} as const;

export const MapPage = lazy(pageLoaders.map);
export const ListPage = lazy(pageLoaders.list);
export const AddPage = lazy(pageLoaders.add);
export const SettingsPage = lazy(pageLoaders.settings);
