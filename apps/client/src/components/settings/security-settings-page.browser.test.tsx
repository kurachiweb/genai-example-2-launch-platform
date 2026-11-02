import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import {
  BROWSER_ONLY_SESSION,
  CURRENT_SESSION,
  mySessionsResult,
  renderSecurityPage,
  UNKNOWN_SESSION,
} from '../../../test/security-fixtures.tsx';
import { viewerResult } from '../../../test/viewer-fixtures.ts';
import {
  ClientMySessionsDocument,
  ClientRevokeOtherSessionsDocument,
  ClientRevokeSessionDocument,
  ClientViewerDocument,
} from '../../graphql/generated/graphql.ts';
import { viewerQueryOptions } from '../../graphql/viewer.ts';
import { documentIdOf } from '../../../lib/utilities/graphql/persisted-document.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const SUSPENDED_NOTICE =
  'このアカウントは停止されているため、多要素認証の設定は変更できません。ログイン中の端末のログアウトは行えます。退会はアカウントの設定ページから行えます。ログアウトした後やログインの有効期限が切れた後は、お問い合わせから退会を依頼できます。';

const sessionsRegion = () =>
  page.getByRole('region', { name: 'ログイン中の端末' });
const sessionItems = () => sessionsRegion().getByRole('listitem');
const sessionItem = (label: string) =>
  sessionItems().filter({ hasText: label });
const sessionCount = () =>
  sessionsRegion().getByText(/台の端末でログインしています。$/);
const revokeOthersButton = () =>
  sessionsRegion().getByRole('button', {
    name: 'この端末以外をすべてログアウト',
  });
const revokeOthersDialog = () =>
  page.getByRole('dialog', { name: 'この端末以外をすべてログアウトしますか?' });
const totpRegion = () => page.getByRole('region', { name: '多要素認証' });

type Handler = (variables: unknown) => Promise<unknown>;

function respond(handlers: ReadonlyMap<unknown, Handler>): void {
  executeGraphQL.mockImplementation((document: unknown, variables: unknown) => {
    const handler = handlers.get(document);
    if (handler === undefined) {
      throw new Error('想定していない操作が実行されました。');
    }
    return handler(variables);
  });
}

beforeEach(() => {
  executeGraphQL.mockReset();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('SecuritySettingsPage', () => {
  test('ページの題名と、ログイン中の端末ごとの端末情報・最終利用日時・ログインした日時を示す', async () => {
    await renderSecurityPage();

    await expect
      .element(page.getByRole('heading', { level: 1 }))
      .toHaveTextContent('セキュリティ');
    await expect
      .element(sessionCount())
      .toHaveTextContent('3台の端末でログインしています。');
    expect(sessionItems().elements()).toHaveLength(3);

    const current = sessionItem('Chrome(macOS)');
    await expect.element(current.getByText('この端末')).toBeVisible();
    expect(
      current
        .element()
        .querySelector(`time[datetime="${CURRENT_SESSION.lastUsedAt}"]`),
    ).not.toBeNull();
    expect(
      current
        .element()
        .querySelector(`time[datetime="${CURRENT_SESSION.createdAt}"]`),
    ).not.toBeNull();
    await expect.element(current.getByText('最終利用')).toBeVisible();
    await expect.element(current.getByText('ログインした日時')).toBeVisible();
  });

  test('ブラウザ名だけが分かる端末はブラウザ名を、判別できない端末は「不明な端末」と示し、「この端末」を付けない', async () => {
    await renderSecurityPage();

    const browserOnly = sessionItem(BROWSER_ONLY_SESSION.browserName ?? '');
    await expect.element(browserOnly).toBeVisible();
    expect(browserOnly.getByText('この端末').elements()).toHaveLength(0);
    const unknown = sessionItem('不明な端末');
    await expect.element(unknown).toBeVisible();
    expect(
      unknown
        .element()
        .querySelector(`time[datetime="${UNKNOWN_SESSION.lastUsedAt}"]`),
    ).not.toBeNull();
  });

  test('個別にログアウトさせると、そのセッションを失効させて一覧を取り直し、フォーカスを端末の数の文へ移す', async () => {
    respond(
      new Map<unknown, Handler>([
        [
          ClientRevokeSessionDocument,
          () => Promise.resolve({ ok: true, data: { revokeSession: true } }),
        ],
        [
          ClientMySessionsDocument,
          () =>
            Promise.resolve(
              mySessionsResult({
                sessions: [CURRENT_SESSION, UNKNOWN_SESSION],
              }),
            ),
        ],
      ]),
    );
    await renderSecurityPage();

    await userEvent.click(
      sessionItem('Firefox').getByRole('button', { name: 'ログアウトさせる' }),
    );

    await expect
      .element(sessionCount())
      .toHaveTextContent('2台の端末でログインしています。');
    expect(sessionItem('Firefox').elements()).toHaveLength(0);
    await expect.element(sessionCount()).toHaveFocus();
    expect(executeGraphQL).toHaveBeenCalledWith(
      ClientRevokeSessionDocument,
      { id: BROWSER_ONLY_SESSION.id },
      expect.anything(),
    );
  });

  test('ログアウトさせるボタンは、その端末の名前を説明に持つ', async () => {
    await renderSecurityPage();

    await expect
      .element(
        sessionItem('不明な端末').getByRole('button', {
          name: 'ログアウトさせる',
        }),
      )
      .toHaveAccessibleDescription('不明な端末');
  });

  test('この端末をログアウトさせると、ログイン中の利用者の取得を無効にし、ログイン中の端末の取得結果を消す', async () => {
    respond(
      new Map<unknown, Handler>([
        [
          ClientRevokeSessionDocument,
          () => Promise.resolve({ ok: true, data: { revokeSession: true } }),
        ],
        [
          ClientViewerDocument,
          () => Promise.resolve(viewerResult({ viewer: null })),
        ],
      ]),
    );
    const { context } = await renderSecurityPage();

    await userEvent.click(
      sessionItem('Chrome(macOS)').getByRole('button', {
        name: 'ログアウトさせる',
      }),
    );

    await expect
      .poll(
        () =>
          context.queryClient.getQueryState(viewerQueryOptions().queryKey)
            ?.isInvalidated,
      )
      .toBe(true);
    expect(executeGraphQL).toHaveBeenCalledWith(
      ClientRevokeSessionDocument,
      { id: CURRENT_SESSION.id },
      expect.anything(),
    );
    expect(executeGraphQL).not.toHaveBeenCalledWith(
      ClientMySessionsDocument,
      expect.anything(),
      expect.anything(),
    );
    expect(
      context.queryClient
        .getQueryCache()
        .findAll({ queryKey: [documentIdOf(ClientMySessionsDocument)] }),
    ).toHaveLength(0);
  });

  test('この端末以外をすべてログアウトさせる時は確認し、確定すると一括で失効させて一覧を取り直す', async () => {
    respond(
      new Map<unknown, Handler>([
        [
          ClientRevokeOtherSessionsDocument,
          () => Promise.resolve({ ok: true, data: { revokeOtherSessions: 2 } }),
        ],
        [
          ClientMySessionsDocument,
          () =>
            Promise.resolve(mySessionsResult({ sessions: [CURRENT_SESSION] })),
        ],
      ]),
    );
    await renderSecurityPage();

    await userEvent.click(revokeOthersButton());
    await expect
      .element(revokeOthersDialog())
      .toHaveTextContent(
        'この端末以外のすべての端末で、再度のログインが必要になります。',
      );
    expect(executeGraphQL).not.toHaveBeenCalled();
    await userEvent.click(
      revokeOthersDialog().getByRole('button', { name: 'すべてログアウト' }),
    );

    await expect.element(revokeOthersDialog()).not.toBeInTheDocument();
    await expect
      .element(sessionCount())
      .toHaveTextContent('1台の端末でログインしています。');
    expect(revokeOthersButton().elements()).toHaveLength(0);
    await expect.element(sessionCount()).toHaveFocus();
    expect(executeGraphQL).toHaveBeenCalledWith(
      ClientRevokeOtherSessionsDocument,
      {},
      expect.anything(),
    );
  });

  test('一括の失効の確認をキャンセルすると、失効させずに開いたボタンへフォーカスを戻す', async () => {
    await renderSecurityPage();

    await userEvent.click(revokeOthersButton());
    await userEvent.click(
      revokeOthersDialog().getByRole('button', { name: 'キャンセル' }),
    );

    await expect.element(revokeOthersDialog()).not.toBeInTheDocument();
    await expect.element(revokeOthersButton()).toHaveFocus();
    expect(executeGraphQL).not.toHaveBeenCalled();
  });

  test('この端末だけがログイン中なら、一括の失効のボタンを描かない', async () => {
    await renderSecurityPage({ sessions: [CURRENT_SESSION] });

    await expect.element(sessionCount()).toBeVisible();
    expect(revokeOthersButton().elements()).toHaveLength(0);
  });

  test('停止中は案内と問い合わせへのリンクを示し、多要素認証の欄と送信ボタンを無効にするが、セッションは失効させられる', async () => {
    respond(
      new Map<unknown, Handler>([
        [
          ClientRevokeSessionDocument,
          () => Promise.resolve({ ok: true, data: { revokeSession: true } }),
        ],
        [
          ClientMySessionsDocument,
          () =>
            Promise.resolve(
              mySessionsResult({
                sessions: [CURRENT_SESSION, UNKNOWN_SESSION],
              }),
            ),
        ],
      ]),
    );
    await renderSecurityPage({ status: 'SUSPENDED' });

    const notice = page.getByRole('note', { name: '停止中のアカウント' });
    await expect.element(notice).toHaveTextContent(SUSPENDED_NOTICE);
    await expect
      .element(notice.getByRole('link', { name: 'お問い合わせ' }))
      .toHaveAttribute('href', '/contact');
    await expect
      .element(
        totpRegion().getByLabelText('現在のパスワード(必須)', { exact: true }),
      )
      .toBeDisabled();
    await expect
      .element(totpRegion().getByRole('button', { name: '設定を始める' }))
      .toBeDisabled();

    await userEvent.click(
      sessionItem('Firefox').getByRole('button', { name: 'ログアウトさせる' }),
    );

    await expect
      .element(sessionCount())
      .toHaveTextContent('2台の端末でログインしています。');
  });

  test('停止中は多要素認証が有効でも、無効化と再発行の欄と送信ボタンを無効にする', async () => {
    await renderSecurityPage({ status: 'SUSPENDED', totpEnabled: true });

    for (const name of [
      '多要素認証を無効にする',
      'リカバリコードを再発行する',
    ]) {
      await expect.element(page.getByRole('button', { name })).toBeDisabled();
    }
    for (const input of page
      .getByLabelText('認証コード(必須)', { exact: true })
      .all()) {
      await expect.element(input).toBeDisabled();
    }
    for (const input of page
      .getByLabelText('現在のパスワード(必須)', { exact: true })
      .all()) {
      await expect.element(input).toBeDisabled();
    }
    for (const toggle of page
      .getByRole('button', { name: 'リカバリコードを使う' })
      .all()) {
      await expect.element(toggle).toBeDisabled();
    }
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test.each([
      ['多要素認証が無効', { totpEnabled: false }],
      [
        '多要素認証が有効でリカバリコードが少ない',
        { totpEnabled: true, remainingRecoveryCodes: 2 },
      ],
      ['停止中', { status: 'SUSPENDED' as const }],
    ])(
      '%sのページで、アクセシビリティの検査の違反が0件',
      async (_name, options) => {
        await renderSecurityPage(options);
        await expect.element(sessionCount()).toBeVisible();

        expect(await runAxe(page.getByRole('main').element())).toStrictEqual(
          [],
        );
      },
    );

    test('一括の失効の確認のダイアログで、アクセシビリティの検査の違反が0件', async () => {
      await renderSecurityPage();
      await userEvent.click(revokeOthersButton());
      await expect.element(revokeOthersDialog()).toBeVisible();

      expect(await runAxe(revokeOthersDialog().element())).toStrictEqual([]);
    });
  });
});
