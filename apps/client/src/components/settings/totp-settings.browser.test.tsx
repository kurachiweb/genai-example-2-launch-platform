import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import {
  mySessionsResult,
  RECOVERY_CODES,
  renderSecurityPage,
  TOTP_SECRET,
  TOTP_SETUP,
} from '../../../test/security-fixtures.tsx';
import {
  CURRENT_PASSWORD,
  CURRENT_PASSWORD_INCORRECT,
  graphqlFailure,
  reauthenticationFailed,
  SECOND_FACTOR_INCORRECT,
} from '../../../test/settings-fixtures.ts';
import {
  signedInViewerQuery,
  viewerResult,
} from '../../../test/viewer-fixtures.ts';
import {
  ClientDisableTotpDocument,
  ClientEnableTotpDocument,
  ClientMySessionsDocument,
  ClientRegenerateRecoveryCodesDocument,
  ClientStartTotpSetupDocument,
  ClientViewerDocument,
} from '../../graphql/generated/graphql.ts';
import { viewerQueryOptions } from '../../graphql/viewer.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const TOTP_CODE_DESCRIPTION =
  '認証アプリに表示されている6桁の認証コードを入力してください。';

const totpRegion = () => page.getByRole('region', { name: '多要素認証' });
const recoveryRegion = () =>
  page.getByRole('region', { name: 'リカバリコード' });
const totpStatus = () =>
  totpRegion().getByText(/^多要素認証は(有効|無効)です。$/);
const startPassword = () =>
  totpRegion().getByLabelText('現在のパスワード(必須)', { exact: true });
const startButton = () =>
  totpRegion().getByRole('button', { name: '設定を始める' });
const setupDialog = () =>
  page.getByRole('dialog', { name: '多要素認証の設定' });
const setupCode = () =>
  setupDialog().getByRole('textbox', { name: '認証コード(必須)' });
const enableButton = () =>
  setupDialog().getByRole('button', { name: '有効にする' });
const disableForm = () =>
  page.getByRole('form', { name: '多要素認証の無効化' });
const regenerateForm = () =>
  page.getByRole('form', { name: 'リカバリコードの再発行' });
const codesDialog = () =>
  page.getByRole('dialog', { name: '新しいリカバリコード' });

type Handler = (variables: unknown) => Promise<unknown>;

const ok = (data: unknown) => () => Promise.resolve({ ok: true, data });

function respond(handlers: ReadonlyMap<unknown, Handler>): void {
  executeGraphQL.mockImplementation((document: unknown, variables: unknown) => {
    const handler = handlers.get(document);
    if (handler === undefined) {
      throw new Error('想定していない操作が実行されました。');
    }
    return handler(variables);
  });
}

const refetchedAs = (totpEnabled: boolean, remainingRecoveryCodes?: number) =>
  new Map<unknown, Handler>([
    [
      ClientMySessionsDocument,
      () =>
        Promise.resolve(
          mySessionsResult({
            totpEnabled,
            ...(remainingRecoveryCodes === undefined
              ? {}
              : { remainingRecoveryCodes }),
          }),
        ),
    ],
    [
      ClientViewerDocument,
      () => Promise.resolve(viewerResult(signedInViewerQuery({ totpEnabled }))),
    ],
  ]);

async function startSetup(): Promise<void> {
  await userEvent.type(startPassword(), CURRENT_PASSWORD);
  await userEvent.click(startButton());
  await expect.element(setupDialog()).toBeVisible();
}

beforeEach(() => {
  executeGraphQL.mockReset();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('多要素認証の設定', () => {
  test('無効な間は、無効である旨と、現在のパスワードだけの本人確認で設定を始める欄を示す', async () => {
    await renderSecurityPage();

    await expect
      .element(totpStatus())
      .toHaveTextContent('多要素認証は無効です。');
    await expect.element(startPassword()).toBeVisible();
    expect(
      totpRegion()
        .getByLabelText('認証コード(必須)', { exact: true })
        .elements(),
    ).toHaveLength(0);
    expect(recoveryRegion().elements()).toHaveLength(0);
  });

  test('本人確認→QRコードと手入力用の文字列→認証コード→リカバリコードの表示の順に設定し、閉じると有効である旨へフォーカスを移す', async () => {
    respond(
      new Map<unknown, Handler>([
        [ClientStartTotpSetupDocument, ok({ startTotpSetup: TOTP_SETUP })],
        [
          ClientEnableTotpDocument,
          ok({ enableTotp: { codes: RECOVERY_CODES } }),
        ],
        ...refetchedAs(true),
      ]),
    );
    const { context } = await renderSecurityPage();

    await startSetup();

    expect(executeGraphQL).toHaveBeenCalledWith(
      ClientStartTotpSetupDocument,
      { input: { currentPassword: CURRENT_PASSWORD } },
      expect.anything(),
    );
    await expect
      .element(
        setupDialog().getByRole('img', {
          name: '認証アプリで読み取るQRコード',
        }),
      )
      .toBeVisible();
    await expect.element(setupDialog().getByText(TOTP_SECRET)).toBeVisible();
    expect(
      setupDialog()
        .element()
        .querySelector(`time[datetime="${TOTP_SETUP.expiresAt}"]`),
    ).not.toBeNull();
    await expect
      .element(setupCode())
      .toHaveAccessibleDescription(TOTP_CODE_DESCRIPTION);

    await userEvent.type(setupCode(), '123456');
    await userEvent.click(enableButton());

    await expect
      .element(setupDialog().getByRole('status').first())
      .toHaveTextContent('多要素認証を有効にしました。');
    const codes = setupDialog().getByRole('list', { name: 'リカバリコード' });
    for (const code of RECOVERY_CODES) {
      await expect.element(codes.getByText(code)).toBeVisible();
    }
    await expect
      .element(
        setupDialog().getByText(
          '認証アプリとリカバリコードの両方を失うと、アカウントを復旧できません。',
          { exact: false },
        ),
      )
      .toBeVisible();
    expect(executeGraphQL).toHaveBeenCalledWith(
      ClientEnableTotpDocument,
      { totpCode: '123456' },
      expect.anything(),
    );
    await expect
      .poll(
        () =>
          context.queryClient.getQueryState(viewerQueryOptions().queryKey)
            ?.isInvalidated,
      )
      .toBe(true);

    await userEvent.click(
      setupDialog().getByRole('button', { name: '閉じる' }).last(),
    );

    await expect.element(setupDialog()).not.toBeInTheDocument();
    await expect
      .element(totpStatus())
      .toHaveTextContent('多要素認証は有効です。');
    await expect.element(totpStatus()).toHaveFocus();
    await expect
      .element(
        recoveryRegion().getByText('未使用のリカバリコードは残り10個です。'),
      )
      .toBeVisible();
  });

  test('誤った認証コードは、設定のダイアログの認証コードの欄に示す', async () => {
    respond(
      new Map<unknown, Handler>([
        [ClientStartTotpSetupDocument, ok({ startTotpSetup: TOTP_SETUP })],
        [
          ClientEnableTotpDocument,
          () =>
            graphqlFailure({
              code: 'invalid_second_factor',
              message: SECOND_FACTOR_INCORRECT,
              status: 401,
            }),
        ],
      ]),
    );
    await renderSecurityPage();

    await startSetup();
    await userEvent.type(setupCode(), '000000');
    await userEvent.click(enableButton());

    await expect
      .element(setupCode())
      .toHaveAccessibleDescription(
        `${TOTP_CODE_DESCRIPTION} ${SECOND_FACTOR_INCORRECT}`,
      );
    await expect.element(setupCode()).toHaveFocus();
  });

  test('設定の有効期限が切れた時は、ダイアログのフォーム全体の失敗として示す', async () => {
    const expired = '設定の有効期限が切れました。最初からやり直してください。';
    respond(
      new Map<unknown, Handler>([
        [ClientStartTotpSetupDocument, ok({ startTotpSetup: TOTP_SETUP })],
        [
          ClientEnableTotpDocument,
          () =>
            graphqlFailure({
              code: 'totp_setup_expired',
              message: expired,
              status: 422,
            }),
        ],
      ]),
    );
    await renderSecurityPage();

    await startSetup();
    await userEvent.type(setupCode(), '123456');
    await userEvent.click(enableButton());

    await expect
      .element(setupDialog().getByRole('alert'))
      .toHaveTextContent(expired);
    await expect.element(enableButton()).toBeEnabled();
  });

  test('設定の開始で現在のパスワードが誤っていれば、その欄に示しダイアログを開かない', async () => {
    respond(
      new Map<unknown, Handler>([
        [
          ClientStartTotpSetupDocument,
          () =>
            reauthenticationFailed(
              'input.currentPassword',
              'incorrect',
              CURRENT_PASSWORD_INCORRECT,
            ),
        ],
      ]),
    );
    await renderSecurityPage();

    await userEvent.type(startPassword(), CURRENT_PASSWORD);
    await userEvent.click(startButton());

    await expect
      .element(startPassword())
      .toHaveAccessibleDescription(CURRENT_PASSWORD_INCORRECT);
    expect(setupDialog().elements()).toHaveLength(0);
  });

  test('メールアドレスが未確認なら、設定の開始の失敗をフォーム全体の文言で示す', async () => {
    const message =
      'この操作にはメールアドレスの確認が必要です。確認メールをご確認ください。';
    respond(
      new Map<unknown, Handler>([
        [
          ClientStartTotpSetupDocument,
          () =>
            graphqlFailure({
              code: 'email_not_verified',
              message,
              status: 403,
            }),
        ],
      ]),
    );
    await renderSecurityPage();

    await userEvent.type(startPassword(), CURRENT_PASSWORD);
    await userEvent.click(startButton());

    await expect
      .element(totpRegion().getByRole('alert'))
      .toHaveTextContent(message);
  });
});

describe('有効な多要素認証の管理', () => {
  test('有効な間は、有効である旨と未使用のリカバリコードの残数を示し、少なくなければ再発行を促さない', async () => {
    await renderSecurityPage({ totpEnabled: true, remainingRecoveryCodes: 4 });

    await expect
      .element(totpStatus())
      .toHaveTextContent('多要素認証は有効です。');
    await expect
      .element(
        recoveryRegion().getByText('未使用のリカバリコードは残り4個です。'),
      )
      .toBeVisible();
    expect(
      recoveryRegion()
        .getByText('残りが少なくなっています。', { exact: false })
        .elements(),
    ).toHaveLength(0);
    expect(startButton().elements()).toHaveLength(0);
  });

  test.each([3, 0])(
    '未使用のリカバリコードが%i個なら、再発行を促す',
    async (remainingRecoveryCodes) => {
      await renderSecurityPage({ totpEnabled: true, remainingRecoveryCodes });

      await expect
        .element(
          recoveryRegion().getByText(
            '残りが少なくなっています。リカバリコードを再発行してください。',
          ),
        )
        .toBeVisible();
    },
  );

  test('リカバリコードを再発行すると、本人確認を送り、新しいリカバリコードをダイアログで示す', async () => {
    respond(
      new Map<unknown, Handler>([
        [
          ClientRegenerateRecoveryCodesDocument,
          ok({ regenerateRecoveryCodes: { codes: RECOVERY_CODES } }),
        ],
        ...refetchedAs(true, 10),
      ]),
    );
    await renderSecurityPage({ totpEnabled: true, remainingRecoveryCodes: 2 });

    await userEvent.type(
      regenerateForm().getByLabelText('現在のパスワード(必須)', {
        exact: true,
      }),
      CURRENT_PASSWORD,
    );
    await userEvent.type(
      regenerateForm().getByRole('textbox', { name: '認証コード(必須)' }),
      '123456',
    );
    await userEvent.click(
      regenerateForm().getByRole('button', {
        name: 'リカバリコードを再発行する',
      }),
    );

    const codes = codesDialog().getByRole('list', { name: 'リカバリコード' });
    for (const code of RECOVERY_CODES) {
      await expect.element(codes.getByText(code)).toBeVisible();
    }
    await expect
      .element(codesDialog())
      .toHaveTextContent('以前のリカバリコードは使えなくなりました。');
    expect(executeGraphQL).toHaveBeenCalledWith(
      ClientRegenerateRecoveryCodesDocument,
      {
        input: {
          currentPassword: CURRENT_PASSWORD,
          secondFactor: { totpCode: '123456' },
        },
      },
      expect.anything(),
    );

    await userEvent.click(
      codesDialog().getByRole('button', { name: '閉じる' }).last(),
    );

    await expect.element(codesDialog()).not.toBeInTheDocument();
    await expect
      .element(
        recoveryRegion().getByText('未使用のリカバリコードは残り10個です。'),
      )
      .toHaveFocus();
  });

  test('再発行の本人確認でリカバリコードの誤りは、リカバリコードの欄に示す', async () => {
    respond(
      new Map<unknown, Handler>([
        [
          ClientRegenerateRecoveryCodesDocument,
          () =>
            reauthenticationFailed(
              'input.secondFactor.recoveryCode',
              'incorrect',
              SECOND_FACTOR_INCORRECT,
            ),
        ],
      ]),
    );
    await renderSecurityPage({ totpEnabled: true });

    await userEvent.type(
      regenerateForm().getByLabelText('現在のパスワード(必須)', {
        exact: true,
      }),
      CURRENT_PASSWORD,
    );
    await userEvent.click(
      regenerateForm().getByRole('button', { name: 'リカバリコードを使う' }),
    );
    const recoveryInput = regenerateForm().getByRole('textbox', {
      name: 'リカバリコード(必須)',
    });
    await userEvent.type(recoveryInput, 'pitch-code-0');
    await userEvent.click(
      regenerateForm().getByRole('button', {
        name: 'リカバリコードを再発行する',
      }),
    );

    await expect.element(recoveryInput).toHaveAttribute('aria-invalid', 'true');
    expect(executeGraphQL).toHaveBeenCalledWith(
      ClientRegenerateRecoveryCodesDocument,
      {
        input: {
          currentPassword: CURRENT_PASSWORD,
          secondFactor: { recoveryCode: 'pitch-code-0' },
        },
      },
      expect.anything(),
    );
  });

  test('多要素認証を無効にすると、本人確認を送って取り直し、無効である旨へフォーカスを移す', async () => {
    respond(
      new Map<unknown, Handler>([
        [ClientDisableTotpDocument, ok({ disableTotp: true })],
        ...refetchedAs(false),
      ]),
    );
    await renderSecurityPage({ totpEnabled: true });

    await userEvent.type(
      disableForm().getByLabelText('現在のパスワード(必須)', { exact: true }),
      CURRENT_PASSWORD,
    );
    await userEvent.type(
      disableForm().getByRole('textbox', { name: '認証コード(必須)' }),
      '123456',
    );
    await userEvent.click(
      disableForm().getByRole('button', { name: '多要素認証を無効にする' }),
    );

    await expect
      .element(totpStatus())
      .toHaveTextContent('多要素認証は無効です。');
    await expect.element(totpStatus()).toHaveFocus();
    expect(recoveryRegion().elements()).toHaveLength(0);
    expect(executeGraphQL).toHaveBeenCalledWith(
      ClientDisableTotpDocument,
      {
        input: {
          currentPassword: CURRENT_PASSWORD,
          secondFactor: { totpCode: '123456' },
        },
      },
      expect.anything(),
    );
  });

  test('無効化で第2要素を送らなかった時の詳細は、フォーム全体の失敗として示し、送信ボタンを無効のまま残さない', async () => {
    respond(
      new Map<unknown, Handler>([
        [
          ClientDisableTotpDocument,
          () =>
            reauthenticationFailed(
              'input.secondFactor',
              'required',
              '認証コードかリカバリコードのどちらか一方を入力してください。',
            ),
        ],
        ...refetchedAs(true),
      ]),
    );
    await renderSecurityPage({ totpEnabled: true });

    await userEvent.type(
      disableForm().getByLabelText('現在のパスワード(必須)', { exact: true }),
      CURRENT_PASSWORD,
    );
    await userEvent.type(
      disableForm().getByRole('textbox', { name: '認証コード(必須)' }),
      '123456',
    );
    const submit = disableForm().getByRole('button', {
      name: '多要素認証を無効にする',
    });
    await userEvent.click(submit);

    await expect
      .element(disableForm().getByRole('alert'))
      .toHaveTextContent(
        '認証コードかリカバリコードのどちらか一方を入力してください。',
      );
    await expect.element(submit).toBeEnabled();
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  beforeEach(() => {
    applyColorScheme(scheme);
  });

  test('QRコードを示す設定のダイアログで、アクセシビリティの検査の違反が0件', async () => {
    respond(
      new Map<unknown, Handler>([
        [ClientStartTotpSetupDocument, ok({ startTotpSetup: TOTP_SETUP })],
      ]),
    );
    await renderSecurityPage();

    await startSetup();

    expect(await runAxe(setupDialog().element())).toStrictEqual([]);
  });

  test('リカバリコードを示すダイアログで、アクセシビリティの検査の違反が0件', async () => {
    respond(
      new Map<unknown, Handler>([
        [
          ClientRegenerateRecoveryCodesDocument,
          ok({ regenerateRecoveryCodes: { codes: RECOVERY_CODES } }),
        ],
        ...refetchedAs(true, 10),
      ]),
    );
    await renderSecurityPage({ totpEnabled: true });

    await userEvent.type(
      regenerateForm().getByLabelText('現在のパスワード(必須)', {
        exact: true,
      }),
      CURRENT_PASSWORD,
    );
    await userEvent.type(
      regenerateForm().getByRole('textbox', { name: '認証コード(必須)' }),
      '123456',
    );
    await userEvent.click(
      regenerateForm().getByRole('button', {
        name: 'リカバリコードを再発行する',
      }),
    );
    await expect.element(codesDialog()).toBeVisible();

    expect(await runAxe(codesDialog().element())).toStrictEqual([]);
  });
});
