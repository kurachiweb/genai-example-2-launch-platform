import { EllipsisIcon } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button } from '../../../lib/components/ui/button/button.tsx';
import { DropdownMenu } from '../../../lib/components/ui/dropdown-menu/dropdown-menu.tsx';
import { DropdownMenuContent } from '../../../lib/components/ui/dropdown-menu/dropdown-menu-content.tsx';
import { DropdownMenuTrigger } from '../../../lib/components/ui/dropdown-menu/dropdown-menu-trigger.tsx';
import { orderPublicProfileSections } from './public-profile-section-order.ts';
import type {
  PublicProfileMenuItem,
  PublicProfileSectionContext,
} from './public-profile-section-types.ts';
import { ACTIONS_MENU_LABEL } from './profile-messages.ts';

export interface ProfileActionsMenuProps {
  readonly context: PublicProfileSectionContext;
  readonly items: readonly PublicProfileMenuItem[];
}

// 項目は他の機能が登録する。本人には項目があっても出さず、項目が無ければボタンごと出さない。項目のダイアログは、メニューが閉じても残るようメニューの外に描く
export function ProfileActionsMenu({
  context,
  items,
}: ProfileActionsMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  // ダイアログが自分の中へフォーカスを移すため、メニューを閉じた時にボタンへ戻すと奪い合いになる
  const focusHandOffRef = useRef(false);
  if (context.isOwner || items.length === 0) {
    return null;
  }
  const ordered = orderPublicProfileSections(items);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            ref={triggerRef}
            size="icon-sm"
            variant="outline"
            aria-label={ACTIONS_MENU_LABEL}
          >
            <EllipsisIcon aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-48"
          onCloseAutoFocus={(event) => {
            if (focusHandOffRef.current) {
              focusHandOffRef.current = false;
              event.preventDefault();
            }
          }}
        >
          {ordered.map(({ id, Item }) => (
            <Item
              key={id}
              {...context}
              onSelect={() => {
                focusHandOffRef.current = true;
                setOpenItemId(id);
              }}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {ordered.map(({ id, Dialog }) => (
        <Dialog
          key={id}
          {...context}
          open={openItemId === id}
          onOpenChange={(open) => {
            setOpenItemId(open ? id : null);
          }}
          returnFocusRef={triggerRef}
        />
      ))}
    </>
  );
}
