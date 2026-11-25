import { focusManager, notifyManager } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../src/styles.css';
import { runAxe } from '../lib/test/a11y.ts';
import { emulateBrowserDisplay } from '../lib/test/display-emulation.ts';
import { GraphQLClientError } from '../lib/utilities/graphql/graphql-result.ts';
import { LIVE_REFRESH_INTERVAL_MS } from '../lib/utilities/query/live-refresh.ts';
import {
  NOON,
  startClockAt,
  SYSTEM_NOTIFY_SCHEDULER,
  TOKYO_JA,
} from '../src/components/product-page/product-page-testing.tsx';
import {
  AWARDED_WEEK_BRACKET,
  WEEK_BRACKET_LABEL,
  WEEK_BRACKET_WEEK,
  weekBracketOf,
} from '../src/components/week-tournament/week-bracket-fixtures.ts';
import type { WeekBracketView } from '../src/components/week-tournament/week-bracket-model.ts';
import { ClientWeekBracketDocument } from '../src/graphql/generated/graphql.ts';
import { weekBracketQueryOptions } from '../src/graphql/week-tournament.ts';
import type {
  buildSitePageHead,
  WeekBracketHeadInput,
} from '../src/head/page-heads.ts';
import { Route as WeekBracketRoute } from '../src/routes/tournaments/week/$week.tsx';
import { renderPageRouter } from './page-router.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../lib/start/graphql/execute-graphql.ts', () => ({ executeGraphQL }));

vi.mock('../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

const PATH = `/tournaments/week/${WEEK_BRACKET_WEEK}`;

const PAGE_TITLE = `Product of the Weekトーナメント ${WEEK_BRACKET_LABEL}`;

const NOT_FOUND_TITLE = 'ページが見つかりません。';

const ERROR_MESSAGE =
  'ブラケットを読み込めませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。';

const INTERNAL_ERROR = {
  ok: false,
  error: new GraphQLClientError({
    code: 'internal_error',
    message: 'サーバーでエラーが発生しました。',
    status: 500,
  }),
} as const;

const ok = (data: unknown) => ({ ok: true, data });

// 照会ごとに順に返す結果。最後の結果を以後も返す
const respond = (...results: readonly (WeekBracketView | null)[]) => {
  let index = 0;
  executeGraphQL.mockImplementation((document: unknown) => {
    if (document !== ClientWeekBracketDocument) {
      return Promise.reject(new Error('想定外の文書の取得'));
    }
    const result = results[Math.min(index, results.length - 1)] ?? null;
    index += 1;
    return Promise.resolve(ok({ weekBracket: result }));
  });
};

const bracketCalls = () =>
  executeGraphQL.mock.calls.filter(
    ([called]) => called === ClientWeekBracketDocument,
  );

const bracketCallCount = () => bracketCalls().length;

type PageHead = (input: {
  loaderData: WeekBracketHeadInput | undefined;
}) => ReturnType<typeof buildSitePageHead>;

// アプリの経路と同じ取得・画面を通すため、本物の経路の設定を、画面のテスト用のルーターの同じパスの経路へ写す
const renderWeekBracket = (path: string) =>
  renderPageRouter({
    path,
    createRoutes: (rootRoute) => [
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/tournaments/week/$week',
        loader: WeekBracketRoute.options.loader,
        errorComponent: WeekBracketRoute.options.errorComponent,
        notFoundComponent: WeekBracketRoute.options.notFoundComponent,
        component: WeekBracketRoute.options.component,
      } as Parameters<typeof createRoute>[0]),
    ],
  });

const main = () => page.getByRole('main');
const autoRefreshSwitch = () =>
  main().getByRole('switch', { name: '自動更新' });
const pageTitle = () => main().getByRole('heading', { level: 1 });

const expectNotFound = async (): Promise<void> => {
  await expect.element(pageTitle()).toHaveTextContent(NOT_FOUND_TITLE);
  await expect
    .element(main().getByRole('link', { name: 'トップページへ' }))
    .toHaveAttribute('href', '/');
};

beforeEach(async () => {
  executeGraphQL.mockReset();
  await emulateBrowserDisplay(TOKYO_JA);
});

afterEach(async () => {
  vi.useRealTimers();
  notifyManager.setScheduler(SYSTEM_NOTIFY_SCHEDULER);
  vi.restoreAllMocks();
  await emulateBrowserDisplay(null);
});

describe('Weekトーナメントのブラケットの経路', () => {
  test('組み合わせを決定した週を、URLのISO週で照会してログインせずに表示する', async () => {
    respond(weekBracketOf());

    await renderWeekBracket(PATH);

    await expect.element(pageTitle()).toHaveTextContent(PAGE_TITLE);
    await expect.element(main().getByText('参加6・シード2')).toBeVisible();
    expect(bracketCallCount()).toBe(1);
    expect(bracketCalls()[0]?.[1]).toEqual({ week: WEEK_BRACKET_WEEK });
    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test('開催中の週は、自動更新の切り替えを含めてアクセシビリティの検査の違反が0件', async () => {
    respond(weekBracketOf());
    await renderWeekBracket(PATH);
    await expect.element(autoRefreshSwitch()).toBeVisible();

    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test('組み合わせを決定していない週・存在しない週(null)は、存在しないページの画面にする', async () => {
    respond(null);

    await renderWeekBracket('/tournaments/week/2026-W47');

    await expectNotFound();
    expect(bracketCallCount()).toBe(1);
    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test.each([
    '2026-w45',
    '2026-W54',
    '2026-W00',
    '2026-45',
    '0000-W01',
    'week',
  ])(
    '形式に合わない週・暦に無い週(%p)は照会せずに、存在しないページの画面にする',
    async (week) => {
      await renderWeekBracket(`/tournaments/week/${week}`);

      await expectNotFound();
      expect(executeGraphQL).not.toHaveBeenCalled();
    },
  );

  test('取得の失敗では、取得エラーの文言と再試行・問い合わせの導線を示し、再試行で表示し直して見出しへフォーカスを移す', async () => {
    executeGraphQL.mockResolvedValue(INTERNAL_ERROR);

    await renderWeekBracket(PATH);

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(ERROR_MESSAGE);
    await expect
      .element(main().getByRole('link', { name: 'お問い合わせ' }))
      .toHaveAttribute('href', '/contact');
    await expect
      .element(pageTitle())
      .toHaveTextContent('Product of the Weekトーナメント');
    expect(await runAxe(document.body)).toStrictEqual([]);

    respond(weekBracketOf());
    await userEvent.click(main().getByRole('button', { name: '再試行' }));

    await expect.element(pageTitle()).toHaveTextContent(PAGE_TITLE);
    await expect.element(pageTitle()).toHaveFocus();
    expect(main().getByRole('alert').query()).toBeNull();
  });
});

describe('Weekトーナメントのブラケットの定期再取得', () => {
  beforeEach(() => {
    notifyManager.setScheduler(queueMicrotask);
    startClockAt(NOON);
  });

  test('開催中の週は30秒ごとに取り直し、終了を受け取ったら取り直しを止めて受賞を示す', async () => {
    respond(weekBracketOf(), AWARDED_WEEK_BRACKET);
    await renderWeekBracket(PATH);
    await expect.element(pageTitle()).toHaveTextContent(PAGE_TITLE);
    expect(bracketCallCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS - 1);
    expect(bracketCallCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(1);

    await expect.poll(bracketCallCount).toBe(2);
    await expect
      .element(
        main().getByRole('heading', { level: 2, name: 'Product of the Week' }),
      )
      .toBeVisible();

    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 3);
    expect(bracketCallCount()).toBe(2);
  });

  test('終了した週は取り直さず、自動更新の切り替えも描かない', async () => {
    respond(AWARDED_WEEK_BRACKET);
    await renderWeekBracket(PATH);
    await expect.element(pageTitle()).toHaveTextContent(PAGE_TITLE);

    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 3);

    expect(bracketCallCount()).toBe(1);
    await expect.element(autoRefreshSwitch()).not.toBeInTheDocument();
  });

  test('開催中は自動更新の切り替えをオンで描き、オフにすると30秒の取り直しを止め、オンに戻すと再開する', async () => {
    respond(weekBracketOf());
    await renderWeekBracket(PATH);
    await expect.element(autoRefreshSwitch()).toBeChecked();

    await userEvent.click(autoRefreshSwitch());
    await expect.element(autoRefreshSwitch()).not.toBeChecked();
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 3);

    expect(bracketCallCount()).toBe(1);

    await userEvent.click(autoRefreshSwitch());
    await expect.element(autoRefreshSwitch()).toBeChecked();
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS);

    await expect.poll(bracketCallCount).toBe(2);
  });

  test('自動更新がオフでも、画面へ戻ったときは取り直す', async () => {
    respond(weekBracketOf());
    await renderWeekBracket(PATH);
    await userEvent.click(autoRefreshSwitch());
    await expect.element(autoRefreshSwitch()).not.toBeChecked();
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS);
    expect(bracketCallCount()).toBe(1);

    focusManager.setFocused(false);
    focusManager.setFocused(true);

    await expect.poll(bracketCallCount).toBe(2);
    focusManager.setFocused(undefined);
  });

  test('同じ経路のまま別の週へ移ると、ページを作り直して自動更新をオンから始める', async () => {
    respond(
      weekBracketOf(),
      weekBracketOf({
        tournament: { week: '2026-W44', label: '2026年第44週(10/26〜11/1)' },
      }),
    );
    const router = await renderWeekBracket(PATH);
    await userEvent.click(autoRefreshSwitch());
    await expect.element(autoRefreshSwitch()).not.toBeChecked();

    await router.navigate({ to: '/tournaments/week/2026-W44' } as never);

    await expect
      .element(pageTitle())
      .toHaveTextContent('2026年第44週(10/26〜11/1)');
    await expect.element(autoRefreshSwitch()).toBeChecked();
  });

  test('表示中の取り直しで週が見つからなくなったら、存在しないページの画面にする', async () => {
    respond(weekBracketOf());
    const router = await renderWeekBracket(PATH);
    await expect.element(pageTitle()).toHaveTextContent(PAGE_TITLE);

    respond(null);
    await router.options.context.queryClient.invalidateQueries({
      queryKey: weekBracketQueryOptions(null, WEEK_BRACKET_WEEK).queryKey,
    });

    await expectNotFound();
  });
});

describe('Weekトーナメントのブラケットのhead', () => {
  const head = WeekBracketRoute.options.head as PageHead | undefined;

  test('タイトルを「<週の表記> Product of the Weekトーナメント」にし、正規のURLにISO週のパスを出す', () => {
    const result = head?.({
      loaderData: { week: WEEK_BRACKET_WEEK, label: WEEK_BRACKET_LABEL },
    });

    expect(result?.meta).toStrictEqual([
      {
        title: `${WEEK_BRACKET_LABEL} Product of the Weekトーナメント | Launch Stadium`,
      },
    ]);
    expect(result?.links).toStrictEqual([{ rel: 'canonical', href: PATH }]);
  });

  test('取得の前や失敗ではサイト名だけにし、正規のURLを付けない', () => {
    const result = head?.({ loaderData: undefined });

    expect(result?.meta).toStrictEqual([{ title: 'Launch Stadium' }]);
    expect(result?.links).toStrictEqual([]);
  });
});
