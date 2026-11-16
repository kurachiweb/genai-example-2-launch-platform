import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { TooltipProvider } from '../../../lib/components/ui/tooltip/tooltip-provider.tsx';
import { Dialog } from '../../../lib/components/ui/dialog/dialog.tsx';
import { DialogContent } from '../../../lib/components/ui/dialog/dialog-content.tsx';
import { DialogDescription } from '../../../lib/components/ui/dialog/dialog-description.tsx';
import { DialogHeader } from '../../../lib/components/ui/dialog/dialog-header.tsx';
import { DialogTitle } from '../../../lib/components/ui/dialog/dialog-title.tsx';
import { DropdownMenuItem } from '../../../lib/components/ui/dropdown-menu/dropdown-menu-item.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import {
  ProfileActionsMenu,
  type ProfileActionsMenuProps,
} from './profile-actions-menu.tsx';
import type {
  PublicProfileMenuItem,
  PublicProfileSectionContext,
} from './public-profile-section-types.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const CONTEXT: PublicProfileSectionContext = {
  handle: 'maker_ai',
  nickname: 'ピッチの作り手',
  isOwner: false,
  suspended: false,
};

const itemOf = (
  id: string,
  order: number,
  label: string,
  { applicable = true }: { readonly applicable?: boolean } = {},
): PublicProfileMenuItem => ({
  id,
  order,
  Item: ({ handle, onSelect }) =>
    applicable ? (
      <DropdownMenuItem onSelect={onSelect}>
        {label}:@{handle}
      </DropdownMenuItem>
    ) : null,
  Dialog: ({ nickname, open, onOpenChange, returnFocusRef }) => (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{`${label}のダイアログ`}</DialogTitle>
          <DialogDescription>{nickname}</DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  ),
});

const renderMenu = (props: Partial<ProfileActionsMenuProps> = {}) =>
  renderInRouter(
    <TooltipProvider>
      <ProfileActionsMenu context={CONTEXT} items={[]} {...props} />
    </TooltipProvider>,
  );

const trigger = () => page.getByRole('button', { name: 'その他の操作' });

afterEach(() => {
  applyColorScheme('light');
});

describe('ProfileActionsMenu', () => {
  test('項目が1つ以上あれば、本人以外に「その他の操作」のボタンを出す', async () => {
    await renderMenu({ items: [itemOf('report', 10, '通報')] });

    await expect.element(trigger()).toBeVisible();
    await expect.element(trigger()).toHaveAttribute('aria-haspopup', 'menu');
  });

  test('項目が無ければボタンを出さない', async () => {
    await renderMenu({ items: [] });

    await expect.element(trigger()).not.toBeInTheDocument();
  });

  test('項目が登録されていても、本人には出さない', async () => {
    await renderMenu({
      context: { ...CONTEXT, isOwner: true },
      items: [itemOf('report', 10, '通報')],
    });

    await expect.element(trigger()).not.toBeInTheDocument();
  });

  test('開くと、項目を順序の小さい順に、表示中の利用者の文脈を渡して並べる', async () => {
    await renderMenu({
      items: [itemOf('b', 20, '後'), itemOf('a', 10, '先')],
    });

    await userEvent.click(trigger());

    const items = page.getByRole('menuitem');
    await expect.poll(() => items.elements().length).toBe(2);
    await expect.element(items.first()).toHaveTextContent('先:@maker_ai');
    await expect.element(items.nth(1)).toHaveTextContent('後:@maker_ai');
  });

  test('キーボードのEnterで開き、Escapeで閉じるとボタンへフォーカスが戻る', async () => {
    await renderMenu({ items: [itemOf('report', 10, '通報')] });
    (trigger().element() as HTMLElement).focus();

    await userEvent.keyboard('{Enter}');
    await expect.element(page.getByRole('menuitem')).toBeVisible();
    await userEvent.keyboard('{Escape}');

    await expect.element(page.getByRole('menuitem')).not.toBeInTheDocument();
    await expect.poll(() => document.activeElement).toBe(trigger().element());
  });

  test('キーボードで項目を選ぶと、メニューを閉じてその項目のダイアログだけを開いたまま残し、閉じるとボタンへフォーカスが戻る', async () => {
    await renderMenu({
      items: [itemOf('a', 10, '通報'), itemOf('b', 20, 'ブロック')],
    });
    (trigger().element() as HTMLElement).focus();

    await userEvent.keyboard('{Enter}');
    await expect
      .poll(() => document.activeElement?.textContent)
      .toBe('通報:@maker_ai');
    await userEvent.keyboard('{Enter}');

    const dialog = page.getByRole('dialog', { name: '通報のダイアログ' });
    await expect.element(dialog).toBeVisible();
    await expect.element(page.getByRole('menu')).not.toBeInTheDocument();
    await expect.element(dialog.getByText('ピッチの作り手')).toBeVisible();
    await expect
      .poll(() => dialog.element().contains(document.activeElement))
      .toBe(true);
    expect(
      page.getByRole('dialog', { name: 'ブロックのダイアログ' }).query(),
    ).toBeNull();

    await userEvent.keyboard('{Escape}');

    await expect.element(dialog).not.toBeInTheDocument();
    await expect.poll(() => document.activeElement).toBe(trigger().element());
  });

  test('項目を描かない登録だけでもボタンは出し、開いたメニューには項目が無い', async () => {
    await renderMenu({
      items: [itemOf('a', 10, '通報', { applicable: false })],
    });

    await userEvent.click(trigger());

    await expect.element(page.getByRole('menu')).toBeInTheDocument();
    expect(page.getByRole('menuitem').elements()).toHaveLength(0);
    expect(page.getByRole('dialog').query()).toBeNull();
  });

  test.each(COLOR_SCHEMES)(
    '%sの配色で、項目のダイアログのaxeの違反が0件である',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderMenu({ items: [itemOf('report', 10, '通報')] });
      await userEvent.click(trigger());
      await userEvent.click(page.getByRole('menuitem'));
      const dialog = page.getByRole('dialog', { name: '通報のダイアログ' });
      await expect.element(dialog).toBeVisible();

      expect(await runAxe(dialog.element())).toStrictEqual([]);
    },
  );

  test.each(COLOR_SCHEMES)(
    '開いたメニューで%sの配色のaxeの違反が0件である',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderMenu({ items: [itemOf('report', 10, '通報')] });
      await userEvent.click(trigger());
      await expect.element(page.getByRole('menuitem')).toBeVisible();

      expect(await runAxe(page.getByRole('menu').element())).toStrictEqual([]);
    },
  );
});
