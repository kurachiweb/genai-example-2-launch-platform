import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { resetTurnstileScriptFailure } from '../../../lib/components/bot-protection/turnstile-script-failure.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { resetFakeTurnstile } from '../../../lib/test/fake-turnstile.tsx';
import { renderInRouter } from '../../../test/page-router.tsx';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import { COMMENT_ACTIONS } from '../../composition/comment-actions.ts';
import type { ClientViewerQuery } from '../../graphql/generated/graphql.ts';
import type { CommentActionContext } from '../engagement/comment-action-types.ts';
import { CommentMenu } from '../engagement/comment-menu.tsx';
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

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../../../lib/test/fake-turnstile.tsx'),
);

const COMMENT_ID = '01JC0COMMENT00000000000000';

const TITLE = 'このコメントを通報';

const GUEST: ClientViewerQuery = { viewer: null };

const CONTEXT: CommentActionContext = Object.freeze({
  comment: { id: COMMENT_ID, authorNickname: 'ピッチの作り手' },
  product: { id: '01JC0PRODUCT00000000000000', handle: 'pitch_notes' },
  launch: { id: '01JC0LAUNCH000000000000000' },
});

// 登録の一覧を渡すコメントのメニューを、他者のコメントとして描く
const renderMenu = async ({
  signedIn = false,
  viewerIsAuthor = false,
}: {
  readonly signedIn?: boolean;
  readonly viewerIsAuthor?: boolean;
} = {}) => {
  await renderInRouter(
    <main className="bg-background p-4 text-foreground">
      <CommentMenu
        context={CONTEXT}
        viewerIsAuthor={viewerIsAuthor}
        actions={COMMENT_ACTIONS}
        onEdit={() => undefined}
        onDelete={() => Promise.resolve()}
      />
    </main>,
    { cachedViewer: signedIn ? signedInViewerQuery() : GUEST },
  );
};

const trigger = () => page.getByRole('button', { name: 'コメントの操作' });

const reportItem = () => page.getByRole('menuitem', { name: '通報' });

const openReportFromMenu = async () => {
  await userEvent.click(trigger());
  await userEvent.click(reportItem());
  await expect.element(page.getByRole('dialog', { name: TITLE })).toBeVisible();
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

describe('他者のコメントの「通報」', () => {
  test.each([
    ['未ログイン', false],
    ['ログイン中', true],
  ])(
    '%sの閲覧者には、他者のコメントの「…」メニューに「通報」を示す',
    async (_name, signedIn) => {
      respondWith();
      await renderMenu({ signedIn });

      await userEvent.click(trigger());

      await expect.element(reportItem()).toBeVisible();
    },
  );

  test('自身のコメントのメニューには「通報」を示さない', async () => {
    respondWith();
    await renderMenu({ signedIn: true, viewerIsAuthor: true });

    await userEvent.click(trigger());

    await expect
      .element(page.getByRole('menuitem', { name: '編集' }))
      .toBeVisible();
    expect(reportItem().query()).toBeNull();
  });

  test('選ぶとメニューを閉じて題「このコメントを通報」のダイアログを開いたまま残し、コメントのIDを対象として送る', async () => {
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
      input: { targetKind: 'COMMENT', targetRef: COMMENT_ID },
    });
  });

  test('メニューから開いたダイアログを閉じると「…」のボタンへフォーカスが戻る', async () => {
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
