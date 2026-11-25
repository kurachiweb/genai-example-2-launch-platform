import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { resetTurnstileScriptFailure } from '../../../lib/components/bot-protection/turnstile-script-failure.ts';
import { DropdownMenu } from '../../../lib/components/ui/dropdown-menu/dropdown-menu.tsx';
import { DropdownMenuContent } from '../../../lib/components/ui/dropdown-menu/dropdown-menu-content.tsx';
import { DropdownMenuTrigger } from '../../../lib/components/ui/dropdown-menu/dropdown-menu-trigger.tsx';
import { TooltipProvider } from '../../../lib/components/ui/tooltip/tooltip-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { resetFakeTurnstile } from '../../../lib/test/fake-turnstile.tsx';
import { renderInRouter } from '../../../test/page-router.tsx';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import { PUBLIC_PROFILE_MENU_ITEMS } from '../../composition/public-profile-sections.ts';
import type { ClientViewerQuery } from '../../graphql/generated/graphql.ts';
import { ProfileActionsMenu } from '../profile/profile-actions-menu.tsx';
import type { PublicProfileSectionContext } from '../profile/public-profile-section-types.ts';
import {
  acceptedResult,
  cancelButton,
  dialog,
  fillValidReport,
  passBotCheck,
  radio,
  respondWith,
  submitButton,
  submitCalls,
} from './report-dialog-testing.tsx';
import { UserReportMenuItem } from './user-report-menu-item.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../../../lib/test/fake-turnstile.tsx'),
);

const HANDLE = 'maker_ai';

const LABEL = 'このユーザーを通報';

const GUEST: ClientViewerQuery = { viewer: null };

const contextOf = (isOwner: boolean): PublicProfileSectionContext => ({
  handle: HANDLE,
  nickname: 'AIの作り手',
  isOwner,
  suspended: false,
});

// 登録の一覧を渡す公開プロフィールの「…」メニューを描く
const renderMenu = async ({
  signedIn = false,
  isOwner = false,
}: { readonly signedIn?: boolean; readonly isOwner?: boolean } = {}) => {
  await renderInRouter(
    <TooltipProvider>
      <main className="bg-background p-4 text-foreground">
        <ProfileActionsMenu
          context={contextOf(isOwner)}
          items={PUBLIC_PROFILE_MENU_ITEMS}
        />
      </main>
    </TooltipProvider>,
    { cachedViewer: signedIn ? signedInViewerQuery() : GUEST },
  );
};

const trigger = () => page.getByRole('button', { name: 'その他の操作' });

const reportItem = () => page.getByRole('menuitem', { name: LABEL });

const openReportFromMenu = async () => {
  await userEvent.click(trigger());
  await userEvent.click(reportItem());
  await expect.element(page.getByRole('dialog', { name: LABEL })).toBeVisible();
};

beforeEach(() => {
  executeGraphQL.mockReset();
  resetFakeTurnstile();
  resetTurnstileScriptFailure();
});

afterEach(() => {
  toast.dismiss();
  applyColorScheme('light');
});

describe('公開プロフィールの「このユーザーを通報」', () => {
  test.each([
    ['未ログイン', false],
    ['ログイン中の本人以外', true],
  ])(
    '%sの閲覧者には、「…」メニューに「このユーザーを通報」を示す',
    async (_name, signedIn) => {
      respondWith();
      await renderMenu({ signedIn });

      await userEvent.click(trigger());

      await expect.element(reportItem()).toBeVisible();
    },
  );

  test('項目は、本人の文脈ではメニューの中にも何も描かない', async () => {
    await renderInRouter(
      <main className="bg-background p-4 text-foreground">
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>メニュー</DropdownMenuTrigger>
          <DropdownMenuContent>
            <UserReportMenuItem
              {...contextOf(true)}
              onSelect={() => undefined}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </main>,
      { cachedViewer: signedInViewerQuery({ handle: HANDLE }) },
    );

    await expect.element(page.getByRole('menu')).toBeVisible();
    expect(page.getByRole('menuitem').query()).toBeNull();
  });

  test('選ぶとメニューを閉じて題「このユーザーを通報」のダイアログを開いたまま残し、ハンドルを対象として送る', async () => {
    respondWith(acceptedResult);
    await renderMenu();

    await openReportFromMenu();

    await expect.element(page.getByRole('menu')).not.toBeInTheDocument();
    await expect.element(radio('スパム')).toBeVisible();
    passBotCheck();
    await fillValidReport();
    await userEvent.click(submitButton());

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(submitCalls()).toHaveLength(1);
    expect(submitCalls()[0]?.[1]).toMatchObject({
      input: { targetKind: 'USER', targetRef: HANDLE },
    });
  });

  test('メニューから開いたダイアログを閉じると「その他の操作」のボタンへフォーカスが戻る', async () => {
    respondWith();
    await renderMenu();
    await openReportFromMenu();
    await expect.element(radio('スパム')).toBeVisible();

    await userEvent.click(cancelButton());

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(trigger()).toHaveFocus();
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('開いたメニューとダイアログで、アクセシビリティの検査の違反が0件', async () => {
      respondWith();
      await renderMenu();
      await userEvent.click(trigger());
      await expect.element(reportItem()).toBeVisible();
      const menu = await runAxe(page.getByRole('menu').element());

      await userEvent.click(reportItem());
      await expect.element(radio('スパム')).toBeVisible();

      expect(menu).toStrictEqual([]);
      expect(await runAxe(dialog().element())).toStrictEqual([]);
    });
  });
});
