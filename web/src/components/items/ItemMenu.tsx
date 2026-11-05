import type { ImpressionSurface } from '@rove/shared';
import {
  Bookmark,
  BookmarkMinus,
  Check,
  Copy,
  Navigation,
  PanelTopOpen,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useItemActions } from '@/components/items/useItemActions';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/* The right-click menu for an item, on the list and on the map: the sheet's actions, a click
   closer. A long press on a phone raises the same event, so it is there too.
 *
 * Opened at the pointer by anchoring a dropdown to an invisible point, which works for React rows
 * and for the map's dots (HTML strings the SDK owns) alike. */

export interface ItemMenuTarget {
  itemId: string;
  x: number;
  y: number;
}

/**
 * The item a contextmenu event was raised on — the nearest `[data-item-id]` — and where to open,
 * or null when it was not on an item (the browser's own menu then stays). A keyboard's menu key
 * reports 0,0, so that opens beside the element instead.
 */
export function menuTarget(event: MouseEvent | React.MouseEvent): ItemMenuTarget | null {
  const el = (event.target as Element | null)?.closest<HTMLElement>('[data-item-id]');
  const itemId = el?.dataset.itemId;
  if (!el || !itemId) return null;
  event.preventDefault();
  if (event.clientX || event.clientY) return { itemId, x: event.clientX, y: event.clientY };
  const rect = el.getBoundingClientRect();
  return { itemId, x: rect.left + 16, y: rect.top + rect.height / 2 };
}

/** The menu's state for a page: `onContextMenu` for the element holding the items, and `menu`
    to render. */
export function useItemMenu(surface: ImpressionSurface, onOpenItem: (id: string) => void) {
  const [target, setTarget] = useState<ItemMenuTarget | null>(null);
  const [open, setOpen] = useState(false);
  return {
    onContextMenu: (event: MouseEvent | React.MouseEvent) => {
      const next = menuTarget(event);
      if (!next) return;
      setTarget(next);
      setOpen(true);
    },
    /* Stays mounted after closing, on the last item: a confirmation it raised outlives it. */
    menu: target && (
      <ItemMenu
        key={target.itemId}
        target={target}
        open={open}
        onOpenChange={setOpen}
        surface={surface}
        onOpenItem={onOpenItem}
      />
    ),
  };
}

function ItemMenu({
  target,
  open,
  onOpenChange,
  surface,
  onOpenItem,
}: {
  target: ItemMenuTarget;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  surface: ImpressionSurface;
  onOpenItem: (id: string) => void;
}) {
  const { t } = useTranslation();
  const actions = useItemActions(target.itemId, surface);
  const { item, location, visited } = actions;
  if (!item) return null;
  const candidate = item.status === 'candidate';
  return (
    <>
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <span
            aria-hidden
            className="pointer-events-none fixed size-0"
            style={{ left: target.x, top: target.y }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-auto min-w-48"
          sideOffset={2}
          aria-label={item.title}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <DropdownMenuItem onSelect={() => onOpenItem(item.id)}>
            <PanelTopOpen />
            {t('items.openDetails')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {candidate ? (
            <>
              <DropdownMenuItem onSelect={actions.keep}>
                <Bookmark />
                {t('items.keep')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={actions.dismiss}>
                <X />
                {t('items.dismiss')}
              </DropdownMenuItem>
            </>
          ) : (
            <>
              {location && (
                <DropdownMenuItem onSelect={actions.navigate}>
                  <Navigation />
                  {t('items.navigate')}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={actions.toggleVisited}>
                {visited ? <Undo2 /> : <Check />}
                {visited ? t('items.unmarkVisited') : t('items.markVisited')}
              </DropdownMenuItem>
              {actions.canUnkeep && (
                <DropdownMenuItem onSelect={actions.unkeep}>
                  <BookmarkMinus />
                  {t('items.unkeep')}
                </DropdownMenuItem>
              )}
            </>
          )}
          <DropdownMenuItem onSelect={actions.copyTitle}>
            <Copy />
            {t('items.copyName')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={actions.remove}>
            <Trash2 />
            {t('common.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {actions.dialogs}
    </>
  );
}
