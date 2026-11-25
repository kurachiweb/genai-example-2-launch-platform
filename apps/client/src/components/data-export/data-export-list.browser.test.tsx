import { useId, useRef } from 'react';
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
import { LIVE_REFRESH_INTERVAL_MS } from '../../../lib/utilities/query/live-refresh.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import {
  ClientMyDataExportsDocument,
  type DataExportFieldsFragment,
} from '../../graphql/generated/graphql.ts';
import { DataExportList } from './data-export-list.tsx';
import {
  expiredExportOf,
  failedExportOf,
  pendingExportOf,
  readyExportOf,
} from './data-export-fixtures.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const TOKYO_JA: DisplayPreferences = {
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
};

const PAGE_SIZE = 20;
const HEADING = 'データエクスポート';
const VIEWER_ID = signedInViewerQuery().viewer?.id ?? '';
const LOAD_ERROR =
  'エクスポートの一覧を読み込めませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。';

const LOAD_FAILURE = new GraphQLClientError({
  code: 'internal_error',
  message: 'サーバーでエラーが発生しました。',
  status: 500,
});

interface PageResponse {
  readonly nodes: readonly DataExportFieldsFragment[];
  readonly endCursor?: string | null;
}

const pageResult = ({ nodes, endCursor = null }: PageResponse) => ({
  ok: true,
  data: {
    myDataExports: {
      nodes,
      pageInfo: { hasNextPage: endCursor !== null, endCursor },
    },
  },
});

const readyItemsFrom = (from: number, count: number) =>
  Array.from({ length: count }, (_, offset) => readyExportOf(from + offset));

const respond = (
  handler: (variables: { readonly after?: string }) => Promise<unknown>,
): void => {
  executeGraphQL.mockImplementation(
    (_document: unknown, variables: { readonly after?: string }) =>
      handler(variables),
  );
};

const respondWith = (...nodes: readonly DataExportFieldsFragment[]): void => {
  respond(() => Promise.resolve(pageResult({ nodes })));
};

const listCalls = () =>
  executeGraphQL.mock.calls.filter(
    ([document]) => document === ClientMyDataExportsDocument,
  );

function Harness() {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  return (
    <DisplayPreferencesProvider initial={{ ...TOKYO_JA }}>
      <main className="bg-background p-4 text-foreground">
        <h1 id={headingId} ref={headingRef} tabIndex={-1}>
          {HEADING}
        </h1>
        <DataExportList
          viewerId={VIEWER_ID}
          labelledBy={headingId}
          retryFocusRef={headingRef}
        />
        <button type="button">ページの他の操作</button>
      </main>
    </DisplayPreferencesProvider>
  );
}

const renderList = () =>
  renderInRouter(<Harness />, {
    path: '/settings/export',
    cachedViewer: signedInViewerQuery(),
  });

const main = () => page.getByRole('main');
const heading = () => main().getByRole('heading', { level: 1 });
const entries = () => main().getByRole('listitem');
const loadMoreButton = () => main().getByRole('button', { name: 'さらに表示' });
const autoRefreshSwitch = () =>
  main().getByRole('switch', { name: '自動更新' });

beforeEach(async () => {
  executeGraphQL.mockReset();
  await emulateBrowserDisplay(TOKYO_JA);
});

afterEach(async () => {
  vi.useRealTimers();
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('DataExportList', () => {
  test('4つの状態の要求を、取得した順のまま、状態の文言とともに並べる', async () => {
    respondWith(
      pendingExportOf(1),
      readyExportOf(2),
      expiredExportOf(3),
      failedExportOf(4, 'TOO_LARGE'),
    );

    await renderList();

    await expect.poll(() => entries().elements()).toHaveLength(4);
    await expect.element(entries().nth(0)).toHaveTextContent('作成中');
    await expect.element(entries().nth(1)).toHaveTextContent('完了');
    await expect.element(entries().nth(2)).toHaveTextContent('期限切れ');
    await expect.element(entries().nth(3)).toHaveTextContent('失敗');
    await expect
      .element(main().getByRole('list', { name: HEADING }))
      .toBeVisible();
    expect(
      main()
        .getByRole('link', { name: /^ダウンロード/u })
        .elements(),
    ).toHaveLength(1);
  });

  test('読み込み中は、状態の領域に読み込み中の文言を示す', async () => {
    const pending = Promise.withResolvers<unknown>();
    respond(() => pending.promise);

    await renderList();

    await expect
      .element(main().getByRole('status'))
      .toHaveTextContent('読み込み中');

    pending.resolve(pageResult({ nodes: [readyExportOf(1)] }));
    await expect.poll(() => entries().elements()).toHaveLength(1);
  });

  test('最初は20件を読み、「さらに表示」で続きを後ろに加えて、加えた最初の項目へフォーカスを移す', async () => {
    const pending = Promise.withResolvers<unknown>();
    respond((variables) =>
      variables.after === undefined
        ? Promise.resolve(
            pageResult({
              nodes: readyItemsFrom(0, PAGE_SIZE),
              endCursor: 'cursor-2',
            }),
          )
        : pending.promise,
    );

    await renderList();

    await expect.poll(() => entries().elements()).toHaveLength(PAGE_SIZE);
    expect(executeGraphQL).toHaveBeenCalledWith(
      ClientMyDataExportsDocument,
      { first: PAGE_SIZE },
      expect.anything(),
    );

    await userEvent.click(loadMoreButton());

    const busy = main().getByRole('button', { name: '読み込み中' });
    await expect.element(busy).toHaveAttribute('aria-busy', 'true');
    await expect.element(busy).toHaveAttribute('aria-disabled', 'true');
    expect(executeGraphQL).toHaveBeenCalledWith(
      ClientMyDataExportsDocument,
      { first: PAGE_SIZE, after: 'cursor-2' },
      expect.anything(),
    );

    pending.resolve(pageResult({ nodes: readyItemsFrom(PAGE_SIZE, 1) }));

    await expect.poll(() => entries().elements()).toHaveLength(PAGE_SIZE + 1);
    await expect.element(entries().nth(PAGE_SIZE)).toHaveFocus();
    expect(loadMoreButton().elements()).toHaveLength(0);
  });

  test('続きが無ければ「さらに表示」を置かない', async () => {
    respondWith(readyExportOf(1));

    await renderList();

    await expect.poll(() => entries().elements()).toHaveLength(1);
    expect(loadMoreButton().elements()).toHaveLength(0);
  });

  test('続きの読み込みの失敗は、読み込んだ項目と「さらに表示」を残したままボタンの上に示し、同じボタンで読み込み直せる', async () => {
    let failing = true;
    respond((variables) =>
      Promise.resolve(
        variables.after === undefined
          ? pageResult({ nodes: [readyExportOf(1)], endCursor: 'cursor-2' })
          : failing
            ? { ok: false, error: LOAD_FAILURE }
            : pageResult({ nodes: [readyExportOf(2)] }),
      ),
    );
    await renderList();
    await expect.poll(() => entries().elements()).toHaveLength(1);

    await userEvent.click(loadMoreButton());

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(LOAD_FAILURE.message);
    expect(entries().elements()).toHaveLength(1);
    await expect.element(loadMoreButton()).toBeVisible();

    failing = false;
    await userEvent.click(loadMoreButton());

    await expect.poll(() => entries().elements()).toHaveLength(2);
    expect(main().getByRole('alert').elements()).toHaveLength(0);
  });

  test('0件は、要求が無い旨だけを示し、一覧と「自動更新」を置かない', async () => {
    respondWith();

    await renderList();

    await expect
      .element(main().getByText('まだエクスポートを要求していません。'))
      .toBeVisible();
    expect(main().getByRole('list').elements()).toHaveLength(0);
    expect(autoRefreshSwitch().elements()).toHaveLength(0);
  });

  test('最初の取得の失敗は、題名を残したまま一覧の区画の中に示し、再試行で題名へフォーカスを移して取得し直す', async () => {
    let failing = true;
    respond(() =>
      Promise.resolve(
        failing
          ? { ok: false, error: LOAD_FAILURE }
          : pageResult({ nodes: [readyExportOf(1)] }),
      ),
    );

    await renderList();

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(LOAD_ERROR);
    await expect.element(heading()).toHaveTextContent(HEADING);

    failing = false;
    await userEvent.click(main().getByRole('button', { name: '再試行' }));

    await expect.poll(() => entries().elements()).toHaveLength(1);
    await expect.element(heading()).toHaveFocus();
  });

  test('GraphQLClientErrorでない例外でも、例外の文言を出さずに一覧の取得エラーの文言で示す', async () => {
    respond(() => Promise.reject(new Error('内部の詳細な失敗の理由')));

    await renderList();

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(LOAD_ERROR);
    expect(main().element().textContent).not.toContain(
      '内部の詳細な失敗の理由',
    );
  });

  describe('作成中の要求がある間の取り直し', () => {
    test('「自動更新」のスイッチをオンから始め、間隔の説明を`aria-describedby`で結び付け、定期再取得の間隔ごとに取り直す', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      respondWith(pendingExportOf(1));

      await renderList();

      await expect.element(autoRefreshSwitch()).toBeChecked();
      const seconds = String(LIVE_REFRESH_INTERVAL_MS / 1000);
      await expect
        .element(autoRefreshSwitch())
        .toHaveAccessibleDescription(
          `オンの間は${seconds}秒ごとに一覧を取り直し、作成中の要求の状態を反映します。`,
        );
      expect(listCalls()).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS - 1);
      expect(listCalls()).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);

      await expect.poll(() => listCalls().length).toBe(2);
    });

    test('読み込んだ全てのページを取り直し、完了へ変わった項目を示して、「自動更新」を消し、取り直しを止める', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      let completed = false;
      respond((variables) =>
        Promise.resolve(
          variables.after === undefined
            ? pageResult({
                nodes: [
                  completed ? readyExportOf(1) : pendingExportOf(1),
                  readyExportOf(2),
                ],
                endCursor: 'cursor-2',
              })
            : pageResult({ nodes: [readyExportOf(3)] }),
        ),
      );
      await renderList();
      await expect.poll(() => entries().elements()).toHaveLength(2);
      await userEvent.click(loadMoreButton());
      await expect.poll(() => entries().elements()).toHaveLength(3);
      const callsBefore = listCalls().length;

      completed = true;
      await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS);

      await expect.poll(() => listCalls().slice(callsBefore).length).toBe(2);
      await expect.element(entries().nth(0)).toHaveTextContent('完了');
      expect(autoRefreshSwitch().elements()).toHaveLength(0);
      const settled = listCalls().length;
      await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 3);
      expect(listCalls()).toHaveLength(settled);
    });

    test('スイッチを切ると、間隔の数倍進めても取り直さない', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      respondWith(pendingExportOf(1));
      await renderList();
      await expect.element(autoRefreshSwitch()).toBeChecked();

      await userEvent.click(autoRefreshSwitch());

      await expect.element(autoRefreshSwitch()).not.toBeChecked();
      const callsAtOff = listCalls().length;
      await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 3);
      expect(listCalls()).toHaveLength(callsAtOff);

      await userEvent.click(autoRefreshSwitch());
      await expect.element(autoRefreshSwitch()).toBeChecked();
      await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS);
      await expect.poll(() => listCalls().length).toBe(callsAtOff + 1);
    });

    test('作成中が無ければ、「自動更新」を置かず、間隔の数倍進めても取り直さない', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      respondWith(readyExportOf(1), expiredExportOf(2), failedExportOf(3));
      await renderList();
      await expect.poll(() => entries().elements()).toHaveLength(3);

      await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 3);

      expect(autoRefreshSwitch().elements()).toHaveLength(0);
      expect(listCalls()).toHaveLength(1);
    });
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('4つの状態・自動更新・続きの読み込みの表示で、アクセシビリティの検査の違反が0件', async () => {
      respond(() =>
        Promise.resolve(
          pageResult({
            nodes: [
              pendingExportOf(1),
              readyExportOf(2),
              expiredExportOf(3),
              failedExportOf(4, 'ERROR'),
              failedExportOf(5, 'TOO_LARGE'),
            ],
            endCursor: 'cursor-2',
          }),
        ),
      );
      await renderList();
      await expect.element(loadMoreButton()).toBeVisible();
      await expect.element(autoRefreshSwitch()).toBeVisible();

      expect(await runAxe(main().element())).toStrictEqual([]);
    });

    test('0件の表示で、アクセシビリティの検査の違反が0件', async () => {
      respondWith();
      await renderList();
      await expect
        .element(main().getByText('まだエクスポートを要求していません。'))
        .toBeVisible();

      expect(await runAxe(main().element())).toStrictEqual([]);
    });

    test('取得の失敗の表示で、アクセシビリティの検査の違反が0件', async () => {
      respond(() => Promise.resolve({ ok: false, error: LOAD_FAILURE }));
      await renderList();
      await expect.element(main().getByRole('alert')).toBeVisible();

      expect(await runAxe(main().element())).toStrictEqual([]);
    });
  });
});
