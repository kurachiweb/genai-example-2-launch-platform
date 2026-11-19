import type { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { Toaster } from '../../../lib/components/feedback/toaster.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import {
  createPageRouterContext,
  renderInRouter,
} from '../../../test/page-router.tsx';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import {
  type ApiKeyFieldsFragment,
  ClientDeleteApiKeyDocument,
  ClientIssueApiKeyDocument,
  ClientMyApiKeysDocument,
  type ClientMyApiKeysQuery,
  ClientReissueApiKeyDocument,
  ClientUpdateApiKeyDocument,
} from '../../graphql/generated/graphql.ts';
import { myApiKeysQueryOptions } from '../../graphql/public-api.ts';
import { apiKeyOf } from './api-key-list-fixtures.ts';
import { ApiKeySettingsPage } from './api-key-settings-page.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const VIEWER_ID = '01JC0VIEWER0000000000000000';

const DISPLAY = Object.freeze({ timeZone: 'Asia/Tokyo', locale: 'ja-JP' });

const FIRST_KEY = apiKeyOf(1, { name: '集計スクリプト' });
const SECOND_KEY = apiKeyOf(2, { name: '紹介サイト' });
const ISSUED_KEY = apiKeyOf(3, { name: '新しい連携' });

const PLAIN_KEY = `lsk_${'Q'.repeat(43)}`;

const DESCRIPTION =
  'APIキーを使うと、公開APIからプロダクトなどの公開データを読み取ったり、自分のプロフィールとプロダクトの説明文を更新したりできます。';
const SUSPENDED_NOTICE =
  'このアカウントは停止されているため、APIキーの発行・編集・再発行はできません。発行済みのキーは削除できます。';
const NOT_FOUND_MESSAGE = 'APIキーが見つかりませんでした。一覧を更新しました。';
const RATE_LIMIT_MESSAGE =
  '操作が集中しています。しばらく待ってから再度お試しください。';
const LOAD_ERROR =
  'APIキーを読み込めませんでした。時間をおいて再度お試しください。';

type Handler = (variables: unknown) => Promise<unknown>;

const ok = (data: unknown) => Promise.resolve({ ok: true, data });

const failure = (code: string, status: number, message: string) =>
  Promise.resolve({
    ok: false,
    error: new GraphQLClientError({ code, message, status }),
  });

const listOf = (apiKeys: readonly ApiKeyFieldsFragment[]) =>
  ({
    myApiKeys: {
      nodes: [...apiKeys],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  }) satisfies ClientMyApiKeysQuery;

// 一覧の取得は、その時点のサーバーのキーを返す
let serverKeys: readonly ApiKeyFieldsFragment[] = [];

function respond(handlers: ReadonlyMap<unknown, Handler>): void {
  executeGraphQL.mockImplementation((document: unknown, variables: unknown) => {
    if (document === ClientMyApiKeysDocument) {
      return ok(listOf(serverKeys));
    }
    const handler = handlers.get(document);
    if (handler === undefined) {
      return Promise.reject(new Error('想定していない操作が実行されました。'));
    }
    return handler(variables);
  });
}

const callsOf = (target: unknown) =>
  executeGraphQL.mock.calls.filter(([document]) => document === target);

interface RenderOptions {
  readonly suspended?: boolean;
  // 未指定なら経路のloaderが取得を済ませた状態にする
  readonly cached?: readonly ApiKeyFieldsFragment[] | null;
}

// アプリでは文書の外枠がトーストの置き場を持つため、テストでは隣に置く
const renderPage = async ({
  suspended = false,
  cached = [FIRST_KEY, SECOND_KEY],
}: RenderOptions = {}): Promise<QueryClient> => {
  const context = createPageRouterContext('local');
  if (cached !== null) {
    serverKeys = cached;
    context.queryClient.setQueryData(
      myApiKeysQueryOptions(VIEWER_ID).queryKey,
      { pages: [listOf(cached)], pageParams: [null] },
    );
  }
  await renderInRouter(
    <DisplayPreferencesProvider initial={DISPLAY}>
      <main className="bg-background p-4 text-foreground">
        <ApiKeySettingsPage viewerId={VIEWER_ID} suspended={suspended} />
      </main>
    </DisplayPreferencesProvider>,
    {
      path: '/settings/api-keys',
      context,
      cachedViewer: signedInViewerQuery({
        status: suspended ? 'SUSPENDED' : 'ACTIVE',
      }),
    },
  );
  await render(<Toaster />);
  return context.queryClient;
};

const heading = () => page.getByRole('heading', { level: 1, name: 'APIキー' });
const notice = () => page.getByRole('note', { name: '停止中のアカウント' });
const issueButton = () => page.getByRole('button', { name: 'APIキーを発行' });
const list = () => page.getByRole('list', { name: 'APIキーの一覧' });
// ダイアログを開いている間と閉じる動きの間は外側が支援技術から隠れるため、役割ではなく一覧の名前の属性で探す
const itemNames = () =>
  Array.from(
    document.querySelectorAll('ul[aria-label="APIキーの一覧"] h2'),
    (element) => element.textContent,
  );
const actionButton = (action: '編集' | '再発行' | '削除', name: string) =>
  page.getByRole('button', { name: `${name}を${action}` });
const formDialog = (title: string) => page.getByRole('dialog', { name: title });
const confirmDialog = (title: string) =>
  page.getByRole('dialog', { name: title });
const issuedDialog = () => page.getByRole('dialog', { name: '新しいAPIキー' });
const plainKeyInput = () =>
  issuedDialog().getByRole('textbox', { name: 'APIキー' });

const deleteTitleOf = (name: string) => `APIキー『${name}』を削除しますか?`;
const reissueTitleOf = (name: string) => `APIキー『${name}』を再発行しますか?`;

const expectNoPlainKeyKept = (queryClient: QueryClient): void => {
  expect(document.documentElement.outerHTML).not.toContain(PLAIN_KEY);
  const values = Array.from(document.querySelectorAll('input')).map(
    (input) => input.value,
  );
  expect(values).not.toContain(PLAIN_KEY);
  const cached = queryClient
    .getQueryCache()
    .getAll()
    .map((query) => JSON.stringify(query.state.data ?? null));
  expect(cached.join('')).not.toContain(PLAIN_KEY);
};

// 平文を持つ変更の記録は、結果を捨てた後のタイマーで消える
const expectNoPlainKeyInMutations = async (
  queryClient: QueryClient,
): Promise<void> => {
  await expect
    .poll(() =>
      queryClient
        .getMutationCache()
        .getAll()
        .map((mutation) => JSON.stringify(mutation.state.data ?? null))
        .join(''),
    )
    .not.toContain(PLAIN_KEY);
};

const openIssueForm = async (): Promise<void> => {
  await userEvent.click(issueButton());
  await expect.element(formDialog('APIキーを発行')).toBeVisible();
  await userEvent.fill(
    formDialog('APIキーを発行').getByRole('textbox', { name: '名前(必須)' }),
    ISSUED_KEY.name,
  );
};

const submitIssueForm = () =>
  userEvent.click(
    formDialog('APIキーを発行').getByRole('button', { name: '発行' }),
  );

beforeEach(() => {
  executeGraphQL.mockReset();
  serverKeys = [];
  respond(new Map());
});

afterEach(() => {
  toast.dismiss();
  applyColorScheme('light');
});

describe('APIキーの設定の画面', () => {
  test('題名の下に説明と「APIドキュメント」への導線、「APIキーを発行」、APIキーの一覧を順に置く', async () => {
    await renderPage();

    await expect.element(heading()).toBeVisible();
    const description = page.getByText(DESCRIPTION);
    await expect.element(description).toBeVisible();
    await expect
      .element(page.getByRole('link', { name: 'APIドキュメント' }))
      .toHaveAttribute('href', '/api-docs');
    await expect.element(issueButton()).toBeEnabled();
    expect(itemNames()).toStrictEqual(['集計スクリプト', '紹介サイト']);
    const order = [
      heading().element(),
      description.element(),
      issueButton().element(),
      list().element(),
    ];
    for (const [index, element] of order.slice(1).entries()) {
      expect(
        order[index]?.compareDocumentPosition(element) ??
          Node.DOCUMENT_POSITION_PRECEDING,
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
    expect(notice().elements()).toHaveLength(0);
  });

  test('一覧の最初の取得に失敗したら失敗の文言と再試行を示し、再試行で取り直して題名へフォーカスを移す', async () => {
    let failing = true;
    executeGraphQL.mockImplementation((document: unknown) =>
      document === ClientMyApiKeysDocument && failing
        ? failure('internal_error', 500, 'エラーが発生しました。')
        : ok(listOf([FIRST_KEY])),
    );
    await renderPage({ cached: null });

    await expect.element(page.getByRole('alert')).toHaveTextContent(LOAD_ERROR);
    failing = false;
    await userEvent.click(page.getByRole('button', { name: '再試行' }));

    await expect.element(heading()).toHaveFocus();
    await expect.element(list()).toBeVisible();
    expect(itemNames()).toStrictEqual(['集計スクリプト']);
  });
});

describe('停止中の利用者', () => {
  test('題名の直下に停止中の案内を示し、発行・編集・再発行を無効にして、削除は押せるままにする', async () => {
    await renderPage({ suspended: true });

    await expect.element(notice()).toHaveTextContent(SUSPENDED_NOTICE);
    expect(heading().element().nextElementSibling).toBe(notice().element());
    await expect.element(issueButton()).toBeDisabled();
    for (const name of ['集計スクリプト', '紹介サイト']) {
      await expect.element(actionButton('編集', name)).toBeDisabled();
      await expect.element(actionButton('再発行', name)).toBeDisabled();
      await expect.element(actionButton('削除', name)).toBeEnabled();
    }
  });

  test('キーを削除でき、削除した旨を知らせて一覧を取り直し、消えたボタンの代わりに題名へフォーカスを移す', async () => {
    respond(
      new Map([
        [
          ClientDeleteApiKeyDocument,
          () => {
            serverKeys = [SECOND_KEY];
            return ok({ deleteApiKey: FIRST_KEY.id });
          },
        ],
      ]),
    );
    await renderPage({ suspended: true });

    await userEvent.click(actionButton('削除', '集計スクリプト'));
    await userEvent.click(
      confirmDialog(deleteTitleOf('集計スクリプト')).getByRole('button', {
        name: '削除',
      }),
    );

    await expect
      .element(page.getByText('APIキーを削除しました。'))
      .toBeVisible();
    await expect.poll(itemNames).toStrictEqual(['紹介サイト']);
    await expect.element(heading()).toHaveFocus();
    expect(callsOf(ClientDeleteApiKeyDocument)[0]?.[1]).toStrictEqual({
      id: FIRST_KEY.id,
    });
  });
});

describe('発行', () => {
  test('発行に成功したらフォームを閉じて平文のダイアログを開き、一覧を取り直す', async () => {
    respond(
      new Map([
        [
          ClientIssueApiKeyDocument,
          () => {
            serverKeys = [ISSUED_KEY, FIRST_KEY, SECOND_KEY];
            return ok({
              issueApiKey: { apiKey: ISSUED_KEY, plainKey: PLAIN_KEY },
            });
          },
        ],
      ]),
    );
    await renderPage();

    await openIssueForm();
    await submitIssueForm();

    await expect.element(plainKeyInput()).toHaveValue(PLAIN_KEY);
    await expect.element(formDialog('APIキーを発行')).not.toBeInTheDocument();
    await expect.element(plainKeyInput()).toHaveFocus();
    await expect
      .poll(itemNames)
      .toStrictEqual(['新しい連携', '集計スクリプト', '紹介サイト']);
    expect(callsOf(ClientIssueApiKeyDocument)[0]?.[1]).toMatchObject({
      input: { name: '新しい連携' },
    });
  });

  test('平文のダイアログを閉じると平文を画面・取得のキャッシュ・変更の記録に残さず、フォーカスを「APIキーを発行」へ戻す', async () => {
    respond(
      new Map([
        [
          ClientIssueApiKeyDocument,
          () =>
            ok({ issueApiKey: { apiKey: ISSUED_KEY, plainKey: PLAIN_KEY } }),
        ],
      ]),
    );
    const queryClient = await renderPage();
    await openIssueForm();
    await submitIssueForm();
    await expect.element(plainKeyInput()).toHaveValue(PLAIN_KEY);

    await userEvent.click(
      issuedDialog().getByRole('button', { name: '閉じる' }),
    );

    await expect.element(issuedDialog()).not.toBeInTheDocument();
    await expect.element(issueButton()).toHaveFocus();
    expectNoPlainKeyKept(queryClient);
    await expectNoPlainKeyInMutations(queryClient);
  });

  test('発行の回数の上限(429)はフォームにレート制限の文言を示し、フォームを開いたままにする', async () => {
    respond(
      new Map([
        [
          ClientIssueApiKeyDocument,
          () =>
            failure(
              'rate_limit_exceeded',
              429,
              '発行の回数の上限を超えました。',
            ),
        ],
      ]),
    );
    await renderPage();

    await openIssueForm();
    await submitIssueForm();

    await expect
      .element(formDialog('APIキーを発行').getByRole('alert'))
      .toHaveTextContent(RATE_LIMIT_MESSAGE);
    expect(issuedDialog().elements()).toHaveLength(0);
  });

  test('停止中と分かったらフォームを閉じて停止中の案内を示し、発行・編集・再発行を無効にして案内へフォーカスを移す', async () => {
    respond(
      new Map([
        [
          ClientIssueApiKeyDocument,
          () =>
            failure(
              'account_unavailable',
              403,
              'このアカウントは利用できません。',
            ),
        ],
      ]),
    );
    await renderPage();

    await openIssueForm();
    await submitIssueForm();

    await expect.element(formDialog('APIキーを発行')).not.toBeInTheDocument();
    await expect.element(notice()).toHaveTextContent(SUSPENDED_NOTICE);
    await expect.element(notice()).toHaveFocus();
    await expect.element(issueButton()).toBeDisabled();
    await expect.element(actionButton('編集', '集計スクリプト')).toBeDisabled();
    await expect
      .element(actionButton('再発行', '集計スクリプト'))
      .toBeDisabled();
    await expect.element(actionButton('削除', '集計スクリプト')).toBeEnabled();
  });
});

describe('編集', () => {
  test('保存に成功したらフォームを閉じて保存した旨を知らせ、一覧を取り直し、フォーカスを「編集」へ戻す', async () => {
    const renamed = { ...FIRST_KEY, name: '週次の集計' };
    respond(
      new Map([
        [
          ClientUpdateApiKeyDocument,
          () => {
            serverKeys = [renamed, SECOND_KEY];
            return ok({ updateApiKey: renamed });
          },
        ],
      ]),
    );
    await renderPage();

    await userEvent.click(actionButton('編集', '集計スクリプト'));
    const form = formDialog('APIキーを編集');
    await userEvent.fill(
      form.getByRole('textbox', { name: '名前(必須)' }),
      '週次の集計',
    );
    await userEvent.click(form.getByRole('button', { name: '保存' }));

    await expect
      .element(page.getByText('APIキーを保存しました。'))
      .toBeVisible();
    await expect.poll(itemNames).toStrictEqual(['週次の集計', '紹介サイト']);
    await expect.element(form).not.toBeInTheDocument();
    await expect.element(actionButton('編集', '週次の集計')).toHaveFocus();
    expect(callsOf(ClientUpdateApiKeyDocument)[0]?.[1]).toMatchObject({
      id: FIRST_KEY.id,
      input: { name: '週次の集計' },
    });
  });

  test('対象のキーが見つからなければフォームを閉じて一覧を取り直し、その旨を知らせて題名へフォーカスを移す', async () => {
    respond(
      new Map([
        [
          ClientUpdateApiKeyDocument,
          () => {
            serverKeys = [SECOND_KEY];
            return failure(
              'api_key_not_found',
              404,
              'APIキーが見つかりません。',
            );
          },
        ],
      ]),
    );
    await renderPage();

    await userEvent.click(actionButton('編集', '集計スクリプト'));
    await userEvent.click(
      formDialog('APIキーを編集').getByRole('button', { name: '保存' }),
    );

    await expect.element(page.getByText(NOT_FOUND_MESSAGE)).toBeVisible();
    await expect.poll(itemNames).toStrictEqual(['紹介サイト']);
    await expect.element(formDialog('APIキーを編集')).not.toBeInTheDocument();
    await expect.element(heading()).toHaveFocus();
  });
});

describe('再発行', () => {
  const reissueFirstKey = async (): Promise<void> => {
    await userEvent.click(actionButton('再発行', '集計スクリプト'));
    await userEvent.click(
      confirmDialog(reissueTitleOf('集計スクリプト')).getByRole('button', {
        name: '再発行',
      }),
    );
  };

  test('再発行に成功したら確認を閉じて平文のダイアログを開き、フォーカスを平文のダイアログの中に残して一覧を取り直す', async () => {
    const reissued = apiKeyOf(4, { name: '集計スクリプト' });
    respond(
      new Map([
        [
          ClientReissueApiKeyDocument,
          () => {
            serverKeys = [reissued, FIRST_KEY, SECOND_KEY];
            return ok({
              reissueApiKey: { apiKey: reissued, plainKey: PLAIN_KEY },
            });
          },
        ],
      ]),
    );
    const queryClient = await renderPage();

    await reissueFirstKey();

    await expect.element(plainKeyInput()).toHaveValue(PLAIN_KEY);
    await expect
      .element(confirmDialog(reissueTitleOf('集計スクリプト')))
      .not.toBeInTheDocument();
    expect(
      issuedDialog().element().contains(document.activeElement),
    ).toBeTruthy();
    await expect
      .poll(itemNames)
      .toStrictEqual(['集計スクリプト', '集計スクリプト', '紹介サイト']);

    await userEvent.keyboard('{Escape}');

    await expect.element(issuedDialog()).not.toBeInTheDocument();
    // 発行の新しい順のため、押した元のキーは新しいキーの後ろに並ぶ
    await expect
      .element(actionButton('再発行', '集計スクリプト').nth(1))
      .toHaveFocus();
    expectNoPlainKeyKept(queryClient);
    await expectNoPlainKeyInMutations(queryClient);
  });

  test('再発行の回数の上限(429)は、確認を閉じてレート制限の文言をトーストで示す', async () => {
    respond(
      new Map([
        [
          ClientReissueApiKeyDocument,
          () =>
            failure(
              'rate_limit_exceeded',
              429,
              '発行の回数の上限を超えました。',
            ),
        ],
      ]),
    );
    await renderPage();

    await reissueFirstKey();

    await expect.element(page.getByText(RATE_LIMIT_MESSAGE)).toBeVisible();
    await expect
      .element(confirmDialog(reissueTitleOf('集計スクリプト')))
      .not.toBeInTheDocument();
    expect(issuedDialog().elements()).toHaveLength(0);
  });

  test('対象のキーが見つからなければ確認を閉じて一覧を取り直し、その旨を知らせて題名へフォーカスを移す', async () => {
    respond(
      new Map([
        [
          ClientReissueApiKeyDocument,
          () => {
            serverKeys = [SECOND_KEY];
            return failure(
              'api_key_not_found',
              404,
              'APIキーが見つかりません。',
            );
          },
        ],
      ]),
    );
    await renderPage();

    await reissueFirstKey();

    await expect.element(page.getByText(NOT_FOUND_MESSAGE)).toBeVisible();
    await expect.poll(itemNames).toStrictEqual(['紹介サイト']);
    await expect.element(heading()).toHaveFocus();
    expect(issuedDialog().elements()).toHaveLength(0);
  });

  test('停止中と分かったら確認を閉じて停止中の案内を示し、無効になった「再発行」の代わりに案内へフォーカスを移す', async () => {
    respond(
      new Map([
        [
          ClientReissueApiKeyDocument,
          () =>
            failure(
              'account_unavailable',
              403,
              'このアカウントは利用できません。',
            ),
        ],
      ]),
    );
    await renderPage();

    await reissueFirstKey();

    await expect.element(notice()).toHaveTextContent(SUSPENDED_NOTICE);
    await expect.element(notice()).toHaveFocus();
    await expect
      .element(actionButton('再発行', '集計スクリプト'))
      .toBeDisabled();
    await expect.element(issueButton()).toBeDisabled();
    expect(
      page.getByText('このアカウントは利用できません。').elements(),
    ).toHaveLength(0);
  });
});

describe('削除', () => {
  test('対象のキーが見つからなければ確認を閉じて一覧を取り直し、その旨を知らせて題名へフォーカスを移す', async () => {
    respond(
      new Map([
        [
          ClientDeleteApiKeyDocument,
          () => {
            serverKeys = [SECOND_KEY];
            return failure(
              'api_key_not_found',
              404,
              'APIキーが見つかりません。',
            );
          },
        ],
      ]),
    );
    await renderPage();

    await userEvent.click(actionButton('削除', '集計スクリプト'));
    await userEvent.click(
      confirmDialog(deleteTitleOf('集計スクリプト')).getByRole('button', {
        name: '削除',
      }),
    );

    await expect.element(page.getByText(NOT_FOUND_MESSAGE)).toBeVisible();
    await expect.poll(itemNames).toStrictEqual(['紹介サイト']);
    await expect.element(heading()).toHaveFocus();
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  beforeEach(() => {
    applyColorScheme(scheme);
  });

  test.each([
    ['通常の', false],
    ['停止中の', true],
  ])(
    '%s画面で、アクセシビリティの検査の違反が0件',
    async (_label, suspended) => {
      await renderPage({ suspended });
      await expect.element(list()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test('平文のダイアログを開いた画面で、アクセシビリティの検査の違反が0件', async () => {
    respond(
      new Map([
        [
          ClientIssueApiKeyDocument,
          () =>
            ok({ issueApiKey: { apiKey: ISSUED_KEY, plainKey: PLAIN_KEY } }),
        ],
      ]),
    );
    await renderPage();
    await openIssueForm();
    await submitIssueForm();
    await expect.element(plainKeyInput()).toHaveValue(PLAIN_KEY);

    expect(await runAxe(issuedDialog().element())).toStrictEqual([]);
  });
});
