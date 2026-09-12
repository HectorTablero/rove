import type { MentionDto, SnapshotDto } from '@rove/shared';
import { AlertTriangle, Link2, MapPin, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { useCreateItem, useItems, useSettings, useUpdateItem } from '@/api/hooks';
import { Spinner } from '@/components/common/Spinner';
import { ItemSheet } from '@/components/items/ItemSheet';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { MapView } from '@/components/map/MapView';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createSnapshot, updateSnapshot } from '@/db/mutations';
import { getSnapshotByUrl } from '@/db/repo';
import { ApiError } from '@/lib/apiClient';
import { findDuplicate } from '@/lib/dedupe';
import { recordAction } from '@/lib/impressions';
import {
  extractMentions,
  resolveUrl,
  useSuggestions,
  type GeocodeCandidate,
  type ResolvedSnapshot,
} from '@/lib/ingest';
import { notifyError, notifySuccess } from '@/lib/notify';
import { useRegion } from '@/lib/region';
import { firstUrlIn, sharedUrlFromParams } from '@/lib/shareTarget';
import { cn } from '@/lib/utils';

/* The intake screen, in four steps that each work without the next:
 *
 *   1. a link (typed, pasted, or handed over by the share sheet)          → resolve
 *   2. the caption it carried, and — with a model configured — the places the model can point at
 *   3. a name, with the geocoder's suggestions as you type                 → a candidate
 *   4. the candidate on a small map, then Save                            → dedupe, then an item
 *
 * A link that cannot be read still leaves the caption area saying why, and step 3 works with no
 * link at all. The snapshot is written to the local store the moment the link resolves, so an
 * abandoned add still keeps the raw post for a later re-run. */

const SUGGEST_DEBOUNCE_MS = 300;

type Phase = 'idle' | 'resolving' | 'resolved';

export default function AddPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const region = useRegion();
  const [params] = useSearchParams();
  const { data: settings } = useSettings();
  const { data: items = [] } = useItems();
  const createItem = useCreateItem();
  const updateItem = useUpdateItem();

  const shared = useMemo(() => sharedUrlFromParams(params), [params]);
  const [url, setUrl] = useState(shared ?? '');
  const [phase, setPhase] = useState<Phase>('idle');
  const [snapshot, setSnapshot] = useState<SnapshotDto | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [mentions, setMentions] = useState<MentionDto[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [name, setName] = useState('');
  const [debouncedName, setDebouncedName] = useState('');
  const [candidate, setCandidate] = useState<GeocodeCandidate | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);

  const suggestions = useSuggestions(debouncedName, region.id);
  const canExtract = Boolean(settings?.llmBaseUrl && settings.llmModel);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedName(name), SUGGEST_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [name]);

  // A link from the share sheet resolves on its own — nobody shares a link to then press a button.
  useEffect(() => {
    if (shared) void resolve(shared);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared]);

  async function resolve(raw: string) {
    const target = firstUrlIn(raw) ?? raw.trim();
    if (!target) return;
    setPhase('resolving');
    setResolveError(null);
    setMentions([]);
    try {
      /* The same link shared twice reuses its snapshot rather than fetching again: the token in an
         XHS share link expires, and the first fetch is the one that had it. */
      const existing = await getSnapshotByUrl(target);
      const row = existing ?? (await store(target, await resolveUrl(target, region.id)));
      setSnapshot(row);
      setResolveError(row.error);
      setPhase('resolved');
      if (row.text && canExtract) void extract(row);
      else if (!row.text) nameInput.current?.focus();
    } catch (err) {
      setPhase('resolved');
      setSnapshot(null);
      setResolveError(err instanceof ApiError ? err.code : 'errors.unknown');
    }
  }

  async function store(target: string, resolved: ResolvedSnapshot): Promise<SnapshotDto> {
    const { sourceId, fetchedAt, title: _title, ...rest } = resolved;
    return createSnapshot({ sourceId, url: target, fetchedAt, ...rest, extraction: null });
  }

  async function extract(row: SnapshotDto) {
    setExtracting(true);
    try {
      const extraction = await extractMentions(row.text);
      setMentions(extraction.mentions);
      await updateSnapshot(row.id, { extraction });
      if (extraction.mentions.length === 1) pickMention(extraction.mentions[0]);
    } catch (err) {
      notifyError(
        t(err instanceof ApiError ? `errors.codes.${err.code}` : 'errors.unknown', {
          defaultValue: t('add.extractFailed'),
        }),
      );
    } finally {
      setExtracting(false);
    }
  }

  const pickMention = (mention: MentionDto) => {
    setName(mention.nameText);
    setCandidate(null);
    nameInput.current?.focus();
  };

  const save = () => {
    if (!candidate) return;
    const title = name.trim() || candidate.name;
    const canonicalUrl = snapshot?.canonicalUrl ?? snapshot?.url ?? null;
    const duplicate = findDuplicate({ title, location: candidate.location, canonicalUrl }, items);
    if (duplicate) {
      updateItem.mutate({
        id: duplicate.id,
        input: {
          snapshotIds:
            snapshot && !duplicate.snapshotIds.includes(snapshot.id)
              ? [...duplicate.snapshotIds, snapshot.id]
              : undefined,
          sourceUrls:
            canonicalUrl && !duplicate.sourceUrls.includes(canonicalUrl)
              ? [...duplicate.sourceUrls, canonicalUrl]
              : undefined,
          altTitles:
            title !== duplicate.title && !duplicate.altTitles.includes(title)
              ? [...duplicate.altTitles, title]
              : undefined,
        },
      });
      notifySuccess(t('add.merged', { title: duplicate.title }), { important: true });
      setSavedId(duplicate.id);
      return;
    }
    createItem.mutate(
      {
        regionId: region.id,
        kind: 'place',
        title,
        altTitles: candidate.name !== title ? [candidate.name] : [],
        categories: [],
        status: 'saved',
        snapshotIds: snapshot ? [snapshot.id] : [],
        sourceUrls: canonicalUrl ? [canonicalUrl] : [],
        expiresAt: null,
        location: candidate.location,
      },
      {
        onSuccess: (item) => {
          recordAction(item.id, 'sheet', 'save');
          notifySuccess(t('add.saved', { title }), { important: true });
          setSavedId(item.id);
        },
      },
    );
  };

  const reset = () => {
    setUrl('');
    setPhase('idle');
    setSnapshot(null);
    setResolveError(null);
    setMentions([]);
    setName('');
    setCandidate(null);
    setSavedId(null);
  };

  return (
    <PageContainer>
      <PageHeader title={t('nav.add')} />
      <div className="flex flex-col gap-6">
        {/* 1. the link */}
        <section className="flex flex-col gap-2">
          <Label htmlFor="add-url">{t('add.linkLabel')}</Label>
          <div className="flex gap-2">
            <Input
              id="add-url"
              inputMode="url"
              autoComplete="off"
              placeholder={t('add.linkPlaceholder')}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void resolve(url)}
            />
            <Button
              variant="secondary"
              disabled={!url.trim() || phase === 'resolving'}
              onClick={() => void resolve(url)}
              className="gap-1.5"
            >
              {phase === 'resolving' ? (
                <Spinner className="size-4" />
              ) : (
                <Link2 className="size-4" />
              )}
              {t('add.read')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t('add.linkHint')}</p>
        </section>

        {/* 2. what it said */}
        {phase === 'resolved' && (
          <section className="flex flex-col gap-2 rounded-xl border bg-card p-3">
            {resolveError && (
              <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  {t('add.readFailed')} <code className="font-mono">{resolveError}</code>
                </span>
              </p>
            )}
            {snapshot?.text ? (
              <>
                <p className="text-xs font-medium text-muted-foreground">
                  {t('add.captionFrom', { source: snapshot.sourceId })}
                </p>
                <CaptionWithEvidence text={snapshot.text} mentions={mentions} />
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  {extracting && <Spinner className="size-3.5" />}
                  {mentions.map((mention) => (
                    <button
                      key={mention.nameText}
                      type="button"
                      onClick={() => pickMention(mention)}
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-accent',
                        name === mention.nameText && 'border-primary bg-accent',
                      )}
                    >
                      {mention.nameText}
                    </button>
                  ))}
                  {!extracting && mentions.length === 0 && (
                    <span className="text-xs text-muted-foreground">
                      {canExtract ? t('add.noMentions') : t('add.noModel')}
                    </span>
                  )}
                  {!extracting && canExtract && snapshot && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto h-7 gap-1 text-xs"
                      onClick={() => void extract(snapshot)}
                    >
                      <Sparkles className="size-3.5" />
                      {mentions.length ? t('add.extractAgain') : t('add.extract')}
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">{t('add.noCaption')}</p>
            )}
          </section>
        )}

        {/* 3. the name */}
        <section className="flex flex-col gap-2">
          <Label htmlFor="add-name">{t('add.nameLabel')}</Label>
          <Input
            ref={nameInput}
            id="add-name"
            autoComplete="off"
            placeholder={t('add.namePlaceholder')}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setCandidate(null);
            }}
          />
          {suggestions.isError && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {suggestions.error instanceof ApiError
                ? t(`errors.codes.${suggestions.error.code}`, {
                    defaultValue: t('add.suggestFailed'),
                  })
                : t('add.suggestFailed')}
            </p>
          )}
          {!candidate && suggestions.data && suggestions.data.length > 0 && (
            <ul
              role="listbox"
              aria-label={t('add.suggestions')}
              className="flex flex-col overflow-hidden rounded-lg border"
            >
              {suggestions.data.map((option, index) => (
                <li key={option.location.providerRef?.id ?? String(index)}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => {
                      setCandidate(option);
                      if (!name.trim()) setName(option.name);
                    }}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
                  >
                    <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{option.name}</span>
                      {option.location.address && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {option.location.address}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!candidate && suggestions.data?.length === 0 && (
            <p className="text-xs text-muted-foreground">{t('add.noSuggestions')}</p>
          )}
        </section>

        {/* 4. the place, and Save */}
        {candidate && (
          <section className="flex flex-col gap-3">
            <div className="overflow-hidden rounded-xl border">
              <MapView
                className="h-48 w-full"
                center={candidate.location.point}
                zoom={15}
                markers={[
                  {
                    id: 'candidate',
                    point: candidate.location.point,
                    title: candidate.name,
                    status: 'saved',
                  },
                ]}
              />
              <div className="px-3 py-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{candidate.name}</span>
                {candidate.location.address && <> · {candidate.location.address}</>}
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={save} disabled={createItem.isPending} className="gap-1.5">
                {createItem.isPending ? (
                  <Spinner className="size-4" />
                ) : (
                  <MapPin className="size-4" />
                )}
                {t('common.save')}
              </Button>
              <Button variant="ghost" onClick={() => setCandidate(null)}>
                {t('add.chooseAnother')}
              </Button>
            </div>
          </section>
        )}
      </div>

      <ItemSheet
        itemId={savedId}
        onClose={() => {
          reset();
          void navigate('/list');
        }}
      />
    </PageContainer>
  );
}

/** The caption with every accepted mention's evidence marked, so a suggestion can be checked
    against the words it came from at a glance. */
function CaptionWithEvidence({ text, mentions }: { text: string; mentions: MentionDto[] }) {
  const spans = useMemo(() => {
    const marks = mentions
      .map((m) => ({
        start: text.indexOf(m.evidence),
        end: text.indexOf(m.evidence) + m.evidence.length,
      }))
      .filter((m) => m.start >= 0)
      .sort((a, b) => a.start - b.start);
    const out: { text: string; marked: boolean }[] = [];
    let cursor = 0;
    for (const mark of marks) {
      if (mark.start < cursor) continue;
      if (mark.start > cursor) out.push({ text: text.slice(cursor, mark.start), marked: false });
      out.push({ text: text.slice(mark.start, mark.end), marked: true });
      cursor = mark.end;
    }
    if (cursor < text.length) out.push({ text: text.slice(cursor), marked: false });
    return out;
  }, [text, mentions]);
  return (
    <p className="max-h-48 overflow-y-auto text-sm whitespace-pre-wrap">
      {spans.map((span, i) =>
        span.marked ? (
          <mark key={i} className="rounded bg-primary/15 px-0.5 text-foreground">
            {span.text}
          </mark>
        ) : (
          <span key={i}>{span.text}</span>
        ),
      )}
    </p>
  );
}
