import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { reportUnexpectedErrorInBrowser } from '../../../lib/start/observability/browser-error-reporting.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import { historyLaunchOf, historyMatchOf } from './match-history-fixtures.ts';
import type { ProductPageLaunchView } from './match-history-model.ts';
import { MatchHistorySection } from './match-history-section.tsx';
import { productPageViewOf } from './product-page-fixtures.ts';
import type {
  ProductLaunchSection,
  ProductLaunchSectionContext,
  ProductPageContext,
} from './product-page-section-types.ts';

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

vi.mock('../../../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

const NOW = new Date('2026-11-10T08:00:00.000Z');

const UNEXPECTED_MESSAGE =
  'ページを表示できませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。';

const LAUNCHES: readonly ProductPageLaunchView[] = [
  historyLaunchOf({
    id: 'launch-3',
    number: 3,
    launchDate: '2026-11-15',
    kickoffAt: '2026-11-14T15:00:00.000Z',
    status: 'SCHEDULED',
    summary: { label: 'キックオフ予定', inMatch: false },
    kickedOff: false,
    latestKickedOff: false,
    matches: [],
  }),
  historyLaunchOf({
    id: 'launch-2',
    number: 2,
    launchDate: '2026-10-20',
    status: 'FINISHED',
    summary: { label: 'Week準決勝敗退', inMatch: false },
    kickedOff: true,
    latestKickedOff: true,
    matches: [
      historyMatchOf({
        id: 'm-2c',
        kind: 'WEEK',
        round: 3,
        stage: 'SEMIFINAL',
        date: '2026-10-25',
        result: 'LOST',
        ownUpvoteCount: 4,
        opponentUpvoteCount: 9,
      }),
      historyMatchOf({
        id: 'm-2b',
        kind: 'WEEK',
        round: 2,
        stage: 'QUARTERFINAL',
        date: '2026-10-24',
      }),
      historyMatchOf({ id: 'm-2a', date: '2026-10-20' }),
    ],
  }),
  historyLaunchOf({
    id: 'launch-1',
    number: 1,
    launchDate: '2025-09-15',
    status: 'FINISHED',
    summary: { label: 'ディレクトリ掲載', inMatch: false },
    kickedOff: true,
    latestKickedOff: false,
    matches: [
      historyMatchOf({ id: 'm-1b', date: '2025-09-15' }),
      historyMatchOf({
        id: 'm-1a',
        result: 'BYE',
        decision: 'BYE',
        ownUpvoteCount: 0,
        opponentUpvoteCount: null,
        opponent: { kind: 'NONE', handle: null, name: null, logo: null },
      }),
    ],
  }),
];

const contextOf = (
  launches: readonly ProductPageLaunchView[] = LAUNCHES,
  isOwner = false,
): ProductPageContext => ({
  product: {
    id: '01JD0PRODUCT00000000000001',
    handle: 'Pitch-Notes',
    name: 'Pitch Notes',
    listed: true,
    ownerHandle: 'scout_ken',
  },
  viewer: { signedIn: true, isOwner },
  page: productPageViewOf({ launches: [...launches], viewerIsOwner: isOwner }),
  autoRefresh: true,
  reportAutoUpdating: () => undefined,
});

// 受け取った文脈を文言に出し、位置と順の確かめに使う
const labeledLaunchSection = (label: string) =>
  function LabeledLaunchSection({
    product,
    viewer,
    launch,
    ...rest
  }: ProductLaunchSectionContext) {
    const extraKeys = Object.keys(rest).join(',');
    return (
      <p data-launch-section="">
        {`${label}:${product.handle}:${String(viewer.isOwner)}:${launch.id}:第${String(launch.number)}回:${launch.kickedOff ? '開始済み' : '開始前'}:${launch.latestKickedOff ? '最新' : '-'}:${extraKeys}`}
      </p>
    );
  };

function ThrowingLaunchSection(): never {
  throw new Error('ローンチの区画の描画の失敗');
}

const registered = (
  id: string,
  order: number,
  component: ProductLaunchSection['component'] = labeledLaunchSection(id),
): ProductLaunchSection => ({ id, order, component });

const renderSection = ({
  launches = LAUNCHES,
  isOwner = false,
  launchSections = [],
}: {
  readonly launches?: readonly ProductPageLaunchView[];
  readonly isOwner?: boolean;
  readonly launchSections?: readonly ProductLaunchSection[];
} = {}) =>
  renderInRouter(
    <DisplayPreferencesProvider
      initial={{ timeZone: 'Asia/Tokyo', locale: 'ja-JP' }}
    >
      <main className="bg-background p-4 text-foreground">
        <MatchHistorySection
          {...contextOf(launches, isOwner)}
          launchSections={launchSections}
        />
      </main>
    </DisplayPreferencesProvider>,
    { path: '/p/Pitch-Notes' },
  );

const section = () =>
  page.getByRole('region', { name: 'マッチ履歴とコメント' });

const blocks = () => section().getByRole('article');

const block = (number: number) =>
  section().getByRole('article', { name: `第${String(number)}回ローンチ` });

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  vi.mocked(reportUnexpectedErrorInBrowser).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  applyColorScheme('light');
});

describe('MatchHistorySection', () => {
  test('見出し「マッチ履歴とコメント」を一覧の項目のコメント数のリンク先のidで置き、キックオフ前を含むローンチの数と確定したマッチの数を添える', async () => {
    await renderSection();

    const heading = section().getByRole('heading', { level: 2 });
    await expect.element(heading).toHaveTextContent('マッチ履歴とコメント');
    await expect.element(heading).toHaveAttribute('id', 'launches-heading');
    await expect
      .element(section().getByText('3ローンチ・5マッチ', { exact: true }))
      .toBeVisible();
  });

  test('ローンチのブロックを受け取った新しい順に並べ、見出しに「第◯回ローンチ」・ローンチ日・結果の要約を示す', async () => {
    await renderSection();

    expect(
      blocks()
        .elements()
        .map((element) => element.querySelector('h3')?.textContent),
    ).toStrictEqual(['第3回ローンチ', '第2回ローンチ', '第1回ローンチ']);
    const date = block(1).getByText('2025年9月15日', { exact: true }).first();
    expect(date.element().tagName).toBe('TIME');
    expect(date.element().getAttribute('datetime')).toBe('2025-09-15');
    await expect
      .element(block(2).getByText('Week準決勝敗退', { exact: true }))
      .toBeVisible();
    await expect
      .element(block(3).getByText('キックオフ予定', { exact: true }))
      .toBeVisible();
  });

  test('各ブロックに結果の確定したマッチを受け取った新しい順の一覧で示し、マッチが無いブロックにはその旨を示す', async () => {
    await renderSection();

    const list = block(2).getByRole('list', { name: '第2回ローンチのマッチ' });
    expect(
      list
        .getByRole('listitem')
        .elements()
        .map((element) => element.querySelector('time')?.textContent),
    ).toStrictEqual(['10月25日', '10月24日', '10月20日']);
    await expect
      .element(block(2).getByText('Week 準決勝', { exact: true }))
      .toBeVisible();
    expect(
      block(1)
        .getByRole('list', { name: '第1回ローンチのマッチ' })
        .getByRole('listitem')
        .elements(),
    ).toHaveLength(2);
    expect(block(3).getByRole('list').elements()).toStrictEqual([]);
    await expect
      .element(block(3).getByText('にキックオフします。', { exact: false }))
      .toBeVisible();
    await expect
      .element(
        block(3).getByRole('link', {
          name: 'トップページで本日のマッチを見る',
        }),
      )
      .toBeVisible();
  });

  test('予選マッチが開催中で確定したマッチの無いブロックは「マッチを見る」を示し、投稿者本人のキックオフ前のブロックはリンクのコピーを示す', async () => {
    await renderSection({
      isOwner: true,
      launches: [
        historyLaunchOf({
          id: 'launch-2',
          number: 2,
          status: 'SCHEDULED',
          kickedOff: false,
          latestKickedOff: false,
          matches: [],
        }),
        historyLaunchOf({
          id: 'launch-1',
          number: 1,
          status: 'IN_PROGRESS',
          summary: { label: '予選マッチ中', inMatch: true },
          matches: [],
        }),
      ],
    });

    await expect
      .element(block(1).getByRole('link', { name: 'マッチを見る' }))
      .toHaveAttribute('href', '#live-match-heading');
    await expect
      .element(
        block(2).getByRole('button', {
          name: 'リンクをコピーして応援を呼びかける',
        }),
      )
      .toBeVisible();
    await expect
      .element(section().getByText('2ローンチ・0マッチ', { exact: true }))
      .toBeVisible();
  });

  test('登録されたローンチの区画を各ブロックのマッチの一覧の下にorderの順で描き、ローンチの回・キックオフ済みか・キックオフ済みで最新かを渡す', async () => {
    await renderSection({
      isOwner: true,
      launchSections: [
        registered('test.second', 20),
        registered('test.first', 10),
      ],
    });

    const textsOf = (number: number) =>
      Array.from(
        block(number).element().querySelectorAll('[data-launch-section]'),
        (element) => element.textContent,
      );
    expect(textsOf(2)).toStrictEqual([
      'test.first:Pitch-Notes:true:launch-2:第2回:開始済み:最新:',
      'test.second:Pitch-Notes:true:launch-2:第2回:開始済み:最新:',
    ]);
    expect(textsOf(3)).toStrictEqual([
      'test.first:Pitch-Notes:true:launch-3:第3回:開始前:-:',
      'test.second:Pitch-Notes:true:launch-3:第3回:開始前:-:',
    ]);
    expect(textsOf(1)).toStrictEqual([
      'test.first:Pitch-Notes:true:launch-1:第1回:開始済み:-:',
      'test.second:Pitch-Notes:true:launch-1:第1回:開始済み:-:',
    ]);
    const list = block(2).getByRole('list').element();
    const firstSection = block(2)
      .element()
      .querySelector('[data-launch-section]');
    expect(
      firstSection !== null &&
        (list.compareDocumentPosition(firstSection) &
          Node.DOCUMENT_POSITION_FOLLOWING) !==
          0,
    ).toBe(true);
  });

  test('1つのローンチの区画の失敗はその位置に失敗の文言と再試行を示し、同じブロックの他の区画と他のブロックの表示を続ける', async () => {
    await renderSection({
      launches: [LAUNCHES[1] as ProductPageLaunchView],
      launchSections: [
        registered('test.broken', 10, ThrowingLaunchSection),
        registered('test.after', 20),
      ],
    });

    await expect
      .element(block(2).getByRole('alert'))
      .toHaveTextContent(UNEXPECTED_MESSAGE);
    await expect
      .element(block(2).getByRole('button', { name: '再試行' }))
      .toBeVisible();
    await expect.element(block(2).getByText(/^test\.after:/u)).toBeVisible();
    await expect
      .element(block(2).getByRole('list', { name: '第2回ローンチのマッチ' }))
      .toBeVisible();
    expect(reportUnexpectedErrorInBrowser).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'ローンチの区画の描画の失敗' }),
      'render',
    );
  });

  test('何も描かないローンチの区画は枠を表示から外す', async () => {
    await renderSection({
      launches: [LAUNCHES[1] as ProductPageLaunchView],
      launchSections: [registered('test.empty', 10, () => null)],
    });

    const slot = block(2)
      .element()
      .querySelector('[data-product-launch-section-rendered]')?.parentElement;
    expect(slot).toBeInstanceOf(HTMLElement);
    expect(getComputedStyle(slot as HTMLElement).display).toBe('contents');
  });

  test('取り消されていないローンチが無ければ区画を描かない', async () => {
    await renderSection({ launches: [] });

    expect(page.getByRole('main').element().textContent).toBe('');
  });

  test.each(COLOR_SCHEMES)('%sの配色でaxeの違反が0件である', async (scheme) => {
    applyColorScheme(scheme);
    await renderSection({ launchSections: [registered('test.first', 10)] });
    await expect.element(block(1)).toBeVisible();

    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
