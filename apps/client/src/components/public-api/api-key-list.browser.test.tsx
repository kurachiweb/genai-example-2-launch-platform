import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import type { DisplayPreferences } from '../../../lib/utilities/datetime/display-preferences.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { UNEXPECTED_ERROR_MESSAGE } from '../../../lib/utilities/messages/state-messages.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import type { ApiKeyFieldsFragment } from '../../graphql/generated/graphql.ts';
import { apiKeyOf, apiKeysOf } from './api-key-list-fixtures.ts';
import type {
  ApiKeyActionRequest,
  ApiKeyDisabledActions,
} from './api-key-list-item.tsx';
import { ApiKeyList } from './api-key-list.tsx';

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const TOKYO_JA: DisplayPreferences = {
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
};

const LOAD_ERROR =
  'APIキーを読み込めませんでした。時間をおいて再度お試しください。';
const EMPTY_TITLE = 'APIキーはまだありません。';
const EMPTY_DESCRIPTION =
  'APIキーを発行すると、公開APIでプロダクト・ローンチ履歴・Upvote・コメント・評価・公開プロフィールを読み取り、自分のプロフィールとプロダクトの説明文を更新できます。';
const HEADING = 'APIキー';

interface Page {
  readonly apiKeys: readonly ApiKeyFieldsFragment[];
  readonly hasNextPage: boolean;
}

interface HarnessProps {
  readonly initial?: readonly ApiKeyFieldsFragment[] | undefined;
  readonly hasNextPage?: boolean;
  readonly loadFailed?: boolean;
  readonly onRetry?: () => void;
  // 続きの読み込みの結果。拒否は続きの読み込みの失敗
  readonly loadNext?: () => Promise<Page>;
  readonly disabledActions?: ApiKeyDisabledActions;
  readonly onAction?: (request: ApiKeyActionRequest) => void;
}

// 6.5で無限の取得の状態を渡す形を、取得の結果を差し替えられる状態で再現する
function Harness({
  initial,
  hasNextPage = false,
  loadFailed = false,
  onRetry = vi.fn(),
  loadNext = () => Promise.reject(new Error('未設定')),
  disabledActions,
  onAction = vi.fn(),
}: HarnessProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [apiKeys, setApiKeys] = useState(initial);
  const [nextExists, setNextExists] = useState(hasNextPage);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<Error | null>(null);

  return (
    <DisplayPreferencesProvider initial={{ ...TOKYO_JA }}>
      <main className="bg-background p-4 text-foreground">
        <h1 ref={headingRef} tabIndex={-1}>
          {HEADING}
        </h1>
        <ApiKeyList
          apiKeys={apiKeys}
          loadFailed={loadFailed}
          onRetry={onRetry}
          retryFocusRef={headingRef}
          hasNextPage={nextExists}
          loadingMore={loadingMore}
          loadMoreError={loadMoreError}
          onLoadMore={() => {
            setLoadingMore(true);
            loadNext().then(
              (next) => {
                setApiKeys((current) => [...(current ?? []), ...next.apiKeys]);
                setNextExists(next.hasNextPage);
                setLoadMoreError(null);
                setLoadingMore(false);
              },
              (error: unknown) => {
                setLoadMoreError(
                  error instanceof Error ? error : new Error(String(error)),
                );
                setLoadingMore(false);
              },
            );
          }}
          disabledActions={disabledActions}
          onAction={onAction}
        />
        <button type="button">ページの他の操作</button>
      </main>
    </DisplayPreferencesProvider>
  );
}

const renderList = (props: HarnessProps) =>
  renderInRouter(<Harness {...props} />, {
    path: '/settings/api-keys',
    cachedViewer: signedInViewerQuery(),
  });

interface Deferred {
  readonly promise: Promise<Page>;
  readonly resolve: (page: Page) => void;
  readonly reject: (error: Error) => void;
}

const deferredPage = (): Deferred => {
  const { promise, resolve, reject } = Promise.withResolvers<Page>();
  return { promise, resolve, reject };
};

const list = () => page.getByRole('list', { name: 'APIキーの一覧' });

const items = () => list().getByRole('listitem');

const itemHeadings = () =>
  list()
    .getByRole('heading', { level: 2 })
    .elements()
    .map((heading) => heading.textContent);

const loadMoreButton = () => page.getByRole('button', { name: 'さらに表示' });

const loadingMoreButton = () =>
  page.getByRole('button', { name: '読み込み中' });

beforeEach(async () => {
  await emulateBrowserDisplay(TOKYO_JA);
});

afterEach(async () => {
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('ApiKeyList', () => {
  test('最初の読み込み中は「APIキーを読み込み中」を状態の領域で伝える', async () => {
    await renderList({ initial: undefined });

    await expect
      .element(page.getByRole('status'))
      .toHaveTextContent('APIキーを読み込み中');
    expect(list().query()).toBeNull();
  });

  test('受け取った順(発行の新しい順)に、画面に見えない名前の一覧で並べる', async () => {
    const newest = apiKeyOf(3, {
      name: '新しいキー',
      createdAt: '2026-11-18T01:00:00.000Z',
    });
    const older = apiKeyOf(2, {
      name: '古いキー',
      createdAt: '2026-10-01T01:00:00.000Z',
    });
    await renderList({ initial: [newest, older] });

    await expect.element(list()).toBeVisible();
    expect(itemHeadings()).toStrictEqual(['新しいキー', '古いキー']);
    expect(loadMoreButton().query()).toBeNull();
  });

  test('0件は、キーが無い旨と公開APIでできることの説明、APIドキュメントへの導線を示す', async () => {
    await renderList({ initial: [] });

    await expect
      .element(page.getByText(EMPTY_TITLE, { exact: true }))
      .toBeVisible();
    await expect
      .element(page.getByText(EMPTY_DESCRIPTION, { exact: true }))
      .toBeVisible();
    await expect
      .element(page.getByRole('link', { name: 'APIドキュメントを見る' }))
      .toHaveAttribute('href', '/api-docs');
    expect(list().query()).toBeNull();
  });

  test('最初の取得の失敗は、一覧の位置の一部の失敗として固定の文言と再試行のボタンを示し、再試行で見出しへフォーカスを移して取り直す', async () => {
    const onRetry = vi.fn();
    await renderList({ initial: undefined, loadFailed: true, onRetry });

    await expect.element(page.getByRole('alert')).toHaveTextContent(LOAD_ERROR);
    expect(
      page.getByRole('alert').element().closest('[data-slot]'),
    ).toHaveAttribute('data-slot', 'partial-error-state');
    expect(page.getByRole('link', { name: 'お問い合わせ' }).query()).toBeNull();

    await page.getByRole('button', { name: '再試行' }).click();

    expect(onRetry).toHaveBeenCalledTimes(1);
    await expect
      .element(page.getByRole('heading', { level: 1, name: HEADING }))
      .toHaveFocus();
  });

  test('「さらに表示」で続きを後ろに加え、読み込み中は文言を変えて押しても読み込み直さず、加えた最初の項目へフォーカスを移す', async () => {
    const next = deferredPage();
    const loadNext = vi.fn(() => next.promise);
    await renderList({
      initial: apiKeysOf(1, 2),
      hasNextPage: true,
      loadNext,
    });

    await loadMoreButton().click();

    await expect
      .element(loadingMoreButton())
      .toHaveAttribute('aria-disabled', 'true');
    await expect
      .element(loadingMoreButton())
      .toHaveAttribute('aria-busy', 'true');
    await expect.element(loadingMoreButton()).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(loadNext).toHaveBeenCalledTimes(1);

    next.resolve({ apiKeys: apiKeysOf(3, 2), hasNextPage: true });

    await expect.element(loadMoreButton()).toBeVisible();
    expect(itemHeadings()).toStrictEqual([
      '連携ツール1',
      '連携ツール2',
      '連携ツール3',
      '連携ツール4',
    ]);
    await expect.element(items().nth(2)).toHaveFocus();
  });

  test('最後のページを読むと「さらに表示」を消し、フォーカスを加えた最初の項目へ移す', async () => {
    await renderList({
      initial: apiKeysOf(1, 2),
      hasNextPage: true,
      loadNext: () =>
        Promise.resolve({ apiKeys: apiKeysOf(3, 1), hasNextPage: false }),
    });

    await loadMoreButton().click();

    await expect.element(items().nth(2)).toHaveFocus();
    expect(loadMoreButton().query()).toBeNull();
  });

  test('読み込みを待つ間に「さらに表示」の外へ移したフォーカスは、読み込みの後も奪い返さない', async () => {
    const next = deferredPage();
    await renderList({
      initial: apiKeysOf(1, 2),
      hasNextPage: true,
      loadNext: () => next.promise,
    });
    const other = page.getByRole('button', { name: 'ページの他の操作' });

    await loadMoreButton().click();
    await other.click();
    next.resolve({ apiKeys: apiKeysOf(3, 1), hasNextPage: true });

    await expect.element(items().nth(2)).toBeVisible();
    await expect.element(other).toHaveFocus();
  });

  test.each([
    [
      'エラーコードを持つ失敗',
      new GraphQLClientError({
        code: 'service_unavailable',
        message: 'ただいまメンテナンス中です。',
        status: 503,
      }),
      'ただいまメンテナンス中です。',
    ],
    ['エラーコードを持たない失敗', new Error('切断'), UNEXPECTED_ERROR_MESSAGE],
  ])(
    '続きの読み込みの%sは、読み込んだ項目と「さらに表示」を残してボタンの上に文言を示し、同じボタンで読み込み直せる',
    async (_label, error, message) => {
      const loadNext = vi
        .fn<() => Promise<Page>>()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({
          apiKeys: apiKeysOf(3, 1),
          hasNextPage: false,
        });
      await renderList({
        initial: apiKeysOf(1, 2),
        hasNextPage: true,
        loadNext,
      });

      await loadMoreButton().click();

      await expect.element(page.getByRole('alert')).toHaveTextContent(message);
      expect(itemHeadings()).toStrictEqual(['連携ツール1', '連携ツール2']);
      await expect.element(loadMoreButton()).toHaveFocus();
      const alert = page.getByRole('alert').element();
      expect(
        alert.compareDocumentPosition(loadMoreButton().element()) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      await loadMoreButton().click();

      await expect.element(items().nth(2)).toHaveFocus();
      expect(page.getByRole('alert').query()).toBeNull();
    },
  );

  test('操作の無効化を全ての項目へ渡し、「削除」の押下は対象のキーとともに親へ渡す', async () => {
    const onAction = vi.fn<(request: ApiKeyActionRequest) => void>();
    const apiKeys = apiKeysOf(1, 2);
    await renderList({
      initial: apiKeys,
      disabledActions: { edit: true, reissue: true },
      onAction,
    });

    for (const { name } of apiKeys) {
      await expect
        .element(page.getByRole('button', { name: `${name}を編集` }))
        .toBeDisabled();
      await expect
        .element(page.getByRole('button', { name: `${name}を再発行` }))
        .toBeDisabled();
      await expect
        .element(page.getByRole('button', { name: `${name}を削除` }))
        .toBeEnabled();
    }

    await page.getByRole('button', { name: '連携ツール2を削除' }).click();

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0]?.[0]).toMatchObject({
      action: 'delete',
      apiKey: apiKeys[1],
    });
  });

  test('停止中でも「さらに表示」は押せる', async () => {
    await renderList({
      initial: apiKeysOf(1, 1),
      hasNextPage: true,
      disabledActions: { edit: true, reissue: true },
      loadNext: () =>
        Promise.resolve({ apiKeys: apiKeysOf(2, 1), hasNextPage: false }),
    });

    await userEvent.click(loadMoreButton());

    await expect.element(items().nth(1)).toHaveFocus();
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test.each<[string, HarnessProps]>([
      ['読み込み中', { initial: undefined }],
      ['0件', { initial: [] }],
      ['取得の失敗', { initial: undefined, loadFailed: true }],
      ['複数件', { initial: apiKeysOf(1, 3), hasNextPage: true }],
      [
        '停止中',
        {
          initial: apiKeysOf(1, 2),
          hasNextPage: true,
          disabledActions: { edit: true, reissue: true },
        },
      ],
    ])('%sの表示にアクセシビリティの違反が無い', async (_label, props) => {
      await renderList(props);

      await expect
        .element(page.getByRole('heading', { level: 1 }))
        .toBeVisible();
      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
