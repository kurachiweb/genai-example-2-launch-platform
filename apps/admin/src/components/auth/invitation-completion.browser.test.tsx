import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import {
  adminViewerResult,
  GUEST_ADMIN_QUERY,
} from '../../../test/admin-viewer-fixtures.ts';
import {
  createPageRouterContext,
  renderInRouter,
} from '../../../test/page-router.tsx';
import { adminViewerQueryOptions } from '../../graphql/admin-viewer.ts';
import {
  AdminCompleteInvitationDocument,
  AdminStartInvitationDocument,
  AdminViewerDocument,
} from '../../graphql/generated/graphql.ts';
import { InvitationCompletion } from './invitation-completion.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const TOKEN = ['invitation', 'link', 'value'].join('_');
const NICKNAME = '運営の担当';
const PASSWORD = ['console', 'gate', 'keeper'].join('-');
const TOTP_SECRET = ['JBSW', 'Y3DP', 'EHPK', '3PXP'].join('');
const OTPAUTH_URI = `otpauth://totp/Admin:${encodeURIComponent(NICKNAME)}?secret=${TOTP_SECRET}&issuer=Admin`;
const RECOVERY_CODES = Object.freeze([
  'abcd-efgh-ijkl',
  'mnop-qrst-uvwx',
  'yzab-cdef-ghij',
]);
const INVALID_LINK_MESSAGE = 'このリンクは無効か、有効期限が切れています。';
const RESEND_REQUEST_MESSAGE = '招待した管理者に再送を依頼してください。';
const TOTP_SETUP_EXPIRED_MESSAGE =
  '設定の有効期限が切れました。最初からやり直してください。';
const COMPLETED_MESSAGE = '管理者アカウントの設定が完了しました。';
const PATH = '/auth/invitation';
const DISPLAY = Object.freeze({ timeZone: 'Asia/Tokyo', locale: 'ja-JP' });

const profileForm = () =>
  page.getByRole('form', { name: 'ニックネームとパスワードの設定' });
const nicknameInput = () =>
  page.getByRole('textbox', { name: 'ニックネーム(必須)' });
const passwordInput = () =>
  page.getByLabelText('パスワード(必須)', { exact: true });
const profileButton = () =>
  page.getByRole('button', { name: '多要素認証の設定へ進む' });
const totpHeading = () =>
  page.getByRole('heading', { level: 2, name: '多要素認証の設定' });
const totpInput = () => page.getByRole('textbox', { name: '認証コード(必須)' });
const completeButton = () =>
  page.getByRole('button', { name: '設定を完了する' });
const qrCode = () =>
  page.getByRole('img', { name: '認証アプリで読み取るQRコード' });

const START_RESULT = Object.freeze({
  ok: true,
  data: {
    startAdminInvitation: {
      otpauthUri: OTPAUTH_URI,
      secret: TOTP_SECRET,
      expiresAt: '2026-11-04T07:10:00.000Z',
    },
  },
});

const COMPLETE_RESULT = Object.freeze({
  ok: true,
  data: { completeAdminInvitation: { codes: RECOVERY_CODES } },
});

interface Responses {
  readonly start?: () => Promise<unknown>;
  readonly complete?: () => Promise<unknown>;
}

function respond({
  start = () => Promise.resolve(START_RESULT),
  complete = () => Promise.resolve(COMPLETE_RESULT),
}: Responses = {}): void {
  executeGraphQL.mockImplementation((document: unknown) => {
    if (document === AdminStartInvitationDocument) {
      return start();
    }
    if (document === AdminCompleteInvitationDocument) {
      return complete();
    }
    if (document === AdminViewerDocument) {
      return Promise.resolve(adminViewerResult(GUEST_ADMIN_QUERY));
    }
    throw new Error('想定していない操作が実行されました。');
  });
}

const failure = (init: ConstructorParameters<typeof GraphQLClientError>[0]) =>
  Promise.resolve({ ok: false, error: new GraphQLClientError(init) });

const invitationLinkFailure = () =>
  failure({
    code: 'invalid_link',
    message: `${INVALID_LINK_MESSAGE}${RESEND_REQUEST_MESSAGE}`,
    status: 422,
  });

async function renderAt(hash: string) {
  const context = createPageRouterContext('local');
  const router = await renderInRouter(
    <DisplayPreferencesProvider initial={DISPLAY}>
      <InvitationCompletion />
    </DisplayPreferencesProvider>,
    {
      path: `${PATH}${hash}`,
      context,
    },
  );
  return { router, context };
}

async function submitProfile(nickname = NICKNAME): Promise<void> {
  await userEvent.type(nicknameInput(), nickname);
  await userEvent.type(passwordInput(), PASSWORD);
  await userEvent.click(profileButton());
}

async function submitTotpCode(): Promise<void> {
  await userEvent.type(totpInput(), '123456');
  await userEvent.click(completeButton());
}

const expectInvalidLink = async (): Promise<void> => {
  await expect
    .element(page.getByRole('alert'))
    .toHaveTextContent(`${INVALID_LINK_MESSAGE}${RESEND_REQUEST_MESSAGE}`);
  await expect.element(page.getByRole('alert')).toHaveFocus();
  expect(profileForm().elements()).toHaveLength(0);
  expect(totpInput().elements()).toHaveLength(0);
};

beforeEach(() => {
  executeGraphQL.mockReset();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('InvitationCompletion', () => {
  test('フラグメントからトークンを読んでフラグメントを消し、開いただけでは送信しない', async () => {
    const { router } = await renderAt(`#token=${TOKEN}`);

    await expect.element(nicknameInput()).toBeVisible();
    await expect.element(passwordInput()).toBeVisible();
    await expect.poll(() => router.history.location.hash).toBe('');
    expect(executeGraphQL).not.toHaveBeenCalled();
  });

  test('ニックネームとパスワードは、フォーカスを外した時にAPIと同じ文言で検証して入力欄に示す', async () => {
    await renderAt(`#token=${TOKEN}`);

    await userEvent.type(nicknameInput(), 'あ'.repeat(26));
    await userEvent.type(passwordInput(), 'short');
    await userEvent.tab();

    await expect
      .element(nicknameInput())
      .toHaveAccessibleDescription(
        '25文字以内で設定してください。 ニックネームは25文字以内で入力してください。',
      );
    await expect
      .element(passwordInput())
      .toHaveAccessibleDescription(
        '8文字以上128文字以内で設定してください。 パスワードは8文字以上128文字以内で入力してください。',
      );
    await expect
      .element(passwordInput())
      .toHaveAttribute('autocomplete', 'new-password');
    await expect.element(profileButton()).toBeDisabled();
    expect(executeGraphQL).not.toHaveBeenCalled();
  });

  test('トークンをスキーマの入力に含めず送信の時に足して送り、QRコードと手入力用の文字列と有効期限を示す', async () => {
    respond();
    const { context } = await renderAt(`#token=${TOKEN}`);

    await submitProfile(` ${NICKNAME}\u3000`);

    await expect.element(totpHeading()).toHaveFocus();
    await expect.element(qrCode()).toBeVisible();
    await expect.element(page.getByText(TOTP_SECRET)).toBeVisible();
    const expiry = page.getByText(/^この設定は.+まで有効です。/);
    await expect.element(expiry).toBeVisible();
    expect(expiry.element().querySelector('time')?.dateTime).toBe(
      '2026-11-04T07:10:00.000Z',
    );
    expect(executeGraphQL).toHaveBeenCalledWith(
      AdminStartInvitationDocument,
      { token: TOKEN, nickname: NICKNAME, password: PASSWORD },
      { turnstileToken: undefined },
    );
    expect(profileForm().elements()).toHaveLength(0);
    await expect
      .poll(() => context.queryClient.getMutationCache().getAll())
      .toHaveLength(0);
  });

  test('認証コードとトークンで招待を完了し、リカバリコードと保管の注意とダッシュボードへの導線を示す', async () => {
    respond();
    const { context } = await renderAt(`#token=${TOKEN}`);
    await submitProfile();

    await submitTotpCode();

    await expect
      .element(page.getByRole('status').filter({ hasText: COMPLETED_MESSAGE }))
      .toHaveFocus();
    expect(executeGraphQL).toHaveBeenCalledWith(
      AdminCompleteInvitationDocument,
      { token: TOKEN, totpCode: '123456' },
      { turnstileToken: undefined },
    );
    const codes = page.getByRole('list', { name: 'リカバリコード' });
    await expect.element(codes).toHaveTextContent(RECOVERY_CODES.join(''));
    await expect
      .element(page.getByText(/認証アプリとリカバリコードの両方を失うと/))
      .toBeVisible();
    await expect
      .element(page.getByRole('link', { name: 'ダッシュボードへ進む' }))
      .toHaveAttribute('href', '/');
    expect(page.getByText(TOTP_SECRET).elements()).toHaveLength(0);
    expect(qrCode().elements()).toHaveLength(0);
    await expect
      .poll(() => context.queryClient.getMutationCache().getAll())
      .toHaveLength(0);
    expect(
      context.queryClient.getQueryState(adminViewerQueryOptions().queryKey)
        ?.isInvalidated,
    ).toBe(true);
  });

  test('パスワードへのサーバーの拒否を入力欄に示す', async () => {
    const matches =
      'ニックネーム・メールアドレス(@より前の部分を含む)と同じパスワードは使えません。';
    respond({
      start: () =>
        failure({
          code: 'password_rejected',
          message: matches,
          status: 422,
          details: [
            { field: 'password', code: 'matches_identity', message: matches },
          ],
        }),
    });
    await renderAt(`#token=${TOKEN}`);

    await submitProfile();

    await expect
      .element(passwordInput())
      .toHaveAccessibleDescription(
        `8文字以上128文字以内で設定してください。 ${matches}`,
      );
    await expect.element(passwordInput()).toHaveFocus();
  });

  test('リンクと関係の無い設定の開始の失敗は、フォームの文言で示して入力を続けられる', async () => {
    const unavailable = '通信に失敗しました。時間をおいて再度お試しください。';
    respond({
      start: () =>
        failure({ code: 'network_error', message: unavailable, status: 0 }),
    });
    await renderAt(`#token=${TOKEN}`);

    await submitProfile();

    await expect
      .element(profileForm().getByRole('alert'))
      .toHaveTextContent(unavailable);
    await expect.element(profileButton()).toBeEnabled();
  });

  test('設定の開始で無効なリンクなら、フォームに代えて無効の文言と再送の依頼の案内を示す', async () => {
    respond({ start: invitationLinkFailure });
    await renderAt(`#token=${TOKEN}`);

    await submitProfile();

    await expectInvalidLink();
  });

  test('トークンへの入力の不正も、無効なリンクとして示す', async () => {
    respond({
      start: () =>
        failure({
          code: 'validation_error',
          message: '入力内容を確認してください。',
          status: 400,
          details: [
            {
              field: 'token',
              code: 'too_big',
              message: `${INVALID_LINK_MESSAGE}${RESEND_REQUEST_MESSAGE}`,
            },
          ],
        }),
    });
    await renderAt(`#token=${'a'.repeat(257)}`);

    await submitProfile();

    await expectInvalidLink();
  });

  test('誤った認証コードの拒否を認証コードの欄に示す', async () => {
    const incorrect = '認証コードが正しくありません。';
    respond({
      complete: () =>
        failure({
          code: 'invalid_second_factor',
          message: incorrect,
          status: 401,
        }),
    });
    await renderAt(`#token=${TOKEN}`);
    await submitProfile();

    await submitTotpCode();

    await expect
      .element(totpInput())
      .toHaveAccessibleDescription(
        `認証アプリに表示されている6桁の認証コードを入力してください。 ${incorrect}`,
      );
    await expect.element(totpInput()).toHaveFocus();
    await expect.element(qrCode()).toBeVisible();
  });

  test('設定の有効期限が切れたら、ニックネームとパスワードの入力からやり直させる', async () => {
    respond({
      complete: () =>
        failure({
          code: 'totp_setup_expired',
          message: TOTP_SETUP_EXPIRED_MESSAGE,
          status: 422,
        }),
    });
    await renderAt(`#token=${TOKEN}`);
    await submitProfile();

    await submitTotpCode();

    await expect
      .element(profileForm().getByRole('alert'))
      .toHaveTextContent(TOTP_SETUP_EXPIRED_MESSAGE);
    await expect.element(nicknameInput()).toHaveFocus();
    expect(qrCode().elements()).toHaveLength(0);
  });

  test('完了で無効なリンクなら、無効の文言と再送の依頼の案内を示す', async () => {
    respond({ complete: invitationLinkFailure });
    await renderAt(`#token=${TOKEN}`);
    await submitProfile();

    await submitTotpCode();

    await expectInvalidLink();
    expect(qrCode().elements()).toHaveLength(0);
  });

  test('リンクと関係の無い完了の失敗は、フォームの文言で示して入力を続けられる', async () => {
    const unavailable = '通信に失敗しました。時間をおいて再度お試しください。';
    respond({
      complete: () =>
        failure({ code: 'network_error', message: unavailable, status: 0 }),
    });
    await renderAt(`#token=${TOKEN}`);
    await submitProfile();

    await submitTotpCode();

    await expect
      .element(page.getByRole('form', { name: '認証コードの入力' }))
      .toHaveTextContent(unavailable);
    await expect.element(completeButton()).toBeEnabled();
  });

  test('フラグメントにトークンが無ければ、フォームを描かずに無効なリンクとして示す', async () => {
    await renderAt('');

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(`${INVALID_LINK_MESSAGE}${RESEND_REQUEST_MESSAGE}`);
    expect(profileForm().elements()).toHaveLength(0);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('入力・多要素認証の設定・完了の段階で、アクセシビリティの検査の違反が0件', async () => {
      respond();
      await renderAt(`#token=${TOKEN}`);
      await expect.element(nicknameInput()).toBeVisible();
      const profile = await runAxe(document.body);

      await submitProfile();
      await expect.element(qrCode()).toBeVisible();
      const totp = await runAxe(document.body);

      await submitTotpCode();
      await expect
        .element(page.getByRole('link', { name: 'ダッシュボードへ進む' }))
        .toBeVisible();

      expect(profile).toStrictEqual([]);
      expect(totp).toStrictEqual([]);
      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
