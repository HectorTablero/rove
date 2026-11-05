import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isNative } from './native';
import { usePreferences } from './preferences';
import { applyCase, type Casing } from './casing';

/* On-device translation of item titles, never through a server.
 *
 * Two engines behind one interface: Chrome's built-in Translator API (Gemini Nano family, desktop
 * Chrome) on the web, and ML Kit through @capacitor-mlkit/translation in the Android app, whose
 * WebView has no Translator. Both download a model per language once; after that everything is
 * local. Adapted from the GDG-UAM page translator, minus its DOM walking: here only titles are
 * translated, and the original is always kept beside the translation. */

export type Availability = 'available' | 'downloadable' | 'unavailable';

interface Engine {
  availability(source: string, target: string): Promise<Availability>;
  /** Downloads what the pair needs. On the web this must run inside a user gesture. */
  prepare(source: string, target: string): Promise<void>;
  translate(text: string, source: string, target: string): Promise<string>;
}

interface BrowserTranslator {
  translate(text: string): Promise<string>;
}
interface BrowserTranslatorApi {
  availability(opts: {
    sourceLanguage: string;
    targetLanguage: string;
  }): Promise<'available' | 'downloadable' | 'downloading' | 'unavailable'>;
  create(opts: { sourceLanguage: string; targetLanguage: string }): Promise<BrowserTranslator>;
}

const browserApi = (): BrowserTranslatorApi | undefined =>
  (globalThis as { Translator?: BrowserTranslatorApi }).Translator;

const browserEngine = (): Engine => {
  const instances = new Map<string, Promise<BrowserTranslator>>();
  const instance = (source: string, target: string) => {
    const key = `${source}>${target}`;
    let made = instances.get(key);
    if (!made) {
      made = browserApi()!.create({ sourceLanguage: source, targetLanguage: target });
      made.catch(() => instances.delete(key));
      instances.set(key, made);
    }
    return made;
  };
  return {
    async availability(source, target) {
      const api = browserApi();
      if (!api) return 'unavailable';
      try {
        const state = await api.availability({ sourceLanguage: source, targetLanguage: target });
        return state === 'downloading' ? 'downloadable' : state;
      } catch {
        return 'unavailable';
      }
    },
    async prepare(source, target) {
      await instance(source, target);
    },
    async translate(text, source, target) {
      return (await instance(source, target)).translate(text);
    },
  };
};

const nativeEngine = (): Engine => {
  /* Imported on first use so the web bundle never carries the plugin's proxy. The module is what
     the promise resolves to, never the plugin: a Capacitor proxy answers every property, `then`
     included, so awaiting it calls a native "Translation.then()" that rejects on Android. */
  const loadModule = () => import('@capacitor-mlkit/translation');
  type Plugin = Awaited<ReturnType<typeof loadModule>>['Translation'];
  const withPlugin = async <T>(use: (plugin: Plugin) => Promise<T>): Promise<T> =>
    use((await loadModule()).Translation);
  const asLanguage = (code: string) => code as Parameters<Plugin['translate']>[0]['sourceLanguage'];
  return {
    async availability(source, target) {
      try {
        const { languages } = await withPlugin((p) => p.getDownloadedModels());
        const have = new Set<string>(languages);
        return have.has(source) && have.has(target) ? 'available' : 'downloadable';
      } catch (err) {
        // The Settings switch hides on 'unavailable'; say why somewhere a developer can see it
        // (chrome://inspect). No plugin in an older APK, or no Google Play services, end here.
        console.warn('[translate] ML Kit unavailable:', err);
        return 'unavailable';
      }
    },
    async prepare(source, target) {
      await withPlugin(async (p) => {
        for (const language of [source, target])
          await p.downloadModel({ language: asLanguage(language) });
      });
    },
    async translate(text, source, target) {
      const result = await withPlugin((p) =>
        p.translate({
          text,
          sourceLanguage: asLanguage(source),
          targetLanguage: asLanguage(target),
        }),
      );
      return result.text;
    },
  };
};

export const engine: Engine = isNative ? nativeEngine() : browserEngine();

/* ponytail: script-based source detection — kana is Japanese, Hangul Korean, other Han Chinese,
   anything else left alone. Right for Shenzhen's feeds; a LanguageDetector pass if a region ever
   mixes Latin-script languages. */
export function detectSource(text: string): string | null {
  if (/[぀-ヿ]/.test(text)) return 'ja';
  if (/[가-힯]/.test(text)) return 'ko';
  if (/[一-鿿]/.test(text)) return 'zh';
  return null;
}

/** The UI language as a bare code ('zh-CN' → 'zh'), which is what both engines take. */
export const baseLanguage = (lng: string): string => lng.split('-')[0].toLowerCase();

/* Translations are kept per pair in localStorage: titles repeat across every list render and
   every device restart, and a model call per paint would be visible. Capped, oldest out. */
const CACHE_LIMIT = 1000;
const memory = new Map<string, Map<string, string>>();
const cacheKey = (source: string, target: string) => `rove:translations:${source}>${target}`;

function cacheFor(source: string, target: string): Map<string, string> {
  const key = cacheKey(source, target);
  let cache = memory.get(key);
  if (!cache) {
    cache = new Map();
    try {
      const stored = JSON.parse(localStorage.getItem(key) ?? '[]') as [string, string][];
      cache = new Map(stored);
    } catch {
      // Private mode or a corrupt blob: start empty, it only costs re-translating.
    }
    memory.set(key, cache);
  }
  return cache;
}

function remember(source: string, target: string, text: string, translated: string): void {
  const cache = cacheFor(source, target);
  cache.set(text, translated);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  try {
    localStorage.setItem(cacheKey(source, target), JSON.stringify([...cache]));
  } catch {
    // Quota or private mode: the in-memory copy still serves this session.
  }
}

// One translation at a time: a list of forty titles should not start forty model calls at once.
let queue: Promise<unknown> = Promise.resolve();
const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
};

/**
 * The text translated into the UI language, or null when it should be shown as is: translation
 * off, the text already in the UI language, the model not downloaded, or the engine failing.
 * Never downloads anything by itself — that only happens from the Settings switch.
 *
 * `casing` says what the text is — a title, or a label such as a tag — since the case of a
 * translation out of Chinese is the engine's guess (see lib/casing). Applied on the way out, not
 * cached, so a change to the rules reaches translations already stored.
 */
export function useTranslatedText(text: string, casing: Casing): string | null {
  const { autoTranslate } = usePreferences();
  const { i18n } = useTranslation();
  const target = baseLanguage(i18n.language);
  const source = detectSource(text);
  const active = autoTranslate && source !== null && source !== target;
  const cached = useMemo(
    () => (active ? (cacheFor(source!, target).get(text) ?? null) : null),
    [active, source, target, text],
  );
  const [fresh, setFresh] = useState<{ text: string; value: string } | null>(null);

  useEffect(() => {
    if (!active || cached) return;
    let cancelled = false;
    void enqueue(async () => {
      if (cancelled) return;
      if ((await engine.availability(source!, target)) !== 'available') return;
      const value = (await engine.translate(text, source!, target)).trim();
      if (!value) return;
      remember(source!, target, text, value);
      if (!cancelled) setFresh({ text, value });
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [active, cached, source, target, text]);

  if (!active) return null;
  const value = cached ?? (fresh?.text === text ? fresh.value : null);
  return value && applyCase(value, target, casing);
}
