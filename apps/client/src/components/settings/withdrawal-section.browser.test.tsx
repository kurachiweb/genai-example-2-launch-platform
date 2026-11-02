import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { resetTurnstileScriptFailure } from '../../../lib/components/bot-protection/turnstile-script-failure.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import {
  lastTurnstileProps,
  resetFakeTurnstile,
} from '../../../lib/test/fake-turnstile.tsx';
import {
  createPageRouterContext,
  renderInRouter,
} from '../../../test/page-router.tsx';
import {
  CURRENT_PASSWORD,
  CURRENT_PASSWORD_INCORRECT,
  passBotCheck,
  reauthenticationFailed,
  SECOND_FACTOR_INCORRECT,
} from '../../../test/settings-fixtures.ts';
import {
  signedInViewerQuery,
  viewerResult,
} from '../../../test/viewer-fixtures.ts';
import {
  ClientViewerDocument,
  ClientWithdrawDocument,
} from '../../graphql/generated/graphql.ts';
import { viewerQueryOptions } from '../../graphql/viewer.ts';
import { WithdrawalSection } from './withdrawal-section.tsx';

const TOTP_CODE_DESCRIPTION =
  '認証アプリに表示されている6桁の認証コードを入力してください。';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../../../lib/test/fake-turnstile.tsx'),
);

const IMPACTS = [
  '退会は取り消せません。',
  '投稿したプロダクト・コメント・評価と、Upvote・フォローは、退会と同時に表示されなくなります。',
  'Ultrasなどの定期課金は、返金せずに直ちに解約されます。',
  '個人データは、退会から14日以内に削除されます。',
];

const section = () => page.getByRole('region', { name: '退会' });
const openButton = () => section().getByRole('button', { name: '退会する' });
const dialog = () => page.getByRole('dialog', { name: '退会しますか?' });
const withdrawalForm = () => dialog().getByRole('form', { name: '退会' });
const currentPasswordInput = () =>
  dialog().getByLabelText('現在のパスワード(必須)', { exact: true });
const totpInput = () =>
  dialog().getByRole('textbox', { name: '認証コード(必須)' });
const confirmButton = () => dialog().getByRole('button', { name: '退会する' });

function respond(result: () => Promise<unknown>): void {
  executeGraphQL.mockImplementation((document: unknown) => {
    if (document === ClientWithdrawDocument) {
      return result();
    }
    if (document === ClientViewerDocument) {
      return Promise.resolve(viewerResult({ viewer: null }));
    }
    throw new Error('想定していない操作が実行されました。');
  });
}

async function renderSection(totpEnabled = false) {
  const context = createPageRouterContext('local');
  const router = await renderInRouter(
    <WithdrawalSection totpEnabled={totpEnabled} />,
    {
      path: '/settings/account',
      context,
      cachedViewer: signedInViewerQuery({ totpEnabled }),
    },
  );
  return { router, context };
}

async function openAndSubmit(): Promise<void> {
  await userEvent.click(openButton());
  await userEvent.type(currentPasswordInput(), CURRENT_PASSWORD);
  passBotCheck();
  await userEvent.click(confirmButton());
}

beforeEach(() => {
  executeGraphQL.mockReset();
  resetFakeTurnstile();
  resetTurnstileScriptFailure();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('WithdrawalSection', () => {
  test('退会の影響を示し、開いただけではダイアログもbot判定のウィジェットも描かない', async () => {
    await renderSection();

    for (const impact of IMPACTS) {
      await expect.element(section().getByText(impact)).toBeVisible();
    }
    expect(dialog().elements()).toHaveLength(0);
    expect(page.getByTestId('fake-turnstile').elements()).toHaveLength(0);
  });

  test('退会の確認のダイアログで影響を示し、退会の操作名の非表示のbot判定を行い、キャンセルで閉じて開いたボタンへフォーカスを戻す', async () => {
    await renderSection();

    await userEvent.click(openButton());

    for (const impact of IMPACTS) {
      await expect.element(dialog().getByText(impact)).toBeVisible();
    }
    expect(lastTurnstileProps().options).toMatchObject({
      action: 'withdraw',
      size: 'invisible',
    });

    await userEvent.click(dialog().getByRole('button', { name: 'キャンセル' }));

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(openButton()).toHaveFocus();
    expect(executeGraphQL).not.toHaveBeenCalled();
  });

  test('退会すると、bot判定のトークンを付けて本人確認を送り、利用者の取得を無効にしてトップページへ移る', async () => {
    respond(() => Promise.resolve({ ok: true, data: { withdraw: true } }));
    const { router, context } = await renderSection();

    await openAndSubmit();

    await expect.poll(() => router.state.location.pathname).toBe('/');
    expect(executeGraphQL).toHaveBeenCalledWith(
      ClientWithdrawDocument,
      { input: { currentPassword: CURRENT_PASSWORD } },
      { turnstileToken: 'turnstile-token-1' },
    );
    expect(
      context.queryClient.getQueryState(viewerQueryOptions().queryKey)
        ?.isInvalidated,
    ).toBe(true);
  });

  test('現在のパスワードの誤りは、ダイアログの現在のパスワードの欄に示す', async () => {
    respond(() =>
      reauthenticationFailed(
        'input.currentPassword',
        'incorrect',
        CURRENT_PASSWORD_INCORRECT,
      ),
    );
    const { router } = await renderSection();

    await openAndSubmit();

    await expect
      .element(currentPasswordInput())
      .toHaveAccessibleDescription(CURRENT_PASSWORD_INCORRECT);
    expect(router.state.location.pathname).toBe('/settings/account');
  });

  test('多要素認証が有効なら、認証コードを本人確認に含めて送り、認証コードの誤りをその欄に示す', async () => {
    respond(() =>
      reauthenticationFailed(
        'input.secondFactor.totpCode',
        'incorrect',
        SECOND_FACTOR_INCORRECT,
      ),
    );
    await renderSection(true);

    await userEvent.click(openButton());
    await userEvent.type(currentPasswordInput(), CURRENT_PASSWORD);
    await userEvent.type(totpInput(), '000000');
    passBotCheck();
    await userEvent.click(confirmButton());

    await expect
      .element(totpInput())
      .toHaveAccessibleDescription(
        `${TOTP_CODE_DESCRIPTION} ${SECOND_FACTOR_INCORRECT}`,
      );
    expect(executeGraphQL).toHaveBeenCalledWith(
      ClientWithdrawDocument,
      {
        input: {
          currentPassword: CURRENT_PASSWORD,
          secondFactor: { totpCode: '000000' },
        },
      },
      { turnstileToken: 'turnstile-token-1' },
    );
  });

  test('第2要素を送らなかった時の詳細は、フォーム全体の失敗として示し、送信ボタンを無効のまま残さない', async () => {
    respond(() =>
      reauthenticationFailed(
        'input.secondFactor',
        'required',
        SECOND_FACTOR_INCORRECT,
      ),
    );
    await renderSection();

    await openAndSubmit();

    await expect
      .element(withdrawalForm().getByRole('alert'))
      .toHaveTextContent(SECOND_FACTOR_INCORRECT);
    await expect.element(confirmButton()).toBeEnabled();
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('セクションと確認のダイアログで、アクセシビリティの検査の違反が0件', async () => {
      await renderSection(true);
      await expect.element(section()).toBeVisible();
      const sectionViolations = await runAxe(section().element());

      await userEvent.click(openButton());
      await expect.element(currentPasswordInput()).toBeVisible();

      expect(sectionViolations).toStrictEqual([]);
      expect(await runAxe(dialog().element())).toStrictEqual([]);
    });
  });
});
