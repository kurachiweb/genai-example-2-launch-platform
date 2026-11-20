import { createRoute } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../../styles.css';
import { addBusinessDays } from '../../../../common-lib/time/business-date-arithmetic.ts';
import { runAxe } from '../../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../../lib/test/computed-style.ts';
import {
  failure,
  type GraphQLHandler,
  respondAdminGraphQL,
  success,
} from '../../../../test/admin-accounts-fixtures.ts';
import { adminWithRole } from '../../../../test/admin-viewer-fixtures.ts';
import {
  CURRENT_WEEK,
  LATEST_FINALIZED_WEEK,
  OLDER_FINALIZED_WEEK,
  STATISTICS_WEEKS,
  weeklyStatisticsQueryOf,
} from '../../../../test/moderation-statistics-fixtures.ts';
import {
  type PageRootRoute,
  renderPageRouter,
} from '../../../../test/page-router.tsx';
import { adminWeeklyStatisticsQueryOptions } from '../../../graphql/admin-weekly-statistics.ts';
import {
  AdminUnhandledInquiryCountDocument,
  AdminWeeklyStatisticsDocument,
} from '../../../graphql/generated/graphql.ts';
import { Route as AuthenticatedRoute } from '../../../routes/_authenticated/route.tsx';
import { Route as DashboardRoute } from '../../../routes/_authenticated/index.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const CARD_TITLE = '週ごとの統計';
const INQUIRY_CARD_TITLE = '未対応の問い合わせ';
const LATEST_HEADING = '2026年11月9日(月)からの週';
const TABLE_CAPTION = '週ごとの統計(直近26週と今週)';

const INTERNAL_ERROR = Object.freeze({
  code: 'internal_error',
  message: '処理中に問題が発生しました。',
  status: 500,
});

const main = () => page.getByRole('main');
const card = () => main().getByRole('region', { name: CARD_TITLE });
const inquiryCard = () =>
  main().getByRole('region', { name: INQUIRY_CARD_TITLE });
const cardHeading = () =>
  card().getByRole('heading', { level: 2, name: CARD_TITLE });
const latestWeek = () => card().getByRole('region', { name: LATEST_HEADING });
const statisticsTable = () =>
  card().getByRole('table', { name: TABLE_CAPTION });

const CHART_SELECTOR = '[data-slot="weekly-statistics-chart"]';
const CHART_CELL_SELECTOR = '[data-slot="weekly-statistics-chart-cell"]';
const METRIC_LABELS = Object.freeze([
  '合計収益(税込)',
  'ユーザー数',
  'プロダクト数',
  '予選実施数',
  'Upvote数',
]);
const FOCUSABLE_SELECTOR =
  'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

type StatisticsWeekNode = (typeof STATISTICS_WEEKS)[number];

// 直近26週と今週。値は週ごとに上下させ、グラフの点の高さの並びを値の並びと比べられるようにする
const HALF_YEAR_WEEKS: readonly StatisticsWeekNode[] = Array.from(
  { length: 27 },
  (_, index): StatisticsWeekNode => ({
    weekStart: addBusinessDays('2026-05-18', index * 7),
    finalized: index < 26,
    netRevenue: {
      amount: ((index * 7) % 11) * 10_000 + index,
      currency: 'usd',
    },
    users: 1_000 + ((index * 5) % 13) * 25,
    products: 300 + ((index * 3) % 7),
    qualifierMatches: (index * 4) % 9,
    upvotes: 4_000 + ((index * 9) % 17) * 150,
  }),
);

// 狭い画面では表の横スクロールの領域もカードの題名を含む名前を持つため、グラフはページに1つの枠から探す
const chartOf = (): HTMLElement | null =>
  main().element().querySelector<HTMLElement>(CHART_SELECTOR);

const chartSurfacesOf = (): readonly SVGSVGElement[] =>
  Array.from(
    chartOf()?.querySelectorAll<SVGSVGElement>('svg.recharts-surface') ?? [],
  );

const waitForCharts = async (): Promise<void> => {
  await expect.poll(() => chartSurfacesOf().length).toBe(5);
};

const chartCellsOf = (): readonly Element[] =>
  Array.from(chartOf()?.querySelectorAll(CHART_CELL_SELECTOR) ?? []);

const dotHeightsOf = (cell: Element): readonly number[] =>
  Array.from(cell.querySelectorAll('.recharts-line-dot'), (dot) =>
    Number(dot.getAttribute('cy')),
  );

const tickTextsOf = (cell: Element, axis: 'x' | 'y'): readonly string[] =>
  Array.from(
    cell.querySelectorAll(
      `.recharts-${axis}Axis-tick-labels .recharts-cartesian-axis-tick-value`,
    ),
    (tick) => tick.textContent,
  );

const statisticsCallsOf = () =>
  executeGraphQL.mock.calls.filter(
    ([document]) => document === AdminWeeklyStatisticsDocument,
  );

const textsOf = (elements: readonly Element[]) =>
  elements.map((element) => element.textContent);

// アプリの経路と同じログイン必須のレイアウトとダッシュボードの設定を、画面のテスト用のルーターの同じ位置の経路へ写す
const createRoutes = (rootRoute: PageRootRoute) => {
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_authenticated',
    beforeLoad: AuthenticatedRoute.options.beforeLoad,
    component: AuthenticatedRoute.options.component,
  });
  return [
    authenticatedRoute.addChildren([
      createRoute({
        getParentRoute: () => authenticatedRoute,
        path: '/',
        component: DashboardRoute.options.component,
      }),
    ]),
  ];
};

const renderDashboard = (statistics: () => Promise<unknown>) => {
  respondAdminGraphQL(executeGraphQL, {
    role: 'VIEWER',
    handlers: new Map<unknown, GraphQLHandler>([
      [AdminWeeklyStatisticsDocument, statistics],
      [
        AdminUnhandledInquiryCountDocument,
        () => success({ adminUnhandledInquiryCount: 3 }),
      ],
    ]),
  });
  return renderPageRouter({
    path: '/',
    createRoutes,
    cachedViewer: adminWithRole('VIEWER'),
  });
};

const renderWeeks = (weeks: Parameters<typeof weeklyStatisticsQueryOf>[0]) =>
  renderDashboard(() => success(weeklyStatisticsQueryOf(weeks)));

beforeEach(async () => {
  executeGraphQL.mockReset();
  await page.viewport(1280, 800);
});

afterEach(() => {
  applyColorScheme('light');
});

describe('WeeklyStatisticsCard', () => {
  test('ダッシュボードの先頭に全幅で並び、題名に導線を置かずに説明を示す', async () => {
    await renderWeeks(STATISTICS_WEEKS);
    await expect.element(inquiryCard()).toHaveTextContent('3件');
    await expect.element(statisticsTable()).toBeVisible();

    const regions = Array.from(
      main().element().querySelectorAll('section[aria-labelledby]'),
    ).filter((section) => section.querySelector('h2') !== null);
    expect(regions[0]).toBe(card().element());
    const statisticsBox = card().element().getBoundingClientRect();
    const inquiryBox = inquiryCard().element().getBoundingClientRect();
    expect(statisticsBox.bottom).toBeLessThanOrEqual(inquiryBox.top);
    expect(statisticsBox.width).toBeGreaterThan(inquiryBox.width * 1.8);
    expect(card().getByRole('link').elements()).toHaveLength(0);
    await expect
      .element(card())
      .toHaveTextContent(
        '直近26週と集計中の今週の運営状況の推移です。週は月曜日に始まり、値は毎日集計します。終わった週の値は変わりません。',
      );
    expect(statisticsCallsOf()).toHaveLength(1);
  });

  test('直近の確定した週の開始日と、各指標の値と前週からの増減を示す', async () => {
    await renderWeeks(STATISTICS_WEEKS);

    await expect.element(latestWeek()).toBeVisible();
    await expect
      .element(
        latestWeek().getByRole('heading', { level: 3, name: LATEST_HEADING }),
      )
      .toBeVisible();
    expect(
      latestWeek().element().querySelector('h3 time')?.getAttribute('datetime'),
    ).toBe(LATEST_FINALIZED_WEEK.weekStart);
    expect(textsOf(latestWeek().getByRole('term').elements())).toStrictEqual([
      '合計収益(税込)',
      'ユーザー数',
      'プロダクト数',
      '予選実施数',
      'Upvote数',
    ]);
    expect(
      textsOf(latestWeek().getByRole('definition').elements()),
    ).toStrictEqual([
      '$1,234.50前週比+$12.34',
      '1,234前週比+12',
      '340前週比-3',
      '12前週比±0',
      '5,600前週比+200',
    ]);
  });

  test('合計収益の増減が0なら「前週比±$0」、小数点以下が全て0の金額は小数点以下を省く', async () => {
    await renderWeeks([
      { ...OLDER_FINALIZED_WEEK, netRevenue: { amount: 900, currency: 'usd' } },
      {
        ...LATEST_FINALIZED_WEEK,
        netRevenue: { amount: 900, currency: 'usd' },
      },
    ]);

    await expect
      .element(latestWeek().getByRole('definition').first())
      .toHaveTextContent(/^\$9前週比±\$0$/u);
  });

  test('前週の行が無ければ、増減の代わりに「前週の値なし」を示す', async () => {
    await renderWeeks([
      { ...OLDER_FINALIZED_WEEK, weekStart: '2026-10-26' },
      LATEST_FINALIZED_WEEK,
      CURRENT_WEEK,
    ]);

    await expect.element(latestWeek()).toBeVisible();
    expect(
      textsOf(latestWeek().getByRole('definition').elements()),
    ).toStrictEqual([
      '$1,234.50前週の値なし',
      '1,234前週の値なし',
      '340前週の値なし',
      '12前週の値なし',
      '5,600前週の値なし',
    ]);
  });

  test('表は新しい週を上にし、週の開始日を業務日付の<time>で、集計中の今週に「集計中」を添えて示す', async () => {
    await renderWeeks(STATISTICS_WEEKS);

    await expect.element(statisticsTable()).toBeVisible();
    const [header, ...rows] = statisticsTable().getByRole('row').elements();
    expect(
      textsOf(Array.from(header?.querySelectorAll('th') ?? [])),
    ).toStrictEqual([
      '週の開始日',
      '合計収益(税込)',
      'ユーザー数',
      'プロダクト数',
      '予選実施数',
      'Upvote数',
    ]);
    expect(
      rows.map((row) => textsOf(Array.from(row.querySelectorAll('td')))),
    ).toStrictEqual([
      ['2026年11月16日(月)集計中', '$9', '1,240', '341', '3', '1,250'],
      ['2026年11月9日(月)', '$1,234.50', '1,234', '340', '12', '5,600'],
      ['2026年11月2日(月)', '$1,222.16', '1,222', '343', '12', '5,400'],
    ]);
    expect(
      Array.from(statisticsTable().element().querySelectorAll('time'), (time) =>
        time.getAttribute('datetime'),
      ),
    ).toStrictEqual(['2026-11-16', '2026-11-09', '2026-11-02']);
  });

  test('グラフを直近の値と表の間に置き、5つの指標ごとに直近26週と今週の値を古い順に結ぶ', async () => {
    await renderWeeks(HALF_YEAR_WEEKS);
    await waitForCharts();

    const chart = chartOf();
    if (chart === null) {
      throw new Error('統計のグラフがありません。');
    }
    const following = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(
      card().getByRole('region').element().compareDocumentPosition(chart) &
        following,
    ).toBe(following);
    expect(
      chart.compareDocumentPosition(statisticsTable().element()) & following,
    ).toBe(following);

    const cells = chartCellsOf();
    expect(
      cells.map((cell) => cell.querySelector('p')?.textContent),
    ).toStrictEqual([...METRIC_LABELS]);
    const valuesByMetric = [
      HALF_YEAR_WEEKS.map(({ netRevenue }) => netRevenue.amount),
      HALF_YEAR_WEEKS.map(({ users }) => users),
      HALF_YEAR_WEEKS.map(({ products }) => products),
      HALF_YEAR_WEEKS.map(({ qualifierMatches }) => qualifierMatches),
      HALF_YEAR_WEEKS.map(({ upvotes }) => upvotes),
    ];
    cells.forEach((cell, metricIndex) => {
      const values = valuesByMetric[metricIndex] ?? [];
      const heights = dotHeightsOf(cell);
      expect(heights).toHaveLength(HALF_YEAR_WEEKS.length);
      // SVGの縦の座標は下へ増えるため、値が増えた週は点が上へ動く
      expect(
        heights
          .slice(1)
          .map((height, index) => Math.sign((heights[index] ?? 0) - height)),
      ).toStrictEqual(
        values
          .slice(1)
          .map((value, index) => Math.sign(value - (values[index] ?? 0))),
      );
      const weekTicks = tickTextsOf(cell, 'x');
      expect(weekTicks[0]).toBe('5/18');
      expect(weekTicks.at(-1)).toBe('11/16');
      for (const tick of weekTicks) {
        expect(tick).toMatch(/^\d{1,2}\/\d{1,2}$/u);
      }
      const valueTicks = tickTextsOf(cell, 'y');
      expect(valueTicks.length).toBeGreaterThan(1);
      for (const tick of valueTicks) {
        expect(tick).toMatch(
          metricIndex === 0
            ? /^\$\d{1,3}(?:,\d{3})*$/u
            : /^\d{1,3}(?:,\d{3})*$/u,
        );
      }
    });
  });

  test('グラフは読み上げとフォーカスの対象から外し、表が同じ週と値を示し続ける', async () => {
    await renderWeeks(HALF_YEAR_WEEKS);
    await waitForCharts();

    const chart = chartOf();
    expect(chart?.getAttribute('aria-hidden')).toBe('true');
    expect(chart?.querySelectorAll(FOCUSABLE_SELECTOR)).toHaveLength(0);
    expect(card().getByRole('img').elements()).toHaveLength(0);
    expect(card().getByRole('application').elements()).toHaveLength(0);

    const [, ...rows] = statisticsTable().getByRole('row').elements();
    expect(rows).toHaveLength(HALF_YEAR_WEEKS.length);
    expect(
      Array.from(statisticsTable().element().querySelectorAll('time'), (time) =>
        time.getAttribute('datetime'),
      ),
    ).toStrictEqual(
      HALF_YEAR_WEEKS.map(({ weekStart }) => weekStart).toReversed(),
    );
    expect(
      textsOf(Array.from(rows[0]?.querySelectorAll('td') ?? [])),
    ).toStrictEqual([
      '2026年11月16日(月)集計中',
      '$600.26',
      '1,000',
      '301',
      '5',
      '5,950',
    ]);
  });

  test('今週だけなら、直近の値の位置に終わった週の統計が無い旨を示し、表に今週を集計中で示す', async () => {
    await renderWeeks([CURRENT_WEEK]);

    await expect
      .element(card())
      .toHaveTextContent('終わった週の統計はまだありません。');
    expect(card().getByRole('heading', { level: 3 }).elements()).toHaveLength(
      0,
    );
    const rows = statisticsTable().getByRole('row').elements();
    expect(rows).toHaveLength(2);
    expect(rows[1]?.textContent).toContain('2026年11月16日(月)集計中');
    await waitForCharts();
    expect(
      chartCellsOf().map((cell) => dotHeightsOf(cell).length),
    ).toStrictEqual([1, 1, 1, 1, 1]);
  });

  test('一度も集計していなければ、直近の値と表の代わりに集計がまだ無い旨を示す', async () => {
    await renderWeeks([]);

    await expect
      .element(card())
      .toHaveTextContent('統計はまだ集計されていません。');
    expect(card().getByRole('table').elements()).toHaveLength(0);
    expect(chartOf()).toBeNull();
    expect(card().getByRole('heading', { level: 3 }).elements()).toHaveLength(
      0,
    );
    expect(card().element().textContent).not.toContain(
      '終わった週の統計はまだありません。',
    );
  });

  test('取得を待つ間は、カードの中に読み込み中を示す', async () => {
    await renderDashboard(() => new Promise<never>(() => undefined));

    await expect
      .element(card().getByRole('status'))
      .toHaveTextContent('読み込み中');
  });

  test('取得の失敗はカードの中だけに問い合わせを促さない文言と再試行で示し、他のカードとダッシュボードの表示を続ける', async () => {
    let available = false;
    await renderDashboard(() =>
      available
        ? success(weeklyStatisticsQueryOf(STATISTICS_WEEKS))
        : failure(INTERNAL_ERROR),
    );

    await expect
      .element(card().getByRole('alert'))
      .toHaveTextContent(INTERNAL_ERROR.message);
    expect(main().getByRole('alert').elements()).toHaveLength(1);
    await expect.element(inquiryCard()).toHaveTextContent('3件');
    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toHaveTextContent('ダッシュボード');
    expect(
      main().getByRole('link', { name: 'お問い合わせ' }).elements(),
    ).toHaveLength(0);
    expect(main().element().textContent).not.toContain('お問い合わせください');

    available = true;
    await userEvent.click(card().getByRole('button', { name: '再試行' }));

    await expect.element(statisticsTable()).toBeVisible();
    await expect.element(cardHeading()).toHaveFocus();
    expect(card().getByRole('alert').elements()).toHaveLength(0);
  });

  test('取り直しに失敗したときは、表示中の値を残し、失敗と再試行を示さない', async () => {
    let failing = false;
    const router = await renderDashboard(() =>
      failing
        ? failure(INTERNAL_ERROR)
        : success(weeklyStatisticsQueryOf(STATISTICS_WEEKS)),
    );
    await expect.element(latestWeek()).toBeVisible();
    const { queryClient } = router.options.context;
    const { queryKey } = adminWeeklyStatisticsQueryOptions();

    failing = true;
    await queryClient.refetchQueries({ queryKey });

    expect(queryClient.getQueryState(queryKey)?.status).toBe('error');
    await expect.element(latestWeek()).toBeVisible();
    await expect.element(statisticsTable()).toBeVisible();
    expect(card().getByRole('alert').elements()).toHaveLength(0);
    expect(
      card().getByRole('button', { name: '再試行' }).elements(),
    ).toHaveLength(0);
    expect(statisticsCallsOf()).toHaveLength(2);
  });

  test('狭い画面では、表だけを横にスクロールできる領域にする', async () => {
    await page.viewport(400, 800);
    await renderWeeks(STATISTICS_WEEKS);
    await expect.element(statisticsTable()).toBeVisible();
    await waitForCharts();

    const container = statisticsTable().element().parentElement;
    await expect.poll(() => container?.getAttribute('tabindex')).toBe('0');
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(400);
  });

  test.each(COLOR_SCHEMES)(
    '%sの配色で、統計の表示がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderWeeks(STATISTICS_WEEKS);
      await expect.element(statisticsTable()).toBeVisible();
      await waitForCharts();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test.each(COLOR_SCHEMES)(
    '%sの配色で、統計が無い表示と取得の失敗の表示がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderDashboard(() => failure(INTERNAL_ERROR));
      await expect.element(card().getByRole('alert')).toBeVisible();
      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test('一度も集計していない表示がWCAG 2.2 AAの自動検査に違反しない', async () => {
    await renderWeeks([]);
    await expect
      .element(card())
      .toHaveTextContent('統計はまだ集計されていません。');

    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
