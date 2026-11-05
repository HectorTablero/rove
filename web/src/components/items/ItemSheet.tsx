import {
  Bookmark,
  BookmarkMinus,
  Check,
  Copy,
  ExternalLink,
  MapPin,
  Navigation,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUpdateItem, useUpsertReview } from '@/api/hooks';
import { TranslatedText } from '@/components/common/TranslatedText';
import { StarRating } from '@/components/items/StarRating';
import { useItemActions } from '@/components/items/useItemActions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { recordShown } from '@/lib/impressions';
import { suggestPlaces } from '@/lib/ingest';
import { ApiError } from '@/lib/apiClient';
import { useHour12 } from '@/lib/preferences';
import { formatWhen } from '@/lib/when';
import { notifyError } from '@/lib/notify';
import { useRegion } from '@/lib/region';
import { coverSrc } from '@/lib/cover';
import { formatPrice } from '@/lib/price';
import { detectSource, useTranslatedText } from '@/lib/translate';
import { cn } from '@/lib/utils';

/* One item, and everything you can do to it: navigate there, mark it visited, rate it, write a
   note, delete it. Opened from the map and the list alike. Notes save on a short debounce and on
   close, like the settings page — a field typed into and closed never blurs. */

const NOTES_DEBOUNCE_MS = 600;
/** How long the copy button shows its check after a copy. */
const COPIED_MS = 1500;

export function ItemSheet({ itemId, onClose }: { itemId: string | null; onClose: () => void }) {
  return (
    <Dialog open={itemId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        {itemId && <ItemSheetBody itemId={itemId} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function ItemSheetBody({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const region = useRegion();
  const actions = useItemActions(itemId, 'sheet', onClose);
  const hour12 = useHour12();
  const { item, review, location, visited } = actions;
  const [locating, setLocating] = useState(false);
  /* 'idle' until the first copy, so the icon does not animate when the sheet opens; after that
     the check and the copy icon each zoom in as they swap, both ways. */
  const [copy, setCopy] = useState<'idle' | 'copied' | 'reverted'>('idle');
  const copied = copy === 'copied';
  useEffect(() => {
    if (!copied) return;
    const handle = setTimeout(() => setCopy('reverted'), COPIED_MS);
    return () => clearTimeout(handle);
  }, [copied]);
  // A broken poster hides itself; reset per item so one bad URL does not hide the next item's.
  const [coverFailed, setCoverFailed] = useState(false);
  useEffect(() => setCoverFailed(false), [itemId]);
  const translatedTitle = useTranslatedText(item?.title ?? '', 'title');
  const updateItem = useUpdateItem();
  const upsertReview = useUpsertReview();
  const [notes, setNotes] = useState<string | null>(null);
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => recordShown(itemId, 'sheet'), [itemId]);

  // Seed the notes draft once the review is known; later edits are local until saved.
  useEffect(() => {
    if (review !== undefined && notes === null) setNotes(review?.notes ?? '');
  }, [review, notes]);

  const saveNotes = (value: string) => {
    if ((review?.notes ?? '') === value) return;
    upsertReview.mutate({ itemId, input: { notes: value } });
  };
  const onNotesChange = (value: string) => {
    setNotes(value);
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => saveNotes(value), NOTES_DEBOUNCE_MS);
  };
  // The last save, on unmount: the sheet closing is the normal end of an edit.
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const reviewRef = useRef(review);
  reviewRef.current = review;
  useEffect(
    () => () => {
      if (notesTimer.current) clearTimeout(notesTimer.current);
      const value = notesRef.current;
      if (value !== null && (reviewRef.current?.notes ?? '') !== value) {
        upsertReview.mutate({ itemId, input: { notes: value } });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [itemId],
  );

  if (!item) return null;
  const candidate = item.status === 'candidate';
  const when =
    item.kind !== 'place' && item.when ? formatWhen(item.when, i18n.language, hour12) : null;
  const venue = item.kind === 'event' ? item.venue : null;

  /* A candidate's venue is text the feed printed. Finding it on the map spends one geocoder call,
     on purpose and on request — never sixty per poll — and keeps the first answer. */
  const locate = async () => {
    if (!venue) return;
    setLocating(true);
    try {
      const [first] = await suggestPlaces(venue, region.id);
      if (!first) {
        notifyError(t('items.venueNotFound', { venue }));
        return;
      }
      updateItem.mutate({ id: itemId, input: { location: first.location } });
    } catch (err) {
      notifyError(
        err instanceof ApiError
          ? t(`errors.codes.${err.code}`, { defaultValue: t('errors.unknown') })
          : t('errors.unknown'),
      );
    } finally {
      setLocating(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="pr-6">{translatedTitle ?? item.title}</DialogTitle>
        {/* The original stays one glance and one tap away: a translated name is no use at the
            venue's door or in a search box on another app. */}
        {translatedTitle && (
          <p className="-mt-1 flex items-center gap-1 pr-6 text-xs text-muted-foreground">
            <span lang={detectSource(item.title) ?? undefined} className="select-text">
              {item.title}
            </span>
            <button
              type="button"
              aria-label={copied ? t('items.copied') : t('items.copyOriginal')}
              className={cn(
                'shrink-0 rounded p-1 transition-colors hover:bg-accent hover:text-foreground',
                copied && 'text-primary hover:text-primary',
              )}
              onClick={() => void actions.copyTitle().then((ok) => ok && setCopy('copied'))}
            >
              {copied ? (
                <Check className="size-3.5 animate-in zoom-in-50 duration-150" />
              ) : (
                <Copy
                  className={cn(
                    'size-3.5',
                    copy === 'reverted' && 'animate-in zoom-in-50 duration-150',
                  )}
                />
              )}
            </button>
          </p>
        )}
        <DialogDescription className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary">{t(`items.kind.${item.kind}`)}</Badge>
          <Badge variant={visited ? 'default' : 'outline'}>
            {t(`items.status.${item.status}`)}
          </Badge>
          {item.altTitles.length > 0 && (
            <span className="text-xs text-muted-foreground">{item.altTitles.join(' · ')}</span>
          )}
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-4">
        {item.coverUrl && !coverFailed && (
          <img
            src={coverSrc(item.coverUrl) ?? undefined}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setCoverFailed(true)}
            className="max-h-56 w-full rounded-lg bg-muted object-cover"
          />
        )}
        {(when || venue || location?.address || item.price) && (
          <div className="flex flex-col gap-0.5 text-sm text-muted-foreground">
            {when && <p>{when}</p>}
            {item.kind !== 'place' && !item.when && <p>{t('items.timeUnknown')}</p>}
            {venue && <p>{venue}</p>}
            {location?.address && <p>{location.address}</p>}
            {item.price && (
              <p className="font-medium text-foreground">
                {formatPrice(item.price, t, i18n.language, region.currency)}
              </p>
            )}
          </div>
        )}
        {item.categories.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {item.categories.map((name) => (
              <Badge key={name} variant="outline">
                <TranslatedText text={name} />
              </Badge>
            ))}
          </div>
        )}

        {candidate ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="gap-1.5" onClick={actions.keep}>
              <Bookmark className="size-4" />
              {t('items.keep')}
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={actions.dismiss}>
              <X className="size-4" />
              {t('items.dismiss')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {location && (
              <Button size="sm" className="gap-1.5" onClick={actions.navigate}>
                <Navigation className="size-4" />
                {t('items.navigate')}
              </Button>
            )}
            {!location && venue && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={locating}
                onClick={() => void locate()}
              >
                <MapPin className="size-4" />
                {t('items.findOnMap')}
              </Button>
            )}
            <Button
              size="sm"
              variant={visited ? 'secondary' : 'outline'}
              className="gap-1.5"
              onClick={actions.toggleVisited}
            >
              {visited ? <Undo2 className="size-4" /> : <Check className="size-4" />}
              {visited ? t('items.unmarkVisited') : t('items.markVisited')}
            </Button>
            {actions.canUnkeep && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={actions.unkeep}>
                <BookmarkMinus className="size-4" />
                {t('items.unkeep')}
              </Button>
            )}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label>{t('items.rating')}</Label>
          <StarRating
            value={review?.rating ?? null}
            onChange={(rating) => upsertReview.mutate({ itemId, input: { rating } })}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="item-notes">{t('items.notes')}</Label>
          <Textarea
            id="item-notes"
            rows={3}
            placeholder={t('items.notesPlaceholder')}
            value={notes ?? ''}
            onChange={(e) => onNotesChange(e.target.value)}
            onBlur={() => notes !== null && saveNotes(notes)}
          />
        </div>

        {item.sourceUrls.length > 0 && (
          <div className="flex flex-col gap-1">
            <Label>{t('items.sources')}</Label>
            <ul className="flex flex-col gap-1">
              {item.sourceUrls.map((url) => (
                <li key={url}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex max-w-full items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
                  >
                    <ExternalLink className="size-3 shrink-0" />
                    <span className="truncate">{new URL(url).hostname.replace(/^www\./, '')}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {review?.visits.length ? (
          <p className="text-xs text-muted-foreground">
            {t('items.visitCount', { count: review.visits.length })}
          </p>
        ) : null}

        <div className="flex justify-end border-t pt-3">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground hover:text-destructive"
            onClick={actions.remove}
          >
            <Trash2 className="size-3.5" />
            {t('common.delete')}
          </Button>
        </div>
      </div>

      {actions.dialogs}
    </>
  );
}
