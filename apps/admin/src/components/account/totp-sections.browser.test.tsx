import type { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { cleanup } from 'vitest-browser-react';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import {
  CURRENT_PASSWORD,
  CURRENT_PASSWORD_INCORRECT,
  RECOVERY_CODES,
  reauthenticationFailed,
  renderAccountPage,
  respondAccountGraphQL,
  SECOND_FACTOR_INCORRECT,
  TOTP_SECRET,
  TOTP_SETUP,
} from '../../../test/account-fixtures.ts';
import {
  callsOf,
  failure,
  type GraphQLHandler,
  success,
} from '../../../test/admin-accounts-fixtures.ts';
import { signedInAdminQuery } from '../../../test/admin-viewer-fixtures.ts';
import {
  AdminCompleteTotpResetDocument,
  AdminRegenerateRecoveryCodesDocument,
  AdminStartTotpResetDocument,
  type AdminViewerQuery,
  AdminViewerDocument,
} from '../../graphql/generated/graphql.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const LOSS_WARNING =
  '認証アプリとリカバリコードの両方を失うと、アカウントを復旧できません。';
const FIRST_CODE = RECOVERY_CODES[0] ?? '';

const main = () => page.getByRole('main');
const totpSection = () => main().getByRole('region', { name: '多要素認証' });
const startForm = () =>
  totpSection().getByRole('form', { name: '多要素認証の再設定' });
const startButton = () =>
  startForm().getByRole('button', { name: '再設定を始める' });
const resetDialog = () =>
  page.getByRole('dialog', { name: '多要素認証の再設定' });
const resetCodeInput = () =>
  resetDialog().getByRole('textbox', { name: '認証コード(必須)' });
const recoverySection = () =>
  main().getByRole('region', { name: 'リカバリコード' });
const regenerateForm = () =>
  recoverySection().getByRole('form', { name: 'リカバリコードの再発行' });
const regenerateButton = () =>
  regenerateForm().getByRole('button', { name: 'リカバリコードを再発行する' });
const codesDialog = () =>
  page.getByRole('dialog', { name: '新しいリカバリコード' });

type FormLocator = ReturnType<typeof startForm>;

async function fillReauthentication(form: FormLocator): Promise<void> {
  await userEvent.fill(
    form.getByLabelText('現在のパスワード(必須)', { exact: true }),
    CURRENT_PASSWORD,
  );
  await userEvent.fill(
    form.getByRole('textbox', { name: '認証コード(必須)' }),
    '123456',
  );
}

const ok = <T,>(data: T) => vi.fn(() => success(data));

async function renderWith(
  handlers: ReadonlyMap<unknown, GraphQLHandler>,
  viewer: () => AdminViewerQuery = () => signedInAdminQuery(),
) {
  respondAccountGraphQL(executeGraphQL, { viewer, handlers });
  const rendered = await renderAccountPage(viewer());
  await expect.element(startForm()).toBeVisible();
  return rendered;
}

// 変更の結果の保管場所に、この時だけ見せる値の平文が残っていないか
async function expectNoPlaintext(queryClient: QueryClient): Promise<void> {
  await expect
    .poll(() => {
      const text = JSON.stringify(
        queryClient
          .getMutationCache()
          .getAll()
          .map(({ state }) => state.data ?? null),
      );
      return [TOTP_SECRET, ...RECOVERY_CODES].filter((value) =>
        text.includes(value),
      );
    })
    .toEqual([]);
}

async function startReset(): Promise<void> {
  await fillReauthentication(startForm());
  await startButton().click();
  await expect.element(resetDialog().getByText(TOTP_SECRET)).toBeVisible();
}

beforeEach(() => {
  executeGraphQL.mockReset();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('多要素認証の再設定', () => {
  test('本人確認→QRコードと手入力用の文字列→認証コード→リカバリコードの順に進め、セッションの入れ替えの後にログイン中の管理者を取り直す', async () => {
    const start = ok({ startAdminTotpReset: TOTP_SETUP });
    const complete = ok({
      completeAdminTotpReset: { codes: [...RECOVERY_CODES] },
    });
    await renderWith(
      new Map<unknown, GraphQLHandler>([
        [AdminStartTotpResetDocument, start],
        [AdminCompleteTotpResetDocument, complete],
      ]),
    );
    const viewerCalls = callsOf(executeGraphQL, AdminViewerDocument).length;

    await startReset();
    expect(start).toHaveBeenCalledExactlyOnceWith({
      reAuthentication: {
        currentPassword: CURRENT_PASSWORD,
        secondFactor: { totpCode: '123456' },
      },
    });
    await expect
      .element(resetDialog().getByRole('img', { name: /QRコード/ }))
      .toBeVisible();
    await userEvent.fill(resetCodeInput(), '654321');
    await resetDialog()
      .getByRole('button', { name: '再設定を完了する' })
      .click();

    await expect.element(resetDialog().getByText(FIRST_CODE)).toBeVisible();
    await expect
      .element(resetDialog())
      .toHaveTextContent(
        '多要素認証を設定し直しました。ほかの端末ではログアウトしました。',
      );
    await expect.element(resetDialog()).toHaveTextContent(LOSS_WARNING);
    expect(complete).toHaveBeenCalledExactlyOnceWith({ totpCode: '654321' });
    await expect
      .poll(() => callsOf(executeGraphQL, AdminViewerDocument).length)
      .toBeGreaterThan(viewerCalls);

    await resetDialog().getByRole('button', { name: '閉じる' }).last().click();
    await expect.element(resetDialog()).not.toBeInTheDocument();
    await expect
      .element(totpSection().getByRole('heading', { level: 2 }))
      .toHaveFocus();
  });

  test('誤った認証コードは認証コードの欄に、期限切れはダイアログの中の失敗として示す', async () => {
    let result = () =>
      failure({
        code: 'invalid_second_factor',
        message: SECOND_FACTOR_INCORRECT,
        status: 200,
      });
    await renderWith(
      new Map<unknown, GraphQLHandler>([
        [AdminStartTotpResetDocument, ok({ startAdminTotpReset: TOTP_SETUP })],
        [AdminCompleteTotpResetDocument, () => result()],
      ]),
    );

    await startReset();
    await userEvent.fill(resetCodeInput(), '000000');
    await resetDialog()
      .getByRole('button', { name: '再設定を完了する' })
      .click();
    await expect
      .element(resetCodeInput())
      .toHaveAccessibleDescription(new RegExp(SECOND_FACTOR_INCORRECT));
    await expect.element(resetCodeInput()).toHaveFocus();

    result = () =>
      failure({
        code: 'totp_setup_expired',
        message: '設定の有効期限が切れました。最初からやり直してください。',
        status: 200,
      });
    await userEvent.fill(resetCodeInput(), '111111');
    await resetDialog()
      .getByRole('button', { name: '再設定を完了する' })
      .click();

    await expect
      .element(resetDialog().getByRole('alert'))
      .toHaveTextContent(
        '設定の有効期限が切れました。最初からやり直してください。',
      );
  });

  test('本人確認の誤りは欄に示し、ダイアログを開かない', async () => {
    await renderWith(
      new Map<unknown, GraphQLHandler>([
        [
          AdminStartTotpResetDocument,
          () =>
            reauthenticationFailed(
              'reAuthentication.currentPassword',
              CURRENT_PASSWORD_INCORRECT,
            ),
        ],
      ]),
    );

    await fillReauthentication(startForm());
    await startButton().click();

    await expect
      .element(
        startForm().getByLabelText('現在のパスワード(必須)', { exact: true }),
      )
      .toHaveAccessibleDescription(CURRENT_PASSWORD_INCORRECT);
    expect(resetDialog().elements()).toHaveLength(0);
  });

  test('第2要素を送らなかった時の詳細は、フォーム全体の失敗として示し、送信ボタンを無効のまま残さない', async () => {
    await renderWith(
      new Map<unknown, GraphQLHandler>([
        [
          AdminStartTotpResetDocument,
          () =>
            reauthenticationFailed(
              'reAuthentication.secondFactor',
              SECOND_FACTOR_INCORRECT,
            ),
        ],
      ]),
    );

    await fillReauthentication(startForm());
    await startButton().click();

    await expect
      .element(startForm().getByRole('alert'))
      .toHaveTextContent(SECOND_FACTOR_INCORRECT);
    await expect.element(startButton()).toBeEnabled();
  });
});

describe('再設定の完了の処理中', () => {
  const overlay = () =>
    page.elementLocator(
      document.querySelector('[data-slot="dialog-overlay"]') ?? document.body,
    );

  test('取り消し・右上の「閉じる」・Escape・ダイアログの外の押下では閉じず、応答の後に新しいリカバリコードを示す', async () => {
    let resolveComplete: (value: unknown) => void = () => undefined;
    const completion = new Promise((resolve) => {
      resolveComplete = resolve;
    });
    await renderWith(
      new Map<unknown, GraphQLHandler>([
        [AdminStartTotpResetDocument, ok({ startAdminTotpReset: TOTP_SETUP })],
        [AdminCompleteTotpResetDocument, () => completion],
      ]),
    );

    await startReset();
    await userEvent.fill(resetCodeInput(), '654321');
    await resetDialog()
      .getByRole('button', { name: '再設定を完了する' })
      .click();
    await expect
      .element(resetDialog().getByRole('button', { name: '送信中' }))
      .toHaveAttribute('aria-busy', 'true');

    const cancelButton = resetDialog().getByRole('button', {
      name: 'キャンセル',
      exact: true,
    });
    const closeButton = resetDialog().getByRole('button', {
      name: '閉じる',
      exact: true,
    });
    await expect.element(cancelButton).toHaveAttribute('aria-disabled', 'true');
    await expect.element(closeButton).toHaveAttribute('disabled');
    await userEvent.keyboard('{Escape}');
    await cancelButton.click({ force: true });
    await userEvent.click(overlay(), { position: { x: 4, y: 4 } });
    await expect.element(resetDialog()).toBeVisible();
    expect(resetDialog().element().contains(document.activeElement)).toBe(true);

    resolveComplete({
      ok: true,
      data: { completeAdminTotpReset: { codes: [...RECOVERY_CODES] } },
    });

    await expect.element(resetDialog().getByText(FIRST_CODE)).toBeVisible();
  });
});

describe('本人確認でリカバリコードを使った後の残数', () => {
  test('リカバリコードで再設定を始めて取り消した後、取り直した残数を示す', async () => {
    let remaining = 5;
    await renderWith(
      new Map<unknown, GraphQLHandler>([
        [
          AdminStartTotpResetDocument,
          () => {
            remaining = 4;
            return success({ startAdminTotpReset: TOTP_SETUP });
          },
        ],
      ]),
      () => signedInAdminQuery({ remainingRecoveryCodes: remaining }),
    );

    await userEvent.fill(
      startForm().getByLabelText('現在のパスワード(必須)', { exact: true }),
      CURRENT_PASSWORD,
    );
    await startForm()
      .getByRole('button', { name: 'リカバリコードを使う' })
      .click();
    await userEvent.fill(
      startForm().getByRole('textbox', { name: 'リカバリコード(必須)' }),
      'abcd-efgh',
    );
    await startButton().click();
    await expect.element(resetDialog().getByText(TOTP_SECRET)).toBeVisible();
    await resetDialog().getByRole('button', { name: 'キャンセル' }).click();

    await expect.element(resetDialog()).not.toBeInTheDocument();
    await expect
      .element(recoverySection())
      .toHaveTextContent('未使用のリカバリコードは残り4個です。');
  });
});

describe('リカバリコード', () => {
  test('未使用のリカバリコードの残数を示し、少なければ再発行を促す', async () => {
    await renderWith(new Map(), () =>
      signedInAdminQuery({ remainingRecoveryCodes: 2 }),
    );

    await expect
      .element(recoverySection())
      .toHaveTextContent('未使用のリカバリコードは残り2個です。');
    await expect
      .element(recoverySection())
      .toHaveTextContent(
        '残りが少なくなっています。リカバリコードを再発行してください。',
      );
  });

  test('本人確認のうえで再発行し、新しいリカバリコードと保管の注意を示し、取り直した残数へフォーカスを戻す', async () => {
    let remaining = 3;
    const regenerate = vi.fn(() => {
      remaining = 10;
      return success({
        regenerateAdminRecoveryCodes: { codes: [...RECOVERY_CODES] },
      });
    });
    await renderWith(
      new Map<unknown, GraphQLHandler>([
        [AdminRegenerateRecoveryCodesDocument, regenerate],
      ]),
      () => signedInAdminQuery({ remainingRecoveryCodes: remaining }),
    );

    await fillReauthentication(regenerateForm());
    await regenerateButton().click();

    await expect.element(codesDialog().getByText(FIRST_CODE)).toBeVisible();
    await expect.element(codesDialog()).toHaveTextContent(LOSS_WARNING);
    expect(regenerate).toHaveBeenCalledExactlyOnceWith({
      reAuthentication: {
        currentPassword: CURRENT_PASSWORD,
        secondFactor: { totpCode: '123456' },
      },
    });
    await codesDialog().getByRole('button', { name: '閉じる' }).last().click();

    await expect.element(codesDialog()).not.toBeInTheDocument();
    const remainingText = recoverySection().getByText(
      '未使用のリカバリコードは残り10個です。',
    );
    await expect.element(remainingText).toBeVisible();
    await expect.element(remainingText).toHaveFocus();
  });
});

describe('秘密鍵とリカバリコードの平文を変更の結果の保管場所に残さない', () => {
  test('再設定を完了してダイアログを閉じた後に残らない', async () => {
    const { context } = await renderWith(
      new Map<unknown, GraphQLHandler>([
        [AdminStartTotpResetDocument, ok({ startAdminTotpReset: TOTP_SETUP })],
        [
          AdminCompleteTotpResetDocument,
          ok({ completeAdminTotpReset: { codes: [...RECOVERY_CODES] } }),
        ],
      ]),
    );

    await startReset();
    await userEvent.fill(resetCodeInput(), '654321');
    await resetDialog()
      .getByRole('button', { name: '再設定を完了する' })
      .click();
    await expect.element(resetDialog().getByText(FIRST_CODE)).toBeVisible();
    await resetDialog().getByRole('button', { name: '閉じる' }).last().click();
    await expect.element(resetDialog()).not.toBeInTheDocument();

    await expectNoPlaintext(context.queryClient);
  });

  test('再設定を取り消すと、開き直しても前の秘密鍵を描かず、平文も残らない', async () => {
    const { context } = await renderWith(
      new Map<unknown, GraphQLHandler>([
        [AdminStartTotpResetDocument, ok({ startAdminTotpReset: TOTP_SETUP })],
      ]),
    );

    await startReset();
    await resetDialog().getByRole('button', { name: 'キャンセル' }).click();
    await expect.element(resetDialog()).not.toBeInTheDocument();

    expect(page.getByText(TOTP_SECRET).elements()).toHaveLength(0);
    await expect
      .element(totpSection().getByRole('heading', { level: 2 }))
      .toHaveFocus();
    await expectNoPlaintext(context.queryClient);
  });

  test('再発行したリカバリコードのダイアログを開いたまま画面を離れた後に残らない', async () => {
    const { context } = await renderWith(
      new Map<unknown, GraphQLHandler>([
        [
          AdminRegenerateRecoveryCodesDocument,
          ok({ regenerateAdminRecoveryCodes: { codes: [...RECOVERY_CODES] } }),
        ],
      ]),
    );

    await fillReauthentication(regenerateForm());
    await regenerateButton().click();
    await expect.element(codesDialog().getByText(FIRST_CODE)).toBeVisible();
    await cleanup();

    await expectNoPlaintext(context.queryClient);
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('再設定のダイアログとリカバリコードのダイアログのアクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    await renderWith(
      new Map<unknown, GraphQLHandler>([
        [AdminStartTotpResetDocument, ok({ startAdminTotpReset: TOTP_SETUP })],
        [
          AdminCompleteTotpResetDocument,
          ok({ completeAdminTotpReset: { codes: [...RECOVERY_CODES] } }),
        ],
      ]),
    );

    await startReset();
    expect(await runAxe(resetDialog().element())).toStrictEqual([]);
    await userEvent.fill(resetCodeInput(), '654321');
    await resetDialog()
      .getByRole('button', { name: '再設定を完了する' })
      .click();
    await expect.element(resetDialog().getByText(FIRST_CODE)).toBeVisible();
    expect(await runAxe(resetDialog().element())).toStrictEqual([]);
  });
});
