import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { Toaster } from '../../../lib/components/feedback/toaster.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import {
  GraphQLClientError,
  type GraphQLResult,
} from '../../../lib/utilities/graphql/graphql-result.ts';
import {
  GUEST_VIEWER_QUERY,
  renderInRouter,
} from '../../../test/page-router.tsx';
import {
  signedInViewerQuery,
  viewerResult,
} from '../../../test/viewer-fixtures.ts';
import {
  ClientEngagementResendVerificationEmailDocument,
  type ClientEngagementResendVerificationEmailMutation,
  ClientViewerDocument,
  type ClientViewerQuery,
} from '../../graphql/generated/graphql.ts';
import { useViewer } from '../auth/use-viewer.ts';
import { CommentGate, type CommentGateProps } from './comment-gate.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const CURRENT_PATH = '/p/pitch_board?tab=launches';

const GUEST_NOTICE = 'ログインすると、コメントや返信を投稿できます。';

const UNVERIFIED_NOTICE =
  'この操作にはメールアドレスの確認が必要です。確認メールをご確認ください。';

const RESENT = '確認メールを再送しました。';

const ALREADY_VERIFIED = 'メールアドレスは確認済みです。';

const RATE_LIMITED = new GraphQLClientError({
  code: 'rate_limit_exceeded',
  message: '操作が集中しています。しばらく待ってから再度お試しください。',
  status: 429,
  retryAfterSeconds: 60,
});

const UNVERIFIED = signedInViewerQuery({ emailVerified: false });

// 詳細ページではコメント欄の外の部品がログイン中の利用者を読んでいるため、テストでも読む部品を置いて取得し直しを観測する
function ViewerReader() {
  useViewer();
  return null;
}

const resendButton = () =>
  page.getByRole('button', { name: '確認メールを再送' });

const renderGate = (
  kind: CommentGateProps['kind'],
  cachedViewer: ClientViewerQuery = kind === 'guest'
    ? GUEST_VIEWER_QUERY
    : UNVERIFIED,
) =>
  renderInRouter(
    <>
      <ViewerReader />
      <CommentGate kind={kind} />
      <Toaster />
    </>,
    { path: CURRENT_PATH, cachedViewer },
  );

function respondToResend(
  resend: () => GraphQLResult<ClientEngagementResendVerificationEmailMutation>,
  viewerAfterResend: ClientViewerQuery = UNVERIFIED,
): void {
  executeGraphQL.mockImplementation((document: unknown) => {
    if (document === ClientEngagementResendVerificationEmailDocument) {
      return Promise.resolve(resend());
    }
    if (document === ClientViewerDocument) {
      return Promise.resolve(viewerResult(viewerAfterResend));
    }
    throw new Error('想定していない操作が実行されました。');
  });
}

beforeEach(() => {
  executeGraphQL.mockReset();
});

afterEach(() => {
  toast.dismiss();
  applyColorScheme('light');
});

describe('CommentGate', () => {
  test('未ログインの閲覧者には、投稿欄の代わりにログインの案内と、現在のページへ戻るログインへの導線を示す', async () => {
    await renderGate('guest');

    await expect.element(page.getByText(GUEST_NOTICE)).toBeVisible();
    await expect
      .element(page.getByRole('link', { name: 'ログインしてコメント' }))
      .toHaveAttribute(
        'href',
        `/auth/login?redirect=${encodeURIComponent(CURRENT_PATH)}`,
      );
    await expect.element(resendButton()).not.toBeInTheDocument();
  });

  test('メールアドレス未確認の利用者には、確認が必要な旨と「確認メールを再送」を示し、ログインの導線を置かない', async () => {
    await renderGate('unverified');

    await expect.element(page.getByText(UNVERIFIED_NOTICE)).toBeVisible();
    await expect.element(resendButton()).toBeVisible();
    await expect
      .element(page.getByRole('link', { name: 'ログインしてコメント' }))
      .not.toBeInTheDocument();
  });

  test('「確認メールを再送」でコメント欄の再送の操作を送り、成功をトーストで示す', async () => {
    respondToResend(() => ({
      ok: true,
      data: { resendVerificationEmail: 'SENT' },
    }));
    await renderGate('unverified');

    await userEvent.click(resendButton());

    await expect.element(page.getByText(RESENT)).toBeVisible();
    expect(executeGraphQL).toHaveBeenCalledWith(
      ClientEngagementResendVerificationEmailDocument,
      {},
      {},
    );
  });

  test('送信回数の上限(429)では、文言規則の文言をトーストで示し、再送の操作を押せる状態へ戻す', async () => {
    respondToResend(() => ({ ok: false, error: RATE_LIMITED }));
    await renderGate('unverified');

    await userEvent.click(resendButton());

    await expect.element(page.getByText(RATE_LIMITED.message)).toBeVisible();
    expect(page.getByText(RESENT).elements()).toHaveLength(0);
    await expect.element(resendButton()).not.toHaveAttribute('aria-disabled');
  });

  test('既に確認済みだったら、その旨をトーストで示し、ログイン中の利用者を取得し直す', async () => {
    respondToResend(
      () => ({
        ok: true,
        data: { resendVerificationEmail: 'ALREADY_VERIFIED' },
      }),
      signedInViewerQuery({ emailVerified: true }),
    );
    await renderGate('unverified');

    await userEvent.click(resendButton());

    await expect.element(page.getByText(ALREADY_VERIFIED)).toBeVisible();
    await vi.waitFor(() => {
      expect(executeGraphQL).toHaveBeenCalledWith(
        ClientViewerDocument,
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test.each<CommentGateProps['kind']>(['guest', 'unverified'])(
      '%sの案内で、アクセシビリティの検査の違反が0件',
      async (kind) => {
        applyColorScheme(scheme);
        await renderGate(kind);
        await expect
          .element(
            page.getByText(kind === 'guest' ? GUEST_NOTICE : UNVERIFIED_NOTICE),
          )
          .toBeVisible();

        expect(await runAxe(document.body)).toStrictEqual([]);
      },
    );
  });
});
