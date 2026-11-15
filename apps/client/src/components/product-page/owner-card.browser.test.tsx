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
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import type { DisplayPreferences } from '../../../lib/utilities/datetime/display-preferences.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import {
  ClientProductOwnerStatusDocument,
  type ClientProductOwnerStatusQuery,
} from '../../graphql/generated/graphql.ts';
import { historyLaunchOf } from './match-history-fixtures.ts';
import { OwnerCard } from './owner-card.tsx';
import { productPageViewOf } from './product-page-fixtures.ts';
import type {
  ProductOwnerAction,
  ProductOwnerActionContext,
  ProductPageContext,
} from './product-page-section-types.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

vi.mock('../../../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

const TOKYO_JA: DisplayPreferences = {
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
};

// 業務日付2026-11-12の0:00(日本時間)
const NOW = new Date('2026-11-11T15:00:00.000Z');

// 業務日付2026-11-15の0:00(日本時間)
const RELEASE_AT = '2026-11-14T15:00:00.000Z';

const EDIT_HREF = '/my/products/Pitch-Notes/edit';

const QUALIFIER_BLOCK_MESSAGE =
  'このプロダクトは予選マッチに参加中のため再ローンチできません。';
const WEEK_BLOCK_MESSAGE =
  'このプロダクトはWeekトーナメントに参加できる期間中のため再ローンチできません。';
const LOCK_MESSAGE =
  'マッチ直前・マッチ中のため、ローンチ日・カテゴリの変更と削除はできません。';
const LOCK_UNKNOWN_MESSAGE =
  'ローンチの状態を確認できませんでした。時間をおいて再度お試しください。';
const STATUS_FAILED_MESSAGE =
  '再ローンチの予約の状態を確かめられませんでした。時間をおいて再度お試しください。';
const UNEXPECTED_MESSAGE =
  'ページを表示できませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。';

type OwnerPlan = NonNullable<
  ClientProductOwnerStatusQuery['productOwnerStatus']
>['plan'];

const planOf = (overrides: Partial<OwnerPlan> = {}): OwnerPlan => ({
  mode: 'NEW',
  currentLaunchDate: null,
  window: {
    earliest: '2026-11-13',
    latest: '2027-02-08',
    unavailable: [],
    relaunchIntervalDays: null,
  },
  blocks: [],
  locked: false,
  locks: [],
  lockUnknown: false,
  ultrasEntitled: false,
  ...overrides,
});

const statusOf = (plan: OwnerPlan): ClientProductOwnerStatusQuery => ({
  productOwnerStatus: {
    latestLaunch: {
      id: 'launch-2',
      number: 2,
      launchDate: '2026-11-04',
      kickoffAt: '2026-11-03T15:00:00.000Z',
      status: 'FINISHED',
      outcome: 'LOST',
      summary: { label: '予選敗北', inMatch: false },
    },
    plan,
  },
});

const INTERVAL_PLAN = planOf({
  window: {
    earliest: '2026-11-18',
    latest: '2027-02-08',
    unavailable: [
      { from: '2026-11-13', to: '2026-11-17', reason: 'RELAUNCH_INTERVAL' },
    ],
    relaunchIntervalDays: 14,
  },
});

const BLOCKED_PLAN = planOf({
  mode: 'BLOCKED',
  window: null,
  blocks: [
    {
      code: 'tournament-week.entry-open',
      message: WEEK_BLOCK_MESSAGE,
      releaseAt: RELEASE_AT,
    },
  ],
});

const LOCKED_PLAN = planOf({
  mode: 'BLOCKED',
  window: null,
  blocks: [
    {
      code: 'qualifier_in_progress',
      message: QUALIFIER_BLOCK_MESSAGE,
      releaseAt: null,
    },
  ],
  locked: true,
  locks: [{ code: 'qualifier_match', message: LOCK_MESSAGE }],
});

const INTERNAL_ERROR = new GraphQLClientError({
  code: 'internal_error',
  message: 'サーバーでエラーが発生しました。',
  status: 500,
});

const respondWith = (status: ClientProductOwnerStatusQuery | Error) => {
  executeGraphQL.mockImplementation((document: unknown) => {
    if (document === ClientProductOwnerStatusDocument) {
      return Promise.resolve(
        status instanceof Error
          ? { ok: false, error: status }
          : { ok: true, data: status },
      );
    }
    return Promise.reject(new Error('想定外の操作です。'));
  });
};

const statusCalls = () =>
  executeGraphQL.mock.calls.filter(
    ([document]) => document === ClientProductOwnerStatusDocument,
  );

const LATEST_LAUNCHES = [
  historyLaunchOf({
    id: 'launch-2',
    number: 2,
    summary: { label: '予選敗北', inMatch: false },
  }),
  historyLaunchOf({
    id: 'launch-1',
    number: 1,
    summary: { label: 'ディレクトリ掲載', inMatch: false },
  }),
];

const contextOf = (isOwner: boolean): ProductPageContext => ({
  product: {
    id: '01JD0PRODUCT00000000000001',
    handle: 'Pitch-Notes',
    name: 'Pitch Notes',
    listed: true,
    ownerHandle: 'pitch_maker',
  },
  viewer: { signedIn: true, isOwner },
  page: productPageViewOf({
    launches: [...LATEST_LAUNCHES],
    viewerIsOwner: isOwner,
  }),
  autoRefresh: true,
  reportAutoUpdating: () => undefined,
});

// 受け取った文脈を文言に出し、位置と順の確かめに使う
const labeledAction = (label: string) =>
  function LabeledOwnerAction({
    product,
    viewer,
    ...rest
  }: ProductOwnerActionContext) {
    return (
      <p data-owner-action="">
        {`${label}:${product.handle}:${product.ownerHandle}:${String(viewer.isOwner)}:${Object.keys(rest).join(',')}`}
      </p>
    );
  };

function ThrowingOwnerAction(): never {
  throw new Error('投稿者本人向けの操作の描画の失敗');
}

const registered = (
  id: string,
  order: number,
  component: ProductOwnerAction['component'] = labeledAction(id),
): ProductOwnerAction => ({ id, order, component });

const renderCard = ({
  isOwner = true,
  ownerActions = [],
}: {
  readonly isOwner?: boolean;
  readonly ownerActions?: readonly ProductOwnerAction[];
} = {}) =>
  renderInRouter(
    <DisplayPreferencesProvider initial={{ ...TOKYO_JA }}>
      <main className="bg-background p-4 text-foreground">
        <OwnerCard {...contextOf(isOwner)} ownerActions={ownerActions} />
      </main>
    </DisplayPreferencesProvider>,
    { cachedViewer: signedInViewerQuery(), path: '/p/Pitch-Notes' },
  );

const card = () => page.getByRole('region', { name: 'あなたのプロダクト' });

const editLink = () => card().getByRole('link', { name: '編集' });

const reserveLink = () =>
  card().getByRole('link', { name: '再ローンチを予約' });

const reserveButton = () =>
  card().getByRole('button', { name: '再ローンチを予約' });

const descriptionOf = (element: Element): string =>
  (element.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter((id) => id !== '')
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join('');

beforeEach(async () => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  await emulateBrowserDisplay(TOKYO_JA);
  executeGraphQL.mockReset();
  vi.mocked(reportUnexpectedErrorInBrowser).mockClear();
});

afterEach(async () => {
  vi.useRealTimers();
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('OwnerCard', () => {
  test('投稿者本人には、破線の枠の「あなたのプロダクト」の区画に「投稿者にのみ表示」の印と直近のローンチの結果の要約を示す', async () => {
    respondWith(statusOf(planOf()));
    await renderCard();

    await expect.element(card()).toBeVisible();
    await expect
      .element(card().getByRole('heading', { level: 2 }))
      .toHaveTextContent('あなたのプロダクト');
    const style = getComputedStyle(card().element());
    expect(style.borderTopStyle).toBe('dashed');
    expect(card().element().getAttribute('data-slot')).toBe('card');
    await expect
      .element(card().getByText('投稿者にのみ表示', { exact: true }))
      .toBeVisible();
    await expect
      .element(card().getByText('予選敗北', { exact: true }))
      .toBeVisible();
    expect(card().getByText('ディレクトリ掲載').query()).toBeNull();
    expect(statusCalls()).toStrictEqual([
      [
        ClientProductOwnerStatusDocument,
        { productHandle: 'Pitch-Notes' },
        expect.anything(),
      ],
    ]);
  });

  test('「編集」と、予約できる時の「再ローンチを予約」はどちらも編集の画面へ移す', async () => {
    respondWith(statusOf(planOf()));
    await renderCard();

    await expect.element(editLink()).toHaveAttribute('href', EDIT_HREF);
    await expect.element(reserveLink()).toHaveAttribute('href', EDIT_HREF);
    expect(reserveLink().element().getAttribute('aria-describedby')).toBe(null);
    expect(
      card()
        .getByText(/以降のローンチ日を選べます。$/u)
        .query(),
    ).toBeNull();
  });

  test('投稿者本人でなければ照会せず、何も描かない', async () => {
    respondWith(statusOf(planOf()));
    await renderCard({ isOwner: false });

    await expect.element(page.getByRole('main')).toBeEmptyDOMElement();
    expect(statusCalls()).toStrictEqual([]);
  });

  test('予約が禁止されていれば「再ローンチを予約」を無効にし、理由と解除の日時を併記する', async () => {
    respondWith(statusOf(BLOCKED_PLAN));
    await renderCard();

    await expect.element(reserveButton()).toBeDisabled();
    expect(reserveLink().query()).toBeNull();
    await expect
      .element(card().getByText(WEEK_BLOCK_MESSAGE, { exact: true }))
      .toBeVisible();
    const release = card().getByText(/^解除: /u);
    await expect
      .element(release)
      .toHaveTextContent('解除: 11月15日(日) 00:00(あと3日)');
    expect(card().element().querySelector('time')?.dateTime).toBe(RELEASE_AT);
    expect(descriptionOf(reserveButton().element())).toBe(
      `${WEEK_BLOCK_MESSAGE}解除: 11月15日(日) 00:00(あと3日)`,
    );
    await expect.element(editLink()).toHaveAttribute('href', EDIT_HREF);
  });

  test('予選の敗北後の間隔の制限中は「再ローンチを予約」を有効にしたまま、選べる最も早い日を併記する', async () => {
    respondWith(statusOf(INTERVAL_PLAN));
    await renderCard();

    await expect.element(reserveLink()).toHaveAttribute('href', EDIT_HREF);
    const notice = card().getByText(/以降のローンチ日を選べます。$/u);
    await expect
      .element(notice)
      .toHaveTextContent(
        'このプロダクトは11月18日以降のローンチ日を選べます。',
      );
    expect(notice.element().querySelector('time')?.dateTime).toBe('2026-11-18');
    expect(descriptionOf(reserveLink().element())).toBe(
      'このプロダクトは11月18日以降のローンチ日を選べます。',
    );
  });

  test('マッチ直前・マッチ中は、ローンチ日・カテゴリの変更と削除ができない旨を添える', async () => {
    respondWith(statusOf(LOCKED_PLAN));
    await renderCard();

    await expect.element(reserveButton()).toBeDisabled();
    await expect
      .element(card().getByText(QUALIFIER_BLOCK_MESSAGE, { exact: true }))
      .toBeVisible();
    await expect
      .element(card().getByText(LOCK_MESSAGE, { exact: true }))
      .toBeVisible();
    await expect.element(editLink()).toHaveAttribute('href', EDIT_HREF);
  });

  test('固定を判定できなければ、ローンチ日・カテゴリの変更と削除を受け付けない理由を添える', async () => {
    respondWith(statusOf(planOf({ lockUnknown: true })));
    await renderCard();

    await expect
      .element(card().getByText(LOCK_UNKNOWN_MESSAGE, { exact: true }))
      .toBeVisible();
    await expect.element(reserveLink()).toBeVisible();
  });

  test.each([
    ['照会に失敗した', INTERNAL_ERROR],
    ['本人のプロダクトが見つからなかった', { productOwnerStatus: null }],
    ['予約の可否を判定できなかった', statusOf(planOf({ mode: 'UNKNOWN' }))],
  ] as const)(
    '%s時は区画を表示したまま「再ローンチを予約」を無効にし、時間をおいて再度試す旨を示す',
    async (_case, status) => {
      respondWith(status);
      await renderCard();

      await expect.element(reserveButton()).toBeDisabled();
      await expect
        .element(card().getByText(STATUS_FAILED_MESSAGE, { exact: true }))
        .toBeVisible();
      expect(descriptionOf(reserveButton().element())).toBe(
        STATUS_FAILED_MESSAGE,
      );
      await expect.element(editLink()).toHaveAttribute('href', EDIT_HREF);
      await expect
        .element(card().getByText('予選敗北', { exact: true }))
        .toBeVisible();
    },
  );

  test('予約の可否と固定のどちらも判定できなかった時は、確かめられない旨だけを示し、判定できた固定の注記は添える', async () => {
    respondWith(
      statusOf(
        planOf({
          mode: 'UNKNOWN',
          window: null,
          locked: true,
          locks: [{ code: 'qualifier_match', message: LOCK_MESSAGE }],
          lockUnknown: true,
        }),
      ),
    );
    await renderCard();

    await expect
      .element(card().getByText(STATUS_FAILED_MESSAGE, { exact: true }))
      .toBeVisible();
    await expect
      .element(card().getByText(LOCK_MESSAGE, { exact: true }))
      .toBeVisible();
    expect(
      card().getByText(LOCK_UNKNOWN_MESSAGE, { exact: false }).query(),
    ).toBeNull();
  });

  test('照会の結果が届くまでは「再ローンチを予約」を押せないまま理由を示さない', async () => {
    executeGraphQL.mockReturnValue(new Promise(() => undefined));
    await renderCard();

    await expect.poll(() => statusCalls().length).toBe(1);
    await expect.element(reserveButton()).toBeDisabled();
    expect(reserveButton().element().getAttribute('aria-describedby')).toBe(
      null,
    );
    expect(card().getByText(STATUS_FAILED_MESSAGE).query()).toBeNull();
  });

  test('登録された操作を進行状況の下、「編集」「再ローンチを予約」の上にorderの順で描き、プロダクトと閲覧者だけを渡す', async () => {
    respondWith(statusOf(planOf()));
    await renderCard({
      ownerActions: [
        registered('test.second', 20),
        registered('test.first', 10),
      ],
    });

    await expect.element(reserveLink()).toBeVisible();
    const actions = Array.from(
      card().element().querySelectorAll('[data-owner-action]'),
    );
    expect(actions.map((element) => element.textContent)).toStrictEqual([
      'test.first:Pitch-Notes:pitch_maker:true:',
      'test.second:Pitch-Notes:pitch_maker:true:',
    ]);
    const headline = card().getByText('予選敗北', { exact: true }).element();
    const follows = (before: Node, after: Node) =>
      (before.compareDocumentPosition(after) &
        Node.DOCUMENT_POSITION_FOLLOWING) !==
      0;
    expect(follows(headline, actions[0] as Node)).toBe(true);
    expect(follows(actions[1] as Node, editLink().element())).toBe(true);
  });

  test('1つの登録された操作の失敗はその位置に失敗の文言と再試行を示し、他の操作と区画の表示を続ける', async () => {
    respondWith(statusOf(planOf()));
    await renderCard({
      ownerActions: [
        registered('test.broken', 10, ThrowingOwnerAction),
        registered('test.after', 20),
      ],
    });

    await expect
      .element(card().getByRole('alert'))
      .toHaveTextContent(UNEXPECTED_MESSAGE);
    await expect
      .element(card().getByRole('button', { name: '再試行' }))
      .toBeVisible();
    await expect.element(card().getByText(/^test\.after:/u)).toBeVisible();
    await expect.element(reserveLink()).toBeVisible();
    expect(reportUnexpectedErrorInBrowser).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '投稿者本人向けの操作の描画の失敗',
      }),
      'render',
    );
  });

  test('何も描かない登録された操作は枠を表示から外す', async () => {
    respondWith(statusOf(planOf()));
    await renderCard({
      ownerActions: [registered('test.empty', 10, () => null)],
    });

    await expect.element(reserveLink()).toBeVisible();
    const slot = card()
      .element()
      .querySelector('[data-product-owner-action-rendered]')?.parentElement;
    expect(slot).toBeInstanceOf(HTMLElement);
    expect(getComputedStyle(slot as HTMLElement).display).toBe('contents');
  });

  test.each(COLOR_SCHEMES)('%sの配色でaxeの違反が0件である', async (scheme) => {
    applyColorScheme(scheme);
    respondWith(statusOf(LOCKED_PLAN));
    await renderCard({ ownerActions: [registered('test.first', 10)] });
    await expect.element(card().getByText(LOCK_MESSAGE)).toBeVisible();

    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test.each(COLOR_SCHEMES)(
    '%sの配色で予約できる時もaxeの違反が0件である',
    async (scheme) => {
      applyColorScheme(scheme);
      respondWith(statusOf(INTERVAL_PLAN));
      await renderCard();
      await expect.element(reserveLink()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
