import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { TooltipProvider } from '../../../lib/components/ui/tooltip/tooltip-provider.tsx';
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
): PublicProfileMenuItem => ({
  id,
  order,
  Item: ({ handle }) => (
    <DropdownMenuItem>
      {label}:@{handle}
    </DropdownMenuItem>
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
    expect(document.activeElement).toBe(trigger().element());
  });

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
