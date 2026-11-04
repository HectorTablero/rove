import { API_BASE } from './apiClient';

/* Where to load a poster from. Most CDNs serve a hotlink with no Referer; Douban's answer 418
   unless the Referer is douban.com, so those go through the server's /api/cover, which sends it.
   Keep this list in step with REFERER_BY_HOST_SUFFIX in server/src/routes/cover.ts. */
const PROXIED_HOST = /\.doubanio\.com$/;

export function coverSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    if (PROXIED_HOST.test(new URL(url).hostname))
      return `${API_BASE}/api/cover?url=${encodeURIComponent(url)}`;
  } catch {
    return null;
  }
  return url;
}
