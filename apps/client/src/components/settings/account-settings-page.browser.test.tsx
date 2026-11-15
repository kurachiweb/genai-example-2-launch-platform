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
import {
  createPageRouterContext,
  renderInRouter,
} from '../../../test/page-router.tsx';
import {
  CURRENT_PASSWORD,
  passBotCheck,
} from '../../../test/settings-fixtures.ts';
import {
  signedInViewerQuery,
  viewerResult,
} from '../../../test/viewer-fixtures.ts';
import {
  type AccountStatus,
  ClientViewerDocument,
  ClientWithdrawDocument,
} from '../../graphql/generated/graphql.ts';
import { toClientViewer } from '../../graphql/viewer.ts';
import { AccountSettingsPage } from './account-settings-page.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../../../lib/test/fake-turnstile.tsx'),
);

const SUSPENDED_NOTICE =
  'このアカウントは停止されているため、メールアドレスとパスワードは変更できません。退会はこの画面から行えます。ログアウトした後やログインの有効期限が切れた後は、お問い合わせから退会を依頼できます。';

const main = () => page.getByRole('main');
const notice = () => page.getByRole('note', { name: '停止中のアカウント' });
const emailForm = () =>
  page.getByRole('form', { name: 'メールアドレスの変更' });
const passwordForm = () => page.getByRole('form', { name: 'パスワードの変更' });
const withdrawalRegion = () => page.getByRole('region', { name: '退会' });
const dialog = () => page.getByRole('dialog', { name: '退会しますか?' });

async function renderPage(status: AccountStatus, totpEnabled = false) {
  const query = signedInViewerQuery({ status, totpEnabled });
  const viewer = toClientViewer(query);
  if (viewer === null) {
    throw new Error('ログイン中の利用者の値がありません。');
  }
  return renderInRouter(
    <main>
      <AccountSettingsPage viewer={viewer} />
    </main>,
    {
      path: '/settings/account',
      context: createPageRouterContext('local'),
      cachedViewer: query,
    },
  );
}

beforeEach(() => {
  executeGraphQL.mockReset();
  resetFakeTurnstile();
  resetTurnstileScriptFailure();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('AccountSettingsPage', () => {
  test('ページの見出しの下に、メールアドレス変更・パスワード変更・退会のセクションを順に並べる', async () => {
    await renderPage('ACTIVE');

    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toHaveTextContent('アカウント');
    expect(
      main()
        .getByRole('heading', { level: 2 })
        .elements()
        .map((heading) => heading.textContent),
    ).toStrictEqual(['メールアドレスの変更', 'パスワードの変更', '退会']);
    expect(notice().elements()).toHaveLength(0);
  });

  test('有効なアカウントでは、メールアドレス変更とパスワード変更の欄を操作できる', async () => {
    await renderPage('ACTIVE');

    for (const form of [emailForm(), passwordForm()]) {
      for (const input of form.getByRole('textbox').elements()) {
        expect(input).toBeEnabled();
      }
    }
  });

  describe('停止中のアカウント', () => {
    test('ページ上部に停止中の案内と問い合わせへのリンクを示す', async () => {
      await renderPage('SUSPENDED');

      await expect.element(notice()).toHaveTextContent(SUSPENDED_NOTICE);
      await expect
        .element(notice().getByRole('link', { name: 'お問い合わせ' }))
        .toHaveAttribute('href', '/contact');
      const [first] = main().getByRole('heading').elements();
      expect(
        first?.compareDocumentPosition(notice().element()) ===
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBe(true);
      expect(
        notice().element().compareDocumentPosition(emailForm().element()) ===
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBe(true);
    });

    test('メールアドレス変更とパスワード変更の各欄と送信ボタンを無効にする', async () => {
      await renderPage('SUSPENDED', true);

      for (const form of [emailForm(), passwordForm()]) {
        const inputs = [...form.element().querySelectorAll('input')];
        expect(inputs).toHaveLength(3);
        for (const input of inputs) {
          expect(input).toBeDisabled();
        }
      }
      await expect
        .element(page.getByRole('button', { name: 'メールアドレスを変更する' }))
        .toBeDisabled();
      await expect
        .element(page.getByRole('button', { name: 'パスワードを変更する' }))
        .toBeDisabled();
    });

    test('退会のセクションは操作でき、通常時と同じ確認・本人確認・bot判定で退会できる', async () => {
      executeGraphQL.mockImplementation((document: unknown) =>
        Promise.resolve(
          document === ClientWithdrawDocument
            ? { ok: true, data: { withdraw: true } }
            : document === ClientViewerDocument
              ? viewerResult({ viewer: null })
              : { ok: false },
        ),
      );
      const router = await renderPage('SUSPENDED');

      await userEvent.click(
        withdrawalRegion().getByRole('button', { name: '退会する' }),
      );
      await userEvent.type(
        dialog().getByLabelText('現在のパスワード(必須)', { exact: true }),
        CURRENT_PASSWORD,
      );
      passBotCheck();
      await userEvent.click(dialog().getByRole('button', { name: '退会する' }));

      await expect.poll(() => router.state.location.pathname).toBe('/');
      expect(executeGraphQL).toHaveBeenCalledWith(
        ClientWithdrawDocument,
        { input: { currentPassword: CURRENT_PASSWORD } },
        { turnstileToken: 'turnstile-token-1' },
      );
    });
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test.each(['ACTIVE', 'SUSPENDED'] as const)(
      '状態が%sのページで、アクセシビリティの検査の違反が0件',
      async (status) => {
        await renderPage(status, true);
        await expect.element(withdrawalRegion()).toBeVisible();

        expect(await runAxe(main().element())).toStrictEqual([]);
      },
    );
  });
});
