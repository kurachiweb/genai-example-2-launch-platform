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
  AWARDED_YEAR_BRACKET,
  HIDDEN_CHAMPION_YEAR_BRACKET,
  NO_AWARD_YEAR_BRACKET,
  YEAR_BRACKET_PATH,
  YEAR_FINAL_DATE,
  YEAR_TOURNAMENT_LABEL,
  YEAR_TOURNAMENT_YEAR,
  type YearBracketView,
  yearBracketOf,
} from '../src/components/year-tournament/year-tournament-fixtures.ts';
import { ClientYearBracketDocument } from '../src/graphql/generated/graphql.ts';
import { yearBracketQueryOptions } from '../src/graphql/year-tournament.ts';
import type {
  buildSitePageHead,
  YearBracketHeadInput,
} from '../src/head/page-heads.ts';
import { Route as YearBracketRoute } from '../src/routes/tournaments/year/$year.tsx';
import { renderPageRouter } from './page-router.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../lib/start/graphql/execute-graphql.ts', () => ({ executeGraphQL }));

vi.mock('../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

const YEAR = String(YEAR_TOURNAMENT_YEAR);

const PAGE_TITLE = `Product of the Yearトーナメント ${YEAR_TOURNAMENT_LABEL}`;

const AWARD_NAME = 'Product of the Year';

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
const respond = (...results: readonly (YearBracketView | null)[]) => {
  let index = 0;
  executeGraphQL.mockImplementation((document: unknown) => {
    if (document !== ClientYearBracketDocument) {
      return Promise.reject(new Error('想定外の文書の取得'));
    }
    const result = results[Math.min(index, results.length - 1)] ?? null;
    index += 1;
    return Promise.resolve(ok({ yearBracket: result }));
  });
};

const bracketCalls = () =>
  executeGraphQL.mock.calls.filter(
    ([called]) => called === ClientYearBracketDocument,
  );

const bracketCallCount = () => bracketCalls().length;

type PageHead = (input: {
  loaderData: YearBracketHeadInput | undefined;
}) => ReturnType<typeof buildSitePageHead>;

// アプリの経路と同じ取得・画面を通すため、本物の経路の設定を、画面のテスト用のルーターの同じパスの経路へ写す
const renderYearBracket = (path: string) =>
  renderPageRouter({
    path,
    createRoutes: (rootRoute) => [
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/tournaments/year/$year',
        loader: YearBracketRoute.options.loader,
        errorComponent: YearBracketRoute.options.errorComponent,
        notFoundComponent: YearBracketRoute.options.notFoundComponent,
        component: YearBracketRoute.options.component,
      } as Parameters<typeof createRoute>[0]),
    ],
  });

const main = () => page.getByRole('main');
const autoRefreshSwitch = () =>
  main().getByRole('switch', { name: '自動更新' });
const pageTitle = () => main().getByRole('heading', { level: 1 });
const championRegion = () => main().getByRole('region', { name: AWARD_NAME });

const headerDates = (): (string | null)[] =>
  [
    ...(pageTitle().element().closest('header')?.querySelectorAll('time') ??
      []),
  ].map((time) => time.getAttribute('datetime'));

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

describe('Yearトーナメントのブラケットの経路', () => {
  test('組み合わせを決定した年を、URLの年で照会してログインせずに、対象年・決勝日・参加数とシード数の見出しとともに表示する', async () => {
    respond(yearBracketOf());

    await renderYearBracket(YEAR_BRACKET_PATH);

    await expect.element(pageTitle()).toHaveTextContent(PAGE_TITLE);
    await expect.element(main().getByText('参加6・シード2')).toBeVisible();
    expect(headerDates()).toStrictEqual([YEAR_FINAL_DATE]);
    expect(bracketCallCount()).toBe(1);
    expect(bracketCalls()[0]?.[1]).toEqual({ year: YEAR });
    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test('開催中の年は、自動更新の切り替えを含めてアクセシビリティの検査の違反が0件', async () => {
    respond(yearBracketOf());
    await renderYearBracket(YEAR_BRACKET_PATH);
    await expect.element(autoRefreshSwitch()).toBeVisible();

    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test('受賞で終えた年は、受賞したプロダクトを「Product of the Year」の印とともに示す', async () => {
    respond(AWARDED_YEAR_BRACKET);
    await renderYearBracket(YEAR_BRACKET_PATH);

    await expect
      .element(
        championRegion().getByRole('link', { name: 'Bracket Product 1' }),
      )
      .toHaveAttribute('href', '/p/bracket-product-1');
    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test('受賞したプロダクトが表示できない年は、「非公開のプロダクト」の受賞としてリンクを出さずに示す', async () => {
    respond(HIDDEN_CHAMPION_YEAR_BRACKET);
    await renderYearBracket(YEAR_BRACKET_PATH);

    await expect
      .element(championRegion().getByText('非公開のプロダクト'))
      .toBeVisible();
    expect(championRegion().getByRole('link').elements()).toHaveLength(0);
    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test('受賞なしで終えた年は、「受賞プロダクトはありません」を示す', async () => {
    respond(NO_AWARD_YEAR_BRACKET);
    await renderYearBracket(YEAR_BRACKET_PATH);

    await expect
      .element(championRegion().getByText('受賞プロダクトはありません'))
      .toBeVisible();
  });

  test('組み合わせを決定していない年・存在しない年(null)は、存在しないページの画面にする', async () => {
    respond(null);

    await renderYearBracket('/tournaments/year/2028');

    await expectNotFound();
    expect(bracketCallCount()).toBe(1);
    expect(bracketCalls()[0]?.[1]).toEqual({ year: '2028' });
    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test.each(['27', '20270', 'year', '2027a', '２０２７'])(
    '4桁の年でない指定(%p)は照会せずに、存在しないページの画面にする',
    async (year) => {
      await renderYearBracket(`/tournaments/year/${year}`);

      await expectNotFound();
      expect(executeGraphQL).not.toHaveBeenCalled();
    },
  );

  test('取得の失敗では、取得エラーの文言と再試行・問い合わせの導線を示し、再試行で表示し直して見出しへフォーカスを移す', async () => {
    executeGraphQL.mockResolvedValue(INTERNAL_ERROR);

    await renderYearBracket(YEAR_BRACKET_PATH);

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(ERROR_MESSAGE);
    await expect
      .element(main().getByRole('link', { name: 'お問い合わせ' }))
      .toHaveAttribute('href', '/contact');
    await expect
      .element(pageTitle())
      .toHaveTextContent('Product of the Yearトーナメント');
    expect(await runAxe(document.body)).toStrictEqual([]);

    respond(yearBracketOf());
    await userEvent.click(main().getByRole('button', { name: '再試行' }));

    await expect.element(pageTitle()).toHaveTextContent(PAGE_TITLE);
    await expect.element(pageTitle()).toHaveFocus();
    expect(main().getByRole('alert').query()).toBeNull();
  });
});

describe('Yearトーナメントのブラケットの定期再取得', () => {
  beforeEach(() => {
    notifyManager.setScheduler(queueMicrotask);
    startClockAt(NOON);
  });

  test('開催中の年は30秒ごとに取り直し、終了を受け取ったら取り直しを止めて受賞を示す', async () => {
    respond(yearBracketOf(), AWARDED_YEAR_BRACKET);
    await renderYearBracket(YEAR_BRACKET_PATH);
    await expect.element(pageTitle()).toHaveTextContent(PAGE_TITLE);
    expect(bracketCallCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS - 1);
    expect(bracketCallCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(1);

    await expect.poll(bracketCallCount).toBe(2);
    await expect
      .element(main().getByRole('heading', { level: 2, name: AWARD_NAME }))
      .toBeVisible();

    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 3);
    expect(bracketCallCount()).toBe(2);
  });

  test('終了した年は取り直さず、自動更新の切り替えも描かない', async () => {
    respond(AWARDED_YEAR_BRACKET);
    await renderYearBracket(YEAR_BRACKET_PATH);
    await expect.element(pageTitle()).toHaveTextContent(PAGE_TITLE);

    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 3);

    expect(bracketCallCount()).toBe(1);
    await expect.element(autoRefreshSwitch()).not.toBeInTheDocument();
  });

  test('開催中は自動更新の切り替えをオンで描き、オフにすると30秒の取り直しを止め、オンに戻すと再開する', async () => {
    respond(yearBracketOf());
    await renderYearBracket(YEAR_BRACKET_PATH);
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
    respond(yearBracketOf());
    await renderYearBracket(YEAR_BRACKET_PATH);
    await userEvent.click(autoRefreshSwitch());
    await expect.element(autoRefreshSwitch()).not.toBeChecked();
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS);
    expect(bracketCallCount()).toBe(1);

    focusManager.setFocused(false);
    focusManager.setFocused(true);

    await expect.poll(bracketCallCount).toBe(2);
    focusManager.setFocused(undefined);
  });

  test('同じ経路のまま別の年へ移ると、ページを作り直して自動更新をオンから始める', async () => {
    respond(
      yearBracketOf(),
      yearBracketOf({
        tournament: { year: 2026, label: '2026年', finalDate: '2026-05-31' },
      }),
    );
    const router = await renderYearBracket(YEAR_BRACKET_PATH);
    await userEvent.click(autoRefreshSwitch());
    await expect.element(autoRefreshSwitch()).not.toBeChecked();

    await router.navigate({ to: '/tournaments/year/2026' } as never);

    await expect
      .element(pageTitle())
      .toHaveTextContent('Product of the Yearトーナメント 2026年');
    await expect.element(autoRefreshSwitch()).toBeChecked();
  });

  test('表示中の取り直しで年が見つからなくなったら、存在しないページの画面にする', async () => {
    respond(yearBracketOf());
    const router = await renderYearBracket(YEAR_BRACKET_PATH);
    await expect.element(pageTitle()).toHaveTextContent(PAGE_TITLE);

    respond(null);
    await router.options.context.queryClient.invalidateQueries({
      queryKey: yearBracketQueryOptions(null, YEAR).queryKey,
    });

    await expectNotFound();
  });
});

describe('Yearトーナメントのブラケットのhead', () => {
  const head = YearBracketRoute.options.head as PageHead | undefined;

  test('タイトルを「<年>年のProduct of the Yearトーナメント」にし、正規のURLに年のパスを出す', () => {
    const result = head?.({
      loaderData: { year: YEAR_TOURNAMENT_YEAR, label: YEAR_TOURNAMENT_LABEL },
    });

    expect(result?.meta).toStrictEqual([
      {
        title: `${YEAR_TOURNAMENT_LABEL}のProduct of the Yearトーナメント | Launch Stadium`,
      },
    ]);
    expect(result?.links).toStrictEqual([
      { rel: 'canonical', href: YEAR_BRACKET_PATH },
    ]);
  });

  test('取得の前や失敗ではサイト名だけにし、正規のURLを付けない', () => {
    const result = head?.({ loaderData: undefined });

    expect(result?.meta).toStrictEqual([{ title: 'Launch Stadium' }]);
    expect(result?.links).toStrictEqual([]);
  });
});
