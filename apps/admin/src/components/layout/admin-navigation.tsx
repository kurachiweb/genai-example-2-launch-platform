import type { ActiveOptions } from '@tanstack/react-router';
import { MenuIcon } from 'lucide-react';
import { type MouseEvent, type Ref, useRef, useState } from 'react';

import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { Sheet } from '../../../lib/components/ui/sheet/sheet.tsx';
import { SheetContent } from '../../../lib/components/ui/sheet/sheet-content.tsx';
import { SheetHeader } from '../../../lib/components/ui/sheet/sheet-header.tsx';
import { SheetTitle } from '../../../lib/components/ui/sheet/sheet-title.tsx';
import { SheetTrigger } from '../../../lib/components/ui/sheet/sheet-trigger.tsx';
import {
  MEDIUM_SCREEN_QUERY,
  useCloseOnWideScreen,
} from '../../../lib/components/ui/sheet/use-close-on-wide-screen.ts';
import {
  ADMIN_NAV_ITEMS,
  type AdminNavItem,
} from '../../composition/admin-navigation.ts';
import { useAdminViewer } from '../auth/use-admin-viewer.ts';
import { ADMIN_HOME_HREF } from './admin-site.ts';
import { orderAdminNavItems } from './admin-nav-order.ts';
import {
  ADMIN_MENU_LABEL,
  ADMIN_NAVIGATION_LABEL,
} from './admin-shell-messages.ts';

export interface AdminNavigationProps {
  // 既定は登録箇所の項目
  readonly items?: readonly AdminNavItem[];
}

// トップページの項目は全ページのパスの先頭に一致するため、同じパスの時だけ現在のページとする。他の項目はその下のページでも現在のページとし、クエリは見ない
const HOME_ACTIVE_OPTIONS: ActiveOptions = Object.freeze({
  exact: true,
  includeSearch: false,
});

const SECTION_ACTIVE_OPTIONS: ActiveOptions = Object.freeze({
  includeSearch: false,
});

interface NavigationListProps {
  readonly items: readonly AdminNavItem[];
  readonly className?: string;
  readonly ref?: Ref<HTMLElement>;
}

// 項目は他のspecが登録する経路を指し型で指定できないため、パスで遷移させる。現在の項目はリンクがaria-current="page"を付けて示す
function NavigationList({ items, className, ref }: NavigationListProps) {
  return (
    <nav ref={ref} aria-label={ADMIN_NAVIGATION_LABEL} className={className}>
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.to}>
            <PathLink
              href={item.to}
              activeOptions={
                item.to === ADMIN_HOME_HREF
                  ? HOME_ACTIVE_OPTIONS
                  : SECTION_ACTIVE_OPTIONS
              }
              className="block rounded-md px-3 py-2 text-sm font-medium text-muted-foreground no-underline hover:bg-accent hover:text-accent-foreground aria-[current=page]:bg-accent aria-[current=page]:font-bold aria-[current=page]:text-foreground"
            >
              {item.label}
            </PathLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// 未ログインでは認証の画面・404・エラーのページに何も描かない。幅768px以上では本文の左の列に一覧を、768px未満ではヘッダーと本文の間に開閉のボタンを置き、一覧をシートで開く
export function AdminNavigation({
  items = ADMIN_NAV_ITEMS,
}: AdminNavigationProps) {
  const viewer = useAdminViewer();
  const [open, setOpen] = useState(false);
  const sideNavigationRef = useRef<HTMLElement>(null);
  // 開いたまま幅768px以上になって閉じた後は、開閉のボタンがCSSで隠れて戻り先にならないため、本文の左の列の一覧の最初の項目へ移す
  const onCloseAutoFocus = useCloseOnWideScreen({
    open,
    query: MEDIUM_SCREEN_QUERY,
    onClose: () => {
      setOpen(false);
    },
    onWideScreenFocus: () => {
      sideNavigationRef.current?.querySelector('a')?.focus();
    },
  });

  if (viewer === null) {
    return null;
  }

  const orderedItems = orderAdminNavItems(items);

  // ブラウザ内の画面遷移ではページが入れ替わらずシートが開いたまま残るため、中のリンクを選んだら閉じる
  const closeOnLinkClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target instanceof Element && event.target.closest('a')) {
      setOpen(false);
    }
  };

  return (
    <>
      <div className="border-b border-border px-4 py-2 md:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button size="sm" variant="outline">
              <MenuIcon aria-hidden="true" />
              {ADMIN_MENU_LABEL}
            </Button>
          </SheetTrigger>
          <SheetContent
            side="left"
            aria-describedby={undefined}
            onClick={closeOnLinkClick}
            onCloseAutoFocus={onCloseAutoFocus}
          >
            <SheetHeader>
              <SheetTitle>{ADMIN_MENU_LABEL}</SheetTitle>
            </SheetHeader>
            <NavigationList items={orderedItems} className="px-4" />
          </SheetContent>
        </Sheet>
      </div>
      <NavigationList
        ref={sideNavigationRef}
        items={orderedItems}
        className="hidden shrink-0 border-r border-border p-4 md:block md:w-56"
      />
    </>
  );
}
