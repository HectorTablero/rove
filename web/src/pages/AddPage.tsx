import { MAX_SNAPSHOT_TEXT_LENGTH, type MentionDto, type SnapshotDto } from '@rove/shared';
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
import { Textarea } from '@/components/ui/textarea';
import { createSnapshot, updateSnapshot } from '@/db/mutations';
import { getSnapshotByUrl } from '@/db/repo';
import { ApiError } from '@/lib/apiClient';
import { findDuplicate } from '@/lib/dedupe';
import { markMentions } from '@/lib/mentionMarks';
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
 * A link that cannot be read still leaves the caption area saying why, and offers a box to paste
 * the caption into (Instagram no longer lets a server read a post's text; one long-press there
 * copies it), after which steps 2–4 run on it as on any read caption. Step 3 works with no link
 * at all. The snapshot is written to the local store the moment the link resolves, so an
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
  /* What the geocoder is asked: the name as typed, or — for a picked mention — its search text,
     which carries the branch or mall that tells one store of a brand from the rest. */
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [candidate, setCandidate] = useState<GeocodeCandidate | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [pasted, setPasted] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);

  const suggestions = useSuggestions(debouncedQuery, region.id);
  const canExtract = Boolean(settings?.llmBaseUrl && settings.llmModel);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(query), SUGGEST_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query]);

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
      /* Only a clean read goes to the model on its own. A read with an error carries at best a
         fallback — Instagram's page title, "Instagram" — and is answered with the paste box. */
      if (row.text && !row.error && canExtract) void extract(row);
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

  /* The caption the user copied by hand, kept on the link's snapshot like a read one, so a later
     re-run of the extractor finds it there. */
  async function applyPasted(row: SnapshotDto) {
    const text = pasted.trim().slice(0, MAX_SNAPSHOT_TEXT_LENGTH);
    if (!text) return;
    const next = { ...row, text, error: null };
    await updateSnapshot(row.id, { text, error: null });
    setSnapshot(next);
    setResolveError(null);
    setPasted('');
    setPasteOpen(false);
    if (canExtract) void extract(next);
    else nameInput.current?.focus();
  }

  /* The main name by default, the one the model judged a map search finds best; or one of its
     aliases, picked by hand, searched with the same location parts the main name carried. */
  const pickMention = (mention: MentionDto, alias?: string) => {
    const chosen = alias ?? mention.nameText;
    setName(chosen);
    setQuery(mention.searchText ? mention.searchText.replace(mention.nameText, chosen) : chosen);
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
        price: null,
        coverUrl: null,
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
    setQuery('');
    setCandidate(null);
    setSavedId(null);
    setPasted('');
    setPasteOpen(false);
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
            {snapshot?.text && !resolveError && (
              <>
                <p className="text-xs font-medium text-muted-foreground">
                  {t('add.captionFrom', { source: snapshot.sourceId })}
                </p>
                <CaptionWithEvidence text={snapshot.text} mentions={mentions} />
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  {extracting && <Spinner className="size-3.5" />}
                  {mentions.map((mention, index) => {
                    const names = [mention.nameText, ...(mention.aliases ?? [])];
                    return (
                      /* One pill per place, every name it goes by in it. Each name picks itself;
                         anywhere else on the pill (the dot, the address, the padding) picks the
                         main name, the first. The main name's own button is the keyboard's way
                         to that, so the pill itself needs no role. */
                      <div
                        key={mention.nameText}
                        onClick={() => pickMention(mention)}
                        style={
                          { '--m': mentionColor(index, mentions.length) } as React.CSSProperties
                        }
                        className={cn(
                          'flex max-w-full cursor-pointer items-baseline gap-1.5 rounded-2xl border px-2.5 py-1 text-xs transition-colors hover:bg-accent',
                          names.includes(name) &&
                            'border-(--m) bg-[color-mix(in_oklab,var(--m)_14%,transparent)]',
                        )}
                      >
                        <span
                          aria-hidden
                          className="size-2 shrink-0 translate-y-px self-center rounded-full bg-(--m)"
                        />
                        <span className="min-w-0">
                          {names.map((option, n) => (
                            <span key={option}>
                              {n > 0 && (
                                <span aria-hidden className="px-1 text-muted-foreground">
                                  ·
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  pickMention(mention, n === 0 ? undefined : option);
                                }}
                                className={cn(
                                  'rounded-sm underline-offset-2 decoration-(--m) decoration-2 hover:underline',
                                  n === 0 && 'font-medium',
                                  name === option && 'underline',
                                )}
                              >
                                {option}
                              </button>
                            </span>
                          ))}
                          {mention.addressText && (
                            <span className="text-muted-foreground"> {mention.addressText}</span>
                          )}
                        </span>
                      </div>
                    );
                  })}
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
                {!pasteOpen && (
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto self-start p-0 text-xs"
                    onClick={() => setPasteOpen(true)}
                  >
                    {t('add.pasteInstead')}
                  </Button>
                )}
              </>
            )}
            {snapshot && (!snapshot.text || resolveError || pasteOpen) ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="add-paste" className="text-xs font-medium">
                  {t('add.pasteLabel')}
                </Label>
                <p className="text-xs text-muted-foreground">{t('add.pasteHint')}</p>
                <Textarea
                  id="add-paste"
                  rows={4}
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  className="gap-1.5 self-start"
                  disabled={!pasted.trim()}
                  onClick={() => void applyPasted(snapshot)}
                >
                  <Sparkles className="size-3.5" />
                  {canExtract ? t('add.pasteFind') : t('add.pasteUse')}
                </Button>
              </div>
            ) : (
              !snapshot && <p className="text-xs text-muted-foreground">{t('add.noCaption')}</p>
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
              setQuery(e.target.value);
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

/** Each found place's colour: the hues spread evenly round the wheel, as many as there are
    places, starting from blue; saturation and lightness come from the theme (--mention-s/-l in
    index.css). However many a post names, no two share a colour. */
const mentionColor = (index: number, count: number) =>
  `hsl(${Math.round(210 + (index * 360) / Math.max(count, 1)) % 360} var(--mention-s) var(--mention-l))`;

/* The caption, with each place the extractor found in its own colour: its name tinted, and the
   location parts it read for that place underlined in the same colour. The chips below carry a
   matching dot, so the chip row is the legend. */
function CaptionWithEvidence({ text, mentions }: { text: string; mentions: MentionDto[] }) {
  const runs = useMemo(() => markMentions(text, mentions), [text, mentions]);
  return (
    <p className="max-h-48 overflow-y-auto text-sm whitespace-pre-wrap">
      {runs.map((run, i) =>
        run.mention === null ? (
          <span key={i}>{run.text}</span>
        ) : (
          <mark
            key={i}
            style={{ '--m': mentionColor(run.mention, mentions.length) } as React.CSSProperties}
            className={cn(
              'text-foreground decoration-(--m) decoration-2 underline-offset-[3px]',
              run.role === 'name'
                ? 'rounded-sm bg-[color-mix(in_oklab,var(--m)_22%,transparent)] px-0.5 font-medium underline'
                : 'bg-transparent underline decoration-dotted',
            )}
          >
            {run.text}
          </mark>
        ),
      )}
    </p>
  );
}
