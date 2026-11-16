import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { resetTurnstileScriptFailure } from '../../../lib/components/bot-protection/turnstile-script-failure.ts';
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
import { resetFakeTurnstile } from '../../../lib/test/fake-turnstile.tsx';
import { pressKeyUntilFocusMoves } from '../../../lib/test/keyboard.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import type {
  CommentAction,
  CommentActionContext,
} from './comment-action-types.ts';
import { CommentMenu, type CommentMenuProps } from './comment-menu.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../../../lib/test/fake-turnstile.tsx'),
);

const CONTEXT: CommentActionContext = Object.freeze({
  comment: {
    id: '01JC0COMMENT00000000000000',
    authorNickname: 'ピッチの作り手',
  },
  product: { id: '01JC0PRODUCT00000000000000', handle: 'pitch_notes' },
  launch: { id: '01JC0LAUNCH000000000000000' },
});

const DELETE_TITLE = 'コメントを削除しますか?';

const actionOf = (
  id: string,
  order: number,
  label: string,
  { applicable = true }: { readonly applicable?: boolean } = {},
): CommentAction => ({
  id,
  order,
  Item: ({ comment, product, launch, onSelect }) =>
    applicable ? (
      <DropdownMenuItem onSelect={onSelect}>
        {label}:{comment.authorNickname}:{product.handle}:{launch.id}
      </DropdownMenuItem>
    ) : null,
  Dialog: ({ comment, open, onOpenChange, returnFocusRef }) => (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{`${label}のダイアログ`}</DialogTitle>
          <DialogDescription>{comment.id}</DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  ),
});

interface RenderResult {
  readonly onEdit: CommentMenuProps['onEdit'];
  readonly onDelete: ReturnType<
    typeof vi.fn<(turnstileToken: string) => Promise<void>>
  >;
}

const renderMenu = async (
  props: Partial<CommentMenuProps> = {},
): Promise<RenderResult> => {
  const onEdit = vi.fn();
  const onDelete = vi.fn<(turnstileToken: string) => Promise<void>>(() =>
    Promise.resolve(),
  );
  await renderInRouter(
    <main className="bg-background p-4 text-foreground">
      <CommentMenu
        context={CONTEXT}
        viewerIsAuthor={false}
        actions={[]}
        onEdit={onEdit}
        onDelete={onDelete}
        {...props}
      />
    </main>,
  );
  return { onEdit, onDelete };
};

const trigger = () => page.getByRole('button', { name: 'コメントの操作' });

const menuItems = () => page.getByRole('menuitem');

const deleteDialog = () => page.getByRole('dialog', { name: DELETE_TITLE });

const focusTrigger = () => {
  (trigger().element() as HTMLElement).focus();
};

// モーダルのダイアログの間は外側の要素が支援技術とポインターから隠れるため、ダイアログの外に描く判定の偽物のボタンは要素を直接押す
const passBotCheck = () => {
  const button = page.getByText('判定を成功させる').element();
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error('判定の偽物のボタンがありません。');
  }
  button.click();
};

beforeEach(() => {
  resetFakeTurnstile();
  resetTurnstileScriptFailure();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('CommentMenu', () => {
  test('自身のコメントには「編集」「削除」を出し、登録された操作は出さない', async () => {
    await renderMenu({
      viewerIsAuthor: true,
      actions: [actionOf('content-reporting.comment-report', 10, '通報')],
    });

    await expect.element(trigger()).toHaveAttribute('aria-haspopup', 'menu');
    await userEvent.click(trigger());

    await expect.poll(() => menuItems().elements().length).toBe(2);
    await expect.element(menuItems().first()).toHaveTextContent('編集');
    await expect.element(menuItems().nth(1)).toHaveTextContent('削除');
  });

  test('他者のコメントには登録された操作をorderの小さい順に、コメントの文脈を渡して並べる', async () => {
    await renderMenu({
      actions: [actionOf('b.after', 20, '後'), actionOf('a.before', 10, '先')],
    });

    await userEvent.click(trigger());

    await expect.poll(() => menuItems().elements().length).toBe(2);
    await expect
      .element(menuItems().first())
      .toHaveTextContent(
        '先:ピッチの作り手:pitch_notes:01JC0LAUNCH000000000000000',
      );
    await expect.element(menuItems().nth(1)).toHaveTextContent('後:');
    await expect
      .element(page.getByRole('menuitem', { name: '編集' }))
      .not.toBeInTheDocument();
  });

  test('他者のコメントで登録された操作が無ければメニューを出さない', async () => {
    await renderMenu({ actions: [] });

    await expect.element(trigger()).not.toBeInTheDocument();
  });

  test('キーボードで登録された操作の項目を選ぶと、メニューを閉じてその操作のダイアログだけを開いたまま残し、閉じると「…」のボタンへフォーカスが戻る', async () => {
    await renderMenu({
      actions: [
        actionOf('a.report', 10, '通報'),
        actionOf('b.mute', 20, '非表示'),
      ],
    });
    focusTrigger();

    await userEvent.keyboard('{Enter}');
    await expect
      .poll(() => document.activeElement?.textContent)
      .toContain('通報:');
    await userEvent.keyboard('{Enter}');

    const dialog = page.getByRole('dialog', { name: '通報のダイアログ' });
    await expect.element(dialog).toBeVisible();
    await expect.element(page.getByRole('menu')).not.toBeInTheDocument();
    await expect
      .element(dialog.getByText('01JC0COMMENT00000000000000'))
      .toBeVisible();
    await expect
      .poll(() => dialog.element().contains(document.activeElement))
      .toBe(true);
    expect(
      page.getByRole('dialog', { name: '非表示のダイアログ' }).query(),
    ).toBeNull();

    await userEvent.keyboard('{Escape}');

    await expect.element(dialog).not.toBeInTheDocument();
    await expect.poll(() => document.activeElement).toBe(trigger().element());
  });

  test('項目を描かない登録だけでも「…」のボタンは出し、開いたメニューには項目が無い', async () => {
    await renderMenu({
      actions: [actionOf('a.report', 10, '通報', { applicable: false })],
    });

    await userEvent.click(trigger());

    await expect.element(page.getByRole('menu')).toBeInTheDocument();
    expect(menuItems().elements()).toHaveLength(0);
    expect(page.getByRole('dialog').query()).toBeNull();
  });

  test('登録口を渡さなければ初版の空の登録口を使い、他者のコメントにはメニューを出さない', async () => {
    const onEdit = vi.fn();
    await renderInRouter(
      <CommentMenu
        context={CONTEXT}
        viewerIsAuthor={false}
        onEdit={onEdit}
        onDelete={() => Promise.resolve()}
      />,
    );

    await expect.element(trigger()).not.toBeInTheDocument();
  });

  test('キーボードのEnterで開き、矢印キーで項目を移り、Escapeで閉じるとボタンへフォーカスが戻る', async () => {
    await renderMenu({ viewerIsAuthor: true });
    focusTrigger();

    await userEvent.keyboard('{Enter}');
    await expect.element(page.getByRole('menu')).toBeVisible();
    await expect.poll(() => document.activeElement?.textContent).toBe('編集');
    await pressKeyUntilFocusMoves('ArrowDown');
    await expect.poll(() => document.activeElement?.textContent).toBe('削除');
    await userEvent.keyboard('{Escape}');

    await expect.element(page.getByRole('menu')).not.toBeInTheDocument();
    await expect.poll(() => document.activeElement).toBe(trigger().element());
  });

  test('キーボードで「編集」を選ぶと編集の操作を呼ぶ', async () => {
    const { onEdit, onDelete } = await renderMenu({ viewerIsAuthor: true });
    focusTrigger();

    await userEvent.keyboard('{Enter}');
    await expect.poll(() => document.activeElement?.textContent).toBe('編集');
    await userEvent.keyboard('{Enter}');

    expect(onEdit).toHaveBeenCalledOnce();
    expect(onDelete).not.toHaveBeenCalled();
    await expect.element(page.getByRole('menu')).not.toBeInTheDocument();
  });

  test('「削除」を選ぶと確認のダイアログを開くだけで削除せず、「キャンセル」で閉じるとボタンへフォーカスが戻る', async () => {
    const { onDelete } = await renderMenu({ viewerIsAuthor: true });
    focusTrigger();

    await userEvent.keyboard('{Enter}');
    await pressKeyUntilFocusMoves('ArrowDown');
    await userEvent.keyboard('{Enter}');

    await expect.element(deleteDialog()).toBeVisible();
    expect(onDelete).not.toHaveBeenCalled();

    await userEvent.click(
      deleteDialog().getByRole('button', { name: 'キャンセル' }),
    );

    await expect.element(deleteDialog()).not.toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
    await expect.poll(() => document.activeElement).toBe(trigger().element());
  });

  test('確認のダイアログの「削除」で確定するとトークンを渡して削除の操作を呼ぶ', async () => {
    const { onDelete } = await renderMenu({ viewerIsAuthor: true });
    await userEvent.click(trigger());
    await userEvent.click(page.getByRole('menuitem', { name: '削除' }));
    const confirm = deleteDialog().getByRole('button', {
      name: '削除',
      exact: true,
    });
    await expect.element(confirm).toBeDisabled();

    passBotCheck();
    await expect.element(confirm).toBeEnabled();
    await userEvent.click(confirm);

    await expect.element(deleteDialog()).not.toBeInTheDocument();
    expect(onDelete).toHaveBeenCalledExactlyOnceWith('turnstile-token-1');
  });

  test.each(COLOR_SCHEMES)(
    '%sの配色で、閉じたメニュー・開いたメニュー・削除の確認のダイアログのaxeの違反が0件である',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderMenu({ viewerIsAuthor: true });

      expect(
        await runAxe(page.getByRole('main').element() as HTMLElement),
      ).toStrictEqual([]);

      await userEvent.click(trigger());
      const menus = page.getByRole('menu');
      await expect.element(menus).toBeVisible();
      expect(menus.elements().length).toBeGreaterThan(0);
      for (const menu of menus.elements()) {
        expect(await runAxe(menu)).toStrictEqual([]);
      }

      await userEvent.click(page.getByRole('menuitem', { name: '削除' }));
      await expect.element(deleteDialog()).toBeVisible();
      passBotCheck();
      await expect
        .element(
          deleteDialog().getByRole('button', { name: '削除', exact: true }),
        )
        .toBeEnabled();

      expect(await runAxe(deleteDialog().element())).toStrictEqual([]);
    },
  );

  test.each(COLOR_SCHEMES)(
    '%sの配色で、他者のコメントの開いたメニューと登録された操作のダイアログのaxeの違反が0件である',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderMenu({ actions: [actionOf('a.report', 10, '通報')] });

      await userEvent.click(trigger());
      await expect.element(page.getByRole('menu')).toBeVisible();
      expect(await runAxe(page.getByRole('menu').element())).toStrictEqual([]);

      await userEvent.click(page.getByRole('menuitem'));
      const dialog = page.getByRole('dialog', { name: '通報のダイアログ' });
      await expect.element(dialog).toBeVisible();

      expect(await runAxe(dialog.element())).toStrictEqual([]);
    },
  );
});
