import { useRef, useState } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../../styles/base.css';
import { runAxe } from '../../../test/a11y.ts';
import { Button } from '../button/button.tsx';
import { Sheet } from './sheet.tsx';
import { SheetContent } from './sheet-content.tsx';
import { SheetHeader } from './sheet-header.tsx';
import { SheetTitle } from './sheet-title.tsx';
import { SheetTrigger } from './sheet-trigger.tsx';
import {
  MEDIUM_SCREEN_QUERY,
  useCloseOnWideScreen,
} from './use-close-on-wide-screen.ts';

const NARROW_VIEWPORT = { width: 375, height: 800 } as const;
const WIDE_VIEWPORT = { width: 1024, height: 800 } as const;

function NarrowScreenMenu({
  defaultOpen = false,
  onClose = () => undefined,
}: {
  readonly defaultOpen?: boolean;
  readonly onClose?: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const wideNavigationRef = useRef<HTMLElement>(null);
  const onCloseAutoFocus = useCloseOnWideScreen({
    open,
    query: MEDIUM_SCREEN_QUERY,
    onClose: () => {
      onClose();
      setOpen(false);
    },
    onWideScreenFocus: () => {
      wideNavigationRef.current?.querySelector('a')?.focus();
    },
  });

  return (
    <div className="p-4">
      <nav
        ref={wideNavigationRef}
        aria-label="サイト内"
        className="hidden gap-2 md:flex"
      >
        <a href="#directory">ディレクトリ</a>
        <a href="#help">ヘルプ</a>
      </nav>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="outline" className="md:hidden">
            メニューを開く
          </Button>
        </SheetTrigger>
        <SheetContent
          aria-describedby={undefined}
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <SheetHeader>
            <SheetTitle>メニュー</SheetTitle>
          </SheetHeader>
        </SheetContent>
      </Sheet>
    </div>
  );
}

const trigger = () => page.getByRole('button', { name: 'メニューを開く' });
const sheet = () => page.getByRole('dialog', { name: 'メニュー' });
const wideLink = () =>
  page
    .getByRole('navigation', { name: 'サイト内' })
    .getByRole('link', { name: 'ディレクトリ' });

async function openWithKeyboard(): Promise<void> {
  trigger().element().focus();
  await userEvent.keyboard('{Enter}');
  await expect.element(sheet()).toBeInTheDocument();
}

beforeEach(async () => {
  await page.viewport(NARROW_VIEWPORT.width, NARROW_VIEWPORT.height);
});

describe('useCloseOnWideScreen', () => {
  test('開いたまま境界を越えて広げると、シートを閉じ、フォーカスを広い画面で見えている要素へ移す', async () => {
    const onClose = vi.fn();
    await render(<NarrowScreenMenu onClose={onClose} />);
    await openWithKeyboard();

    await page.viewport(WIDE_VIEWPORT.width, WIDE_VIEWPORT.height);

    await expect.element(sheet()).not.toBeInTheDocument();
    await expect.element(wideLink()).toHaveFocus();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test('境界を越えずに幅が変わっても開いたままで、閉じるとフォーカスを起動のボタンへ戻す', async () => {
    const onClose = vi.fn();
    await render(<NarrowScreenMenu onClose={onClose} />);
    await openWithKeyboard();

    await page.viewport(NARROW_VIEWPORT.width + 100, NARROW_VIEWPORT.height);
    await expect.element(sheet()).toBeVisible();
    await userEvent.keyboard('{Escape}');

    await expect.element(sheet()).not.toBeInTheDocument();
    await expect.element(trigger()).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();
  });

  test('広い画面で開いている間に境界を越えて狭めても閉じず、再び広げた時に閉じる', async () => {
    await page.viewport(WIDE_VIEWPORT.width, WIDE_VIEWPORT.height);
    const onClose = vi.fn();
    await render(<NarrowScreenMenu defaultOpen onClose={onClose} />);
    await expect.element(sheet()).toBeInTheDocument();

    await page.viewport(NARROW_VIEWPORT.width, NARROW_VIEWPORT.height);
    await expect.element(sheet()).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();

    await page.viewport(WIDE_VIEWPORT.width, WIDE_VIEWPORT.height);

    await expect.element(sheet()).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('閉じている間は幅の変化を購読せず、広げて閉じた後に狭い画面で開き直して閉じると起動のボタンへ戻す', async () => {
    const onClose = vi.fn();
    await render(<NarrowScreenMenu onClose={onClose} />);
    await openWithKeyboard();
    await userEvent.keyboard('{Escape}');
    await expect.element(sheet()).not.toBeInTheDocument();

    await page.viewport(WIDE_VIEWPORT.width, WIDE_VIEWPORT.height);
    await page.viewport(NARROW_VIEWPORT.width, NARROW_VIEWPORT.height);
    expect(onClose).not.toHaveBeenCalled();

    await openWithKeyboard();
    await page.viewport(WIDE_VIEWPORT.width, WIDE_VIEWPORT.height);
    await expect.element(sheet()).not.toBeInTheDocument();
    await page.viewport(NARROW_VIEWPORT.width, NARROW_VIEWPORT.height);
    await openWithKeyboard();
    await userEvent.keyboard('{Escape}');

    await expect.element(sheet()).not.toBeInTheDocument();
    await expect.element(trigger()).toHaveFocus();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
