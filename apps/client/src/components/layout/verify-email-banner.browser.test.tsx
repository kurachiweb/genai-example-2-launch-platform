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
import { renderInRouter } from '../../../test/page-router.tsx';
import {
  signedInViewerQuery,
  viewerResult,
} from '../../../test/viewer-fixtures.ts';
import {
  ClientResendVerificationEmailDocument,
  type ClientResendVerificationEmailMutation,
  ClientViewerDocument,
  type ClientViewerQuery,
} from '../../graphql/generated/graphql.ts';
import { VerifyEmailBanner } from './verify-email-banner.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const BANNER_TEXT =
  'メールアドレスの確認が完了していません。評価・コメント・フォロー・Upvoteには確認が必要です。';
const RESENT = '確認メールを再送しました。';
const ALREADY_VERIFIED = 'メールアドレスは確認済みです。';

const RATE_LIMITED = new GraphQLClientError({
  code: 'rate_limit_exceeded',
  message: '操作が集中しています。しばらく待ってから再度お試しください。',
  status: 429,
  retryAfterSeconds: 60,
});

const UNVERIFIED = signedInViewerQuery({ emailVerified: false });

const resendButton = () =>
  page.getByRole('button', { name: '確認メールを再送' });

const renderBanner = (cachedViewer: ClientViewerQuery) =>
  renderInRouter(
    <>
      <VerifyEmailBanner />
      <Toaster />
    </>,
    { cachedViewer },
  );

function respondToResend(
  resend: () => GraphQLResult<ClientResendVerificationEmailMutation>,
  viewerAfterResend: ClientViewerQuery = UNVERIFIED,
): void {
  executeGraphQL.mockImplementation((document: unknown) => {
    if (document === ClientResendVerificationEmailDocument) {
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

describe('VerifyEmailBanner', () => {
  test.each<[string, ClientViewerQuery]>([
    ['未ログイン', { viewer: null }],
    ['確認済み', signedInViewerQuery({ emailVerified: true })],
  ])('%sでは何も描かない', async (_name, cachedViewer) => {
    await renderBanner(cachedViewer);

    await expect.element(page.getByText(BANNER_TEXT)).not.toBeInTheDocument();
    await expect.element(resendButton()).not.toBeInTheDocument();
  });

  test('ログイン中で未確認なら、確認が必要な操作の案内と再送の操作を状態の通知として表示する', async () => {
    await renderBanner(UNVERIFIED);

    const status = page.getByRole('status');
    await expect.element(status.getByText(BANNER_TEXT)).toBeVisible();
    await expect
      .element(status.getByRole('button', { name: '確認メールを再送' }))
      .toBeVisible();
  });

  test('「確認メールを再送」で確認メールを送り直し、成功をトーストで示す', async () => {
    respondToResend(() => ({
      ok: true,
      data: { resendVerificationEmail: 'SENT' },
    }));
    await renderBanner(UNVERIFIED);

    await userEvent.click(resendButton());

    await expect.element(page.getByText(RESENT)).toBeVisible();
    expect(executeGraphQL).toHaveBeenCalledWith(
      ClientResendVerificationEmailDocument,
      {},
      {},
    );
    await expect.element(page.getByText(BANNER_TEXT)).toBeVisible();
  });

  test('送信回数の上限(429)では、文言規則の文言をトーストで示す', async () => {
    respondToResend(() => ({ ok: false, error: RATE_LIMITED }));
    await renderBanner(UNVERIFIED);

    await userEvent.click(resendButton());

    await expect.element(page.getByText(RATE_LIMITED.message)).toBeVisible();
    expect(page.getByText(RESENT).elements()).toHaveLength(0);
    await expect.element(resendButton()).not.toHaveAttribute('aria-disabled');
  });

  test('既に確認済みだったら、その旨をトーストで示し、取得し直した利用者で帯を消す', async () => {
    respondToResend(
      () => ({
        ok: true,
        data: { resendVerificationEmail: 'ALREADY_VERIFIED' },
      }),
      signedInViewerQuery({ emailVerified: true }),
    );
    await renderBanner(UNVERIFIED);

    await userEvent.click(resendButton());

    await expect.element(page.getByText(ALREADY_VERIFIED)).toBeVisible();
    await expect.element(page.getByText(BANNER_TEXT)).not.toBeInTheDocument();
  });

  test('送信中は再送の操作を無効にして処理中を伝え、重ねて送らない', async () => {
    const pending =
      Promise.withResolvers<
        GraphQLResult<ClientResendVerificationEmailMutation>
      >();
    executeGraphQL.mockReturnValue(pending.promise);
    await renderBanner(UNVERIFIED);

    await userEvent.click(resendButton());
    await expect.element(resendButton()).toHaveAttribute('aria-busy', 'true');
    await expect
      .element(resendButton())
      .toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(resendButton(), { force: true });

    expect(executeGraphQL).toHaveBeenCalledTimes(1);
    pending.resolve({ ok: true, data: { resendVerificationEmail: 'SENT' } });
    await expect.element(page.getByText(RESENT)).toBeVisible();
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('アクセシビリティの検査の違反が0件', async () => {
      await renderBanner(UNVERIFIED);
      await expect.element(page.getByText(BANNER_TEXT)).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
