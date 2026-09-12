import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/* The region boundary, enforced.
 *
 * None of these rules is observable from inside a running app: a core file that imports Amap
 * directly still works in Shenzhen, and a coordinate converted in a page component still draws in
 * the right place today. They rot silently, which is why they are asserted against the source tree
 * rather than trusted. Each is one grep, and each has a sentence saying what breaks without it. */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const WORKSPACES = ['shared/src', 'server/src', 'web/src'].map((dir) => join(ROOT, dir));

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

const sources = WORKSPACES.flatMap(walk).filter(
  (file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file),
);

const rel = (file: string): string => relative(ROOT, file).split(sep).join('/');

/** Whether a file lives in a provider or source implementation directory, in any workspace. */
const isProviderCode = (file: string): boolean => /\/(providers|sources)\//.test(rel(file));

describe('region boundary', () => {
  it('core never imports a provider or a source directly — only the registries', () => {
    /* Without this, "Amap" becomes a word core says, and a second region means editing every file
       that said it. The registries (`providers/index`, `sources/index`, `regions/index`) are the
       only doors; a page that needs a navigation URL asks `navigationById(region.navigation)`. */
    const offenders: string[] = [];
    for (const file of sources) {
      if (isProviderCode(file)) continue;
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const specifier = match[1];
        const deep = /(?:^|\/)(providers|sources)\/(?!index$)[^'"]+/.test(specifier);
        const registryOnly =
          /(?:^|\/)(providers|sources)$/.test(specifier) ||
          /(?:^|\/)(providers|sources)\/index$/.test(specifier);
        if (deep && !registryOnly) offenders.push(`${rel(file)} → ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('datum conversion happens only in providers/datum.ts', () => {
    /* A coordinate converted anywhere else is a coordinate whose datum tag no longer says what it
       is. `gcoord` is imported by exactly one file; everything else calls `toDatum`, and only a
       provider's navigation builder or renderer may call that. */
    const importers = sources.filter((file) =>
      /from\s+['"]gcoord['"]/.test(readFileSync(file, 'utf8')),
    );
    expect(importers.map(rel)).toEqual(['shared/src/providers/datum.ts']);

    const converters = sources
      .filter((file) => /\btoDatum\(/.test(readFileSync(file, 'utf8')))
      .map(rel)
      .filter((file) => file !== 'shared/src/providers/datum.ts');
    for (const file of converters) {
      expect(file, `${file} converts datums but is not a provider navigation or renderer`).toMatch(
        /\/providers\/[^/]+\/(navigation|renderer)\.tsx?$/,
      );
    }
  });

  it('core never interprets a providerRef id — it is opaque outside the provider that minted it', () => {
    /* `providerRef.id` is an Amap POI id today and something else tomorrow. Core may compare two
       refs for equality (dedupe), use one as a React key, and copy it through a DTO; the moment it
       parses, slices, concatenates or interpolates the id, its *format* has become a core
       assumption. So the grep is for string operations on the id, not for reading it. */
    const interpreting =
      /providerRef(\?)?\.id\s*\.\s*(slice|split|match|replace|startsWith|endsWith|substring|substr|toLowerCase|toUpperCase|trim|includes|search|at|charAt)|providerRef(\?)?\.id\s*\+|\$\{[^}]*providerRef(\?)?\.id/;
    const offenders = sources
      .filter((file) => !isProviderCode(file))
      .filter((file) => interpreting.test(readFileSync(file, 'utf8')))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('every region names providers and sources that are registered', async () => {
    const { REGIONS } = await import('./regions');
    const { NAVIGATIONS } = await import('./providers');
    const { SOURCES } = await import('./sources');
    for (const region of REGIONS) {
      expect(NAVIGATIONS.map((n) => n.id)).toContain(region.navigation);
      for (const id of region.sources) {
        const source = SOURCES.find((s) => s.id === id);
        expect(source, `region ${region.id} names unknown source ${id}`).toBeDefined();
        expect(source!.regionIds === '*' || source!.regionIds.includes(region.id)).toBe(true);
      }
    }
  });
});
