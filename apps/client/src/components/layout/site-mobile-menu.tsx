import { MenuIcon } from 'lucide-react';
import { type ComponentType, type MouseEvent, useState } from 'react';

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
  MAIN_NAVIGATION_LABEL,
  MENU_LABEL,
  PRIMARY_NAVIGATION_LINKS,
} from './site-links.ts';

export interface SiteMobileMenuProps {
  readonly launchAction: ComponentType;
  readonly account: ComponentType;
  // 開いたまま画面幅が768px以上になって閉じた後に、同じ行き先を持つ見えている要素へフォーカスを移す。メニューのボタンがCSSで隠れて戻り先にならないため
  readonly onWideScreenClose: () => void;
}

export function SiteMobileMenu({
  launchAction: LaunchAction,
  account: Account,
  onWideScreenClose,
}: SiteMobileMenuProps) {
  const [open, setOpen] = useState(false);
  const onCloseAutoFocus = useCloseOnWideScreen({
    open,
    query: MEDIUM_SCREEN_QUERY,
    onClose: () => {
      setOpen(false);
    },
    onWideScreenFocus: onWideScreenClose,
  });

  // ブラウザ内の画面遷移ではページが入れ替わらずシートが開いたまま残るため、区画の部品を含む中のリンクを選んだら閉じる
  const closeOnLinkClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target instanceof Element && event.target.closest('a')) {
      setOpen(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="icon-sm" variant="ghost" className="md:hidden">
          <MenuIcon aria-hidden="true" />
          <span className="sr-only">{MENU_LABEL}</span>
        </Button>
      </SheetTrigger>
      <SheetContent
        aria-describedby={undefined}
        onClick={closeOnLinkClick}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <SheetHeader>
          <SheetTitle>{MENU_LABEL}</SheetTitle>
        </SheetHeader>
        <nav
          aria-label={MAIN_NAVIGATION_LABEL}
          className="flex flex-col gap-1 px-4"
        >
          {PRIMARY_NAVIGATION_LINKS.map(({ href, label }) => (
            <a
              key={href}
              href={href}
              className="rounded-md px-3 py-2 text-sm font-medium text-foreground no-underline hover:bg-accent"
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="flex flex-col gap-2 border-t border-border px-4 pt-4">
          <LaunchAction />
          <Account />
        </div>
      </SheetContent>
    </Sheet>
  );
}
