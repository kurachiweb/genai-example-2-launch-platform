import { use, useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { reportUnexpectedErrorInBrowser } from '../../../lib/start/observability/browser-error-reporting.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { hasHorizontalScroll } from '../../../lib/test/overflow.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import {
  DASHBOARD_CARDS,
  type DashboardCard,
} from '../../composition/dashboard-cards.ts';
import {
  DashboardCardFrame,
  type DashboardCardState,
} from './dashboard-card-frame.tsx';
import { DashboardGrid } from './dashboard-grid.tsx';

// ログイン中の管理者の取得の補助が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

vi.mock('../../../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

const EMPTY_TITLE = '表示できる項目はまだありません。';
const RETRY_LABEL = '再試行';
const CONTACT_LABEL = 'お問い合わせ';
const CONTACT_GUIDANCE = 'お問い合わせください';
const UNEXPECTED_MESSAGE =
  'ページを表示できませんでした。時間をおいて再度お試しください。';
const NARROWEST_VIEWPORT_WIDTH = 320;
const WIDE_VIEWPORT = { width: 1280, height: 800 } as const;

const UNAVAILABLE = new GraphQLClientError({
  code: 'upstream_unavailable',
  message: '現在ご利用いただけません。時間をおいて再度お試しください。',
  status: 503,
});

const cardOf = (
  id: string,
  order: number,
  component: DashboardCard['component'],
  width: DashboardCard['width'] = 'half',
): DashboardCard => ({ id, order, width, component });

function StatisticsCard() {
  return (
    <DashboardCardFrame title="週毎の統計" state={{ status: 'success' }}>
      <p>統計の本文</p>
    </DashboardCardFrame>
  );
}

function InquiriesCard() {
  return (
    <DashboardCardFrame
      title="未対応の問い合わせ"
      href="/inquiries"
      state={{ status: 'success' }}
    >
      <p>問い合わせの本文</p>
    </DashboardCardFrame>
  );
}

function ReportsCard() {
  return (
    <DashboardCardFrame title="未対応の通報" state={{ status: 'success' }}>
      <p>通報の本文</p>
    </DashboardCardFrame>
  );
}

let cardFailing = false;

// Reactは失敗した描画をやり直すため、テストが失敗を止めるまで描画のたびに失敗する
function ThrowingCard() {
  if (cardFailing) {
    throw new Error('カードの描画の失敗');
  }
  return (
    <DashboardCardFrame title="回復したカード" state={{ status: 'success' }}>
      <p>回復した本文</p>
    </DashboardCardFrame>
  );
}

function ThrowingGraphQLCard(): never {
  throw UNAVAILABLE;
}

const pending = new Promise<never>(() => undefined);

function SuspendingCard() {
  use(pending);
  return null;
}

const retry = vi.fn();

function FailedQueryCard() {
  const [state, setState] = useState<DashboardCardState>({
    status: 'error',
    error: UNAVAILABLE,
    retry: () => {
      retry();
      setState({ status: 'success' });
    },
  });
  return (
    <DashboardCardFrame title="失敗したカード" state={state}>
      <p>取得し直した本文</p>
    </DashboardCardFrame>
  );
}

function UnexpectedFailureCard() {
  return (
    <DashboardCardFrame
      title="想定外の失敗のカード"
      state={{
        status: 'error',
        error: new Error('想定外'),
        retry: () => undefined,
      }}
    >
      <p>表示されない本文</p>
    </DashboardCardFrame>
  );
}

function LoadingCard() {
  return (
    <DashboardCardFrame
      title="読み込み中のカード"
      state={{ status: 'pending' }}
    >
      <p>まだ表示されない本文</p>
    </DashboardCardFrame>
  );
}

const renderGrid = (cards: readonly DashboardCard[]) =>
  renderInRouter(
    <main className="p-4">
      <DashboardGrid cards={cards} />
    </main>,
  );

const cardTitles = () =>
  page
    .getByRole('heading', { level: 2 })
    .elements()
    .map((heading) => heading.textContent);

const regionOf = (name: string) => page.getByRole('region', { name });

beforeEach(async () => {
  cardFailing = false;
  retry.mockReset();
  vi.mocked(reportUnexpectedErrorInBrowser).mockClear();
  await page.viewport(WIDE_VIEWPORT.width, WIDE_VIEWPORT.height);
});

afterEach(() => {
  applyColorScheme('light');
});

describe('DashboardGrid', () => {
  test('初版の登録箇所は空', () => {
    expect(DASHBOARD_CARDS).toStrictEqual([]);
    expect(Object.isFrozen(DASHBOARD_CARDS)).toBe(true);
  });

  test('カードが1つも無いとき、空状態を表示する', async () => {
    await renderGrid([]);

    await expect.element(page.getByText(EMPTY_TITLE)).toBeVisible();
    expect(page.getByRole('region').elements()).toHaveLength(0);
  });

  test('登録の順によらず、カードをorderの順に並べる', async () => {
    await renderGrid([
      cardOf('content-reporting.open-reports', 30, ReportsCard),
      cardOf('ugc-moderation.weekly-statistics', 10, StatisticsCard, 'full'),
      cardOf('inquiry-chat.open-inquiries', 20, InquiriesCard),
    ]);

    await expect.element(regionOf('未対応の通報')).toBeVisible();
    expect(cardTitles()).toStrictEqual([
      '週毎の統計',
      '未対応の問い合わせ',
      '未対応の通報',
    ]);
    expect(page.getByText(EMPTY_TITLE).elements()).toHaveLength(0);
  });

  test('幅がfullのカードは行の全体、halfのカードは半分の幅に並べる', async () => {
    await renderGrid([
      cardOf('ugc-moderation.weekly-statistics', 10, StatisticsCard, 'full'),
      cardOf('inquiry-chat.open-inquiries', 20, InquiriesCard),
      cardOf('content-reporting.open-reports', 30, ReportsCard),
    ]);

    const widthOf = (name: string) =>
      regionOf(name).element().getBoundingClientRect().width;
    await expect.element(regionOf('週毎の統計')).toBeVisible();
    expect(widthOf('未対応の問い合わせ')).toBeLessThan(
      widthOf('週毎の統計') / 2 + 1,
    );
    expect(widthOf('未対応の問い合わせ')).toBe(widthOf('未対応の通報'));
  });

  test('1つのカードの描画の失敗は、そのカードの位置だけにエラーを示し、他のカードの表示を続ける', async () => {
    cardFailing = true;
    await renderGrid([
      cardOf('a.statistics', 10, StatisticsCard),
      cardOf('b.broken', 20, ThrowingCard),
      cardOf('c.reports', 30, ReportsCard),
    ]);

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(UNEXPECTED_MESSAGE);
    await expect.element(page.getByText('統計の本文')).toBeVisible();
    await expect.element(page.getByText('通報の本文')).toBeVisible();
    expect(page.getByRole('alert').elements()).toHaveLength(1);
    expect(reportUnexpectedErrorInBrowser).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'カードの描画の失敗' }),
      'render',
    );
  });

  test('描画の失敗の表示に、問い合わせのボタンと問い合わせを促す文を出さない', async () => {
    cardFailing = true;
    await renderGrid([cardOf('b.broken', 20, ThrowingCard)]);

    await expect.element(page.getByRole('alert')).toBeVisible();
    expect(
      page.getByRole('link', { name: CONTACT_LABEL }).elements(),
    ).toHaveLength(0);
    expect(page.getByText(CONTACT_GUIDANCE).elements()).toHaveLength(0);
  });

  test('描画の失敗の再試行で、カードを描き直す', async () => {
    cardFailing = true;
    await renderGrid([cardOf('b.broken', 20, ThrowingCard)]);
    await expect.element(page.getByRole('alert')).toBeVisible();
    cardFailing = false;

    await userEvent.click(page.getByRole('button', { name: RETRY_LABEL }));

    await expect.element(page.getByText('回復した本文')).toBeVisible();
    expect(page.getByRole('alert').elements()).toHaveLength(0);
  });

  test('GraphQLの失敗が描画から投げられたときは、その文言を示し、エラートラッキングへ送り直さない', async () => {
    await renderGrid([cardOf('b.graphql', 20, ThrowingGraphQLCard)]);

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(UNAVAILABLE.message);
    expect(reportUnexpectedErrorInBrowser).not.toHaveBeenCalled();
  });

  test('取得を待って中断したカードは、その位置に読み込み中を示し、他のカードの表示を続ける', async () => {
    await renderGrid([
      cardOf('a.statistics', 10, StatisticsCard),
      cardOf('b.suspending', 20, SuspendingCard),
    ]);

    await expect.element(page.getByText('統計の本文')).toBeVisible();
    await expect
      .element(page.getByRole('status'))
      .toHaveTextContent('読み込み中');
  });
});

describe('DashboardCardFrame', () => {
  test('題名を見出しにした名前付きの領域に本文を表示し、行き先があれば題名をリンクにする', async () => {
    await renderGrid([
      cardOf('inquiry-chat.open-inquiries', 20, InquiriesCard),
      cardOf('content-reporting.open-reports', 30, ReportsCard),
    ]);

    await expect
      .element(regionOf('未対応の問い合わせ').getByText('問い合わせの本文'))
      .toBeVisible();
    await expect
      .element(
        regionOf('未対応の問い合わせ').getByRole('link', {
          name: '未対応の問い合わせ',
        }),
      )
      .toHaveAttribute('href', '/inquiries');
    expect(regionOf('未対応の通報').getByRole('link').elements()).toHaveLength(
      0,
    );
  });

  test('読み込み中は、本文の代わりに読み込み中を示す', async () => {
    await renderGrid([cardOf('a.loading', 10, LoadingCard)]);

    await expect
      .element(regionOf('読み込み中のカード').getByRole('status'))
      .toHaveTextContent('読み込み中');
    expect(page.getByText('まだ表示されない本文').elements()).toHaveLength(0);
  });

  test('取得の失敗は、カードの中に文言と再試行を示し、問い合わせの導線を出さず、再試行で取得し直す', async () => {
    await renderGrid([cardOf('a.failed', 10, FailedQueryCard)]);

    const region = regionOf('失敗したカード');
    await expect
      .element(region.getByRole('alert'))
      .toHaveTextContent(UNAVAILABLE.message);
    expect(
      page.getByRole('link', { name: CONTACT_LABEL }).elements(),
    ).toHaveLength(0);

    await userEvent.click(region.getByRole('button', { name: RETRY_LABEL }));

    expect(retry).toHaveBeenCalledOnce();
    await expect.element(region.getByText('取得し直した本文')).toBeVisible();
  });

  test('GraphQL以外の取得の失敗は、問い合わせを促す文を含めない想定外の文言を示す', async () => {
    await renderGrid([cardOf('a.unexpected', 10, UnexpectedFailureCard)]);

    await expect
      .element(regionOf('想定外の失敗のカード').getByRole('alert'))
      .toHaveTextContent(UNEXPECTED_MESSAGE);
    expect(page.getByText(CONTACT_GUIDANCE).elements()).toHaveLength(0);
  });
});

describe('幅320px', () => {
  test('カードを並べても横スクロールが出ない', async () => {
    await page.viewport(NARROWEST_VIEWPORT_WIDTH, WIDE_VIEWPORT.height);
    await renderGrid([
      cardOf('ugc-moderation.weekly-statistics', 10, StatisticsCard, 'full'),
      cardOf('inquiry-chat.open-inquiries', 20, InquiriesCard),
    ]);

    await expect.element(regionOf('週毎の統計')).toBeVisible();
    expect(hasHorizontalScroll()).toBe(false);
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  beforeEach(() => {
    applyColorScheme(scheme);
  });

  test('空状態で、アクセシビリティの検査の違反が0件', async () => {
    await renderGrid([]);
    await expect.element(page.getByText(EMPTY_TITLE)).toBeVisible();

    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test('本文・読み込み中・失敗のカードを並べて、アクセシビリティの検査の違反が0件', async () => {
    cardFailing = true;
    await renderGrid([
      cardOf('a.statistics', 10, StatisticsCard, 'full'),
      cardOf('b.inquiries', 20, InquiriesCard),
      cardOf('c.loading', 30, LoadingCard),
      cardOf('d.failed', 40, FailedQueryCard),
      cardOf('e.broken', 50, ThrowingCard),
    ]);
    await expect.element(regionOf('失敗したカード')).toBeVisible();

    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
