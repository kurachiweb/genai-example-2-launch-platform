import { notifyManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { executeGraphQL } from '../../../lib/start/graphql/execute-graphql.ts';
import { reportUnexpectedErrorInBrowser } from '../../../lib/start/observability/browser-error-reporting.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import {
  ClientLaunchHistoryDocument,
  type ClientLaunchHistoryQuery,
  type ClientLaunchHistoryQueryVariables,
  ClientUpvoteHistoryDocument,
} from '../../graphql/generated/graphql.ts';
import {
  PROFILE_HANDLE,
  publicProfileOf,
} from '../profile/public-profile-fixtures.ts';
import { renderPublicProfilePage } from '../profile/public-profile-page-testing.tsx';

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

vi.mock('../../../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

const executeGraphQLMock = vi.mocked(executeGraphQL);

const PAGE_SIZE = 20;

// 業務日付2026-11-12の0:00(UTC-08:00)
const KICKOFF_ISO = '2026-11-12T08:00:00.000Z';
const NOW = new Date('2026-11-10T08:00:00.000Z');

const LOAD_ERROR =
  'ローンチしたプロダクトを読み込めませんでした。時間をおいて再度お試しください。';
const LOAD_MORE_ERROR = '続きを読み込めませんでした。';
const EMPTY_TITLE = 'まだローンチしたプロダクトはありません。';
const EMPTY_OWNER_DESCRIPTION =
  'ローンチ日には予選マッチで1対1の対戦が始まります。勝利するとディレクトリに掲載されます。';
const UNLISTED_NOTICE =
  '未掲載のプロダクトはあなたにだけ表示されています。予選で勝利するとディレクトリに掲載され、誰でも見られるようになります。';

type LaunchHistory = NonNullable<ClientLaunchHistoryQuery['launchHistory']>;
type HistoryNode = LaunchHistory['nodes'][number];
type HistoryLaunch = HistoryNode['launches'][number];

const launchOf = (
  number: number,
  overrides: Partial<HistoryLaunch> = {},
): HistoryLaunch => ({
  id: `01JD0LAUNCH00000000000000${number.toString().padStart(2, '0')}`,
  number,
  launchDate: `2026-0${number.toString()}-15`,
  kickoffAt: `2026-0${number.toString()}-15T08:00:00.000Z`,
  status: 'FINISHED',
  outcome: 'LOST',
  summary: { label: '予選敗北', inMatch: false },
  ...overrides,
});

const PITCH: HistoryNode = {
  product: {
    handle: 'pitch-notes',
    name: 'Pitch Notes',
    tagline: 'ピッチの台本を書いて練習できるノートアプリ。'.repeat(8),
    websiteUrl: 'https://pitch-notes.example/',
    listed: true,
    category: {
      id: '01JD0CATEGORY0000000000001',
      name: '開発ツール',
      handle: 'dev-tools',
    },
    logo: {
      id: '01JD0FILE00000000000000001',
      objectKey: '0123456789abcdef'.repeat(2),
      fallbackFormat: 'PNG',
      width: 512,
      height: 512,
    },
  },
  launches: [5, 4, 3, 2, 1].map((number) =>
    launchOf(
      number,
      number === 5
        ? {
            outcome: 'WON',
            summary: { label: 'Product of the Week', inMatch: false },
          }
        : {},
    ),
  ),
  awards: [
    {
      kind: 'WEEK',
      count: 3,
      labels: [
        '2026年第37週(9/7〜9/13)',
        '2026年第38週(9/14〜9/20)',
        '2026年第40週(9/28〜10/4)',
      ],
    },
    { kind: 'YEAR', count: 1, labels: ['2026年'] },
  ],
};

const MATCHING: HistoryNode = {
  product: {
    ...PITCH.product,
    handle: 'match-board',
    name: 'Match Board',
    tagline: '対戦を記録するボード',
    websiteUrl: 'https://match-board.example/',
    listed: false,
    logo: null,
  },
  launches: [
    launchOf(1, {
      launchDate: '2026-11-10',
      kickoffAt: '2026-11-10T08:00:00.000Z',
      status: 'IN_PROGRESS',
      outcome: null,
      summary: { label: '予選マッチ中', inMatch: true },
    }),
  ],
  awards: [],
};

const SCHEDULED: HistoryNode = {
  product: {
    ...PITCH.product,
    handle: 'fresh-idea',
    name: 'Fresh Idea',
    tagline: 'これからローンチするプロダクト',
    websiteUrl: 'https://fresh-idea.example/',
    listed: false,
    logo: null,
  },
  launches: [
    launchOf(1, {
      launchDate: '2026-11-12',
      kickoffAt: KICKOFF_ISO,
      status: 'SCHEDULED',
      outcome: null,
      summary: { label: 'キックオフ予定', inMatch: false },
    }),
  ],
  awards: [],
};

const historyOf = (
  nodes: readonly HistoryNode[],
  overrides: Partial<Omit<LaunchHistory, 'nodes'>> = {},
): LaunchHistory => ({
  viewerIsOwner: false,
  ownerSuspended: false,
  totalCount: nodes.length,
  nodes: [...nodes],
  pageInfo: { endCursor: null, hasNextPage: false },
  ...overrides,
});

const ok = (launchHistory: LaunchHistory | null) => ({
  ok: true,
  data: { launchHistory } satisfies ClientLaunchHistoryQuery,
});

const LOAD_FAILURE = {
  ok: false,
  error: new GraphQLClientError({
    code: 'internal_error',
    message: 'サーバーでエラーが発生しました。',
    status: 500,
  }),
} as const;

type Responder = (variables: ClientLaunchHistoryQueryVariables) => unknown;

const respond = (responder: Responder) => {
  executeGraphQLMock.mockImplementation(((
    document: unknown,
    variables: ClientLaunchHistoryQueryVariables,
  ) => {
    if (document === ClientLaunchHistoryDocument) {
      return Promise.resolve(responder(variables));
    }
    if (document === ClientUpvoteHistoryDocument) {
      return Promise.resolve({ ok: true, data: { upvoteHistory: null } });
    }
    throw new Error('想定していない操作が実行されました。');
  }) as never);
};

const historyCalls = () =>
  executeGraphQLMock.mock.calls.filter(
    ([document]) => document === ClientLaunchHistoryDocument,
  );

const productsFrom = (start: number, count: number): HistoryNode[] =>
  Array.from({ length: count }, (_, index) => ({
    ...PITCH,
    product: {
      ...PITCH.product,
      handle: `product-${(start + index).toString()}`,
      name: `プロダクト${(start + index).toString()}`,
    },
    awards: [],
  }));

const renderHistory = ({
  owner = false,
  suspended = false,
}: { readonly owner?: boolean; readonly suspended?: boolean } = {}) =>
  renderPublicProfilePage(
    publicProfileOf({
      viewerRelation: owner ? 'OWNER' : 'NOT_FOLLOWING',
      suspended,
    }),
    owner
      ? {
          cachedViewer: signedInViewerQuery({
            handle: PROFILE_HANDLE,
            ...(suspended ? { status: 'SUSPENDED' } : {}),
          }),
        }
      : {},
  );

const panel = () => page.getByRole('tabpanel');
const items = () => panel().getByRole('article');
const itemOf = (name: string) => panel().getByRole('article', { name });
const historyTab = () => page.getByRole('tab', { name: /ローンチ履歴/ });
const loadMoreButton = () =>
  panel().getByRole('button', { name: 'さらに読み込む' });

const SYSTEM_NOTIFY_SCHEDULER = (callback: () => void): void => {
  setTimeout(callback, 0);
};

beforeEach(async () => {
  executeGraphQLMock.mockReset();
  vi.mocked(reportUnexpectedErrorInBrowser).mockClear();
  await emulateBrowserDisplay({ timeZone: 'Asia/Tokyo', locale: 'ja-JP' });
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  notifyManager.setScheduler(SYSTEM_NOTIFY_SCHEDULER);
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('ローンチ履歴のタブ', () => {
  test('既定のタブとして選び、件数を添える', async () => {
    respond(() => ok(historyOf([PITCH], { totalCount: 1234 })));

    await renderHistory();

    await expect
      .element(page.getByRole('tab', { name: /ローンチ履歴\s*1,234\s*件/ }))
      .toHaveAttribute('aria-selected', 'true');
    await expect.element(itemOf('Pitch Notes')).toBeVisible();
    expect(historyCalls()).toHaveLength(1);
    expect(historyCalls()[0]?.[1]).toEqual({
      userHandle: PROFILE_HANDLE,
      first: PAGE_SIZE,
    });
  });
});

describe('項目', () => {
  test('ロゴ・名称・タグライン・カテゴリ・「サイトを開く」を示し、名称のリンクを項目全体に広げる', async () => {
    respond(() => ok(historyOf([PITCH])));

    await renderHistory();

    const item = itemOf('Pitch Notes');
    await expect.element(item).toBeVisible();
    await expect
      .element(item.getByRole('img', { name: 'Pitch Notesのロゴ' }))
      .toBeInTheDocument();
    const nameLink = item.getByRole('link', {
      name: 'Pitch Notes',
      exact: true,
    });
    await expect.element(nameLink).toHaveAttribute('href', '/p/pitch-notes');
    expect(getComputedStyle(item.element()).position).toBe('relative');
    const cover = getComputedStyle(nameLink.element(), '::after');
    expect(cover.position).toBe('absolute');
    expect(cover.inset).toBe('0px');

    const tagline = item.getByText(PITCH.product.tagline);
    expect(getComputedStyle(tagline.element()).webkitLineClamp).toBe('2');

    await expect
      .element(item.getByRole('link', { name: '開発ツール' }))
      .toHaveAttribute('href', '/p?category=dev-tools');
    const site = item.getByRole('link', { name: /サイトを開く/ });
    await expect
      .element(site)
      .toHaveAttribute('href', 'https://pitch-notes.example/');
    await expect.element(site).toHaveAttribute('target', '_blank');
    await expect.element(site).toHaveAttribute('rel', 'noopener');
    await expect
      .element(site)
      .toHaveAccessibleName(
        /^Pitch Notesの\s*サイトを開く\s*\(新しいタブで開きます\)$/u,
      );
    expect(item.getByRole('link', { name: /を編集/ }).elements()).toHaveLength(
      0,
    );
  });

  test('受賞バッジはYearを先頭に並べ、回数とツールチップを示す', async () => {
    respond(() => ok(historyOf([PITCH])));

    await renderHistory();

    const item = itemOf('Pitch Notes');
    await expect.element(item).toBeVisible();
    const awards = item.getByRole('button', { name: /^Product of the/ });
    expect(awards.elements().map((award) => award.textContent)).toEqual([
      'Product of the Year',
      'Product of the Week ×3',
    ]);
    await expect
      .element(item.getByRole('button', { name: 'Product of the Week ×3' }))
      .toHaveAccessibleDescription(
        '2026年第37週(9/7〜9/13)、2026年第38週(9/14〜9/20)、2026年第40週(9/28〜10/4)',
      );
  });

  test('ローンチは新しい順に3件まで「第◯回」・ローンチ日・要約を示し、「他◯回を表示」で残りを開いて最初に開いたローンチへフォーカスを移す', async () => {
    respond(() => ok(historyOf([PITCH])));

    await renderHistory();

    const item = itemOf('Pitch Notes');
    const launches = item.getByRole('listitem').filter({ hasText: /第\d回/ });
    await expect.poll(() => launches.elements()).toHaveLength(3);
    expect(launches.elements().map((launch) => launch.textContent)).toEqual([
      expect.stringMatching(/^第5回.*5月15日.*Product of the Week$/),
      expect.stringMatching(/^第4回.*4月15日.*予選敗北$/),
      expect.stringMatching(/^第3回.*3月15日.*予選敗北$/),
    ]);
    expect(
      item.element().querySelector('time[datetime="2026-05-15"]'),
    ).not.toBeNull();

    await userEvent.click(item.getByRole('button', { name: '他2回を表示' }));

    await expect.poll(() => launches.elements()).toHaveLength(5);
    await expect.element(launches.nth(3)).toHaveFocus();
    expect(
      item.getByRole('button', { name: '他2回を表示' }).elements(),
    ).toHaveLength(0);
  });

  test('マッチ中は要約に「トップページで見る」を添え、キックオフ予定はキックオフの日時と残りを示す', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    respond(() => ok(historyOf([SCHEDULED, MATCHING])));

    await renderHistory();

    const matching = itemOf('Match Board');
    await expect.element(matching.getByText('予選マッチ中')).toBeVisible();
    await expect
      .element(matching.getByRole('link', { name: 'トップページで見る' }))
      .toHaveAttribute('href', '/');

    const scheduled = itemOf('Fresh Idea');
    await expect.element(scheduled.getByText('キックオフ予定')).toBeVisible();
    await expect
      .element(scheduled.getByText(/キックオフ: 11月12日\(木\) 17:00/))
      .toBeVisible();
    await expect.element(scheduled.getByText(/あと2日/)).toBeVisible();
    expect(
      scheduled.element().querySelector(`time[datetime="${KICKOFF_ISO}"]`),
    ).not.toBeNull();
  });

  test('他人の閲覧では未掲載のバッジ・案内文・「編集」を出さない', async () => {
    respond(() => ok(historyOf([PITCH])));

    await renderHistory();

    await expect.element(itemOf('Pitch Notes')).toBeVisible();
    expect(page.getByText('未掲載・あなたにだけ表示').elements()).toHaveLength(
      0,
    );
    expect(page.getByText(UNLISTED_NOTICE).elements()).toHaveLength(0);
  });
});

describe('本人の閲覧', () => {
  test('未掲載のプロダクトにバッジを付けて一覧の上に案内文を1行置き、「サイトを開く」にugcを付け、「編集」を示す', async () => {
    respond(() => ok(historyOf([MATCHING, PITCH], { viewerIsOwner: true })));

    await renderHistory({ owner: true });

    const unlisted = itemOf('Match Board');
    await expect
      .element(unlisted.getByText('未掲載・あなたにだけ表示'))
      .toBeVisible();
    await expect
      .element(unlisted.getByRole('link', { name: /サイトを開く/ }))
      .toHaveAttribute('rel', 'noopener ugc');
    await expect
      .element(unlisted.getByRole('link', { name: 'Match Boardを編集' }))
      .toHaveAttribute('href', '/my/products/match-board/edit');

    const listed = itemOf('Pitch Notes');
    await expect
      .element(listed.getByRole('link', { name: /サイトを開く/ }))
      .toHaveAttribute('rel', 'noopener');
    expect(
      listed.getByText('未掲載・あなたにだけ表示').elements(),
    ).toHaveLength(0);

    const notice = panel().getByText(UNLISTED_NOTICE);
    await expect.element(notice).toBeVisible();
    expect(
      notice.element().compareDocumentPosition(items().first().element()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test('停止中の本人には「非公開」のバッジを付けて薄く表示し、リンク・「サイトを開く」・「編集」を出さない', async () => {
    respond(() =>
      ok(
        historyOf([PITCH, MATCHING], {
          viewerIsOwner: true,
          ownerSuspended: true,
        }),
      ),
    );

    await renderHistory({ owner: true, suspended: true });

    const item = itemOf('Pitch Notes');
    await expect.element(item.getByText('非公開')).toBeVisible();
    const logo = item.getByRole('img', { name: 'Pitch Notesのロゴ' });
    expect(Number(getComputedStyle(logo.element()).opacity)).toBeLessThan(1);
    expect(getComputedStyle(item.element()).borderStyle).toBe('dashed');
    expect(item.getByRole('link').elements()).toHaveLength(0);
    expect(itemOf('Match Board').getByRole('link').elements()).toHaveLength(0);
    await expect.element(item.getByText('開発ツール')).toBeVisible();
  });
});

describe('0件', () => {
  test('他人には事実だけを示す', async () => {
    respond(() => ok(historyOf([])));

    await renderHistory();

    await expect.element(panel().getByText(EMPTY_TITLE)).toBeVisible();
    expect(panel().getByText(EMPTY_OWNER_DESCRIPTION).elements()).toHaveLength(
      0,
    );
    expect(panel().getByRole('link').elements()).toHaveLength(0);
  });

  test('本人には次の行動の説明とローンチの予約への導線を添える', async () => {
    respond(() => ok(historyOf([], { viewerIsOwner: true })));

    await renderHistory({ owner: true });

    await expect.element(panel().getByText(EMPTY_TITLE)).toBeVisible();
    await expect
      .element(panel().getByText(EMPTY_OWNER_DESCRIPTION))
      .toBeVisible();
    await expect
      .element(panel().getByRole('link', { name: '新しいプロダクトを登録' }))
      .toHaveAttribute('href', '/my/products/new');
  });
});

describe('取得の失敗', () => {
  test('最初の取得の失敗は一覧の位置に本specの文言と再試行を示し、人物情報とタブを保ち、再試行で一覧を描く', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let failing = true;
    respond(() => (failing ? LOAD_FAILURE : ok(historyOf([PITCH]))));

    await renderHistory();

    const alert = panel().getByRole('alert');
    await expect.element(alert).toHaveTextContent(LOAD_ERROR);
    await expect.element(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect.element(historyTab()).toBeVisible();
    expect(reportUnexpectedErrorInBrowser).not.toHaveBeenCalled();

    failing = false;
    await userEvent.click(panel().getByRole('button', { name: '再試行' }));

    await expect.element(itemOf('Pitch Notes')).toBeVisible();
    expect(document.activeElement).not.toBe(document.body);
    expect(panel().getByRole('alert').elements()).toHaveLength(0);
  });

  test('再試行がまた失敗すると、新しい再試行のボタンへフォーカスを移す', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    respond(() => LOAD_FAILURE);

    await renderHistory();
    const retry = panel().getByRole('button', { name: '再試行' });
    await expect.element(retry).toBeVisible();
    const calls = historyCalls().length;

    await userEvent.click(retry);

    await expect.poll(() => historyCalls().length).toBeGreaterThan(calls);
    await expect.element(retry).toHaveFocus();
    await expect
      .element(panel().getByRole('alert'))
      .toHaveTextContent(LOAD_ERROR);
  });

  test('再試行の応答を待つ間は、再試行のボタンを消した後にパネルの位置へフォーカスを移す', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    respond(() => LOAD_FAILURE);

    await renderHistory();
    const retry = panel().getByRole('button', { name: '再試行' });
    await expect.element(retry).toBeVisible();
    const retryButton = retry.element();
    const region = retryButton.closest<HTMLElement>('div[tabindex="-1"]');
    if (region === null) {
      throw new Error('パネルの位置の入れ物がありません。');
    }
    const buttonConnectedAtFocus: boolean[] = [];
    region.addEventListener('focus', () => {
      buttonConnectedAtFocus.push(retryButton.isConnected);
    });
    respond(() => new Promise(() => undefined));

    await userEvent.click(retry);

    await expect.poll(() => document.activeElement).toBe(region);
    expect(buttonConnectedAtFocus).toEqual([false]);
    expect(
      panel().getByRole('button', { name: '再試行' }).elements(),
    ).toHaveLength(0);
    await expect
      .element(panel().getByRole('status'))
      .toHaveTextContent('読み込み中');
  });

  test('最初は20件を読み、「さらに読み込む」で続きを後ろに加えて、加えた最初の項目へフォーカスを移す', async () => {
    respond(({ after }) =>
      after === undefined || after === null
        ? ok(
            historyOf(productsFrom(1, PAGE_SIZE), {
              totalCount: PAGE_SIZE + 1,
              pageInfo: { endCursor: 'cursor-20', hasNextPage: true },
            }),
          )
        : ok(historyOf(productsFrom(PAGE_SIZE + 1, 1))),
    );

    await renderHistory();
    await expect.poll(() => items().elements()).toHaveLength(PAGE_SIZE);

    await userEvent.click(loadMoreButton());

    await expect.poll(() => items().elements()).toHaveLength(PAGE_SIZE + 1);
    await expect
      .poll(() => document.activeElement)
      .toBe(itemOf('プロダクト21').element().parentElement);
    expect(historyCalls().at(-1)?.[1]).toEqual({
      userHandle: PROFILE_HANDLE,
      first: PAGE_SIZE,
      after: 'cursor-20',
    });
    expect(loadMoreButton().elements()).toHaveLength(0);
  });

  test('続きの取得の失敗は読み込んだ項目と「さらに読み込む」を残したまま近くにrole="alert"で示し、同じボタンで読み込み直せる', async () => {
    let failing = true;
    respond(({ after }) => {
      if (after === undefined || after === null) {
        return ok(
          historyOf(productsFrom(1, PAGE_SIZE), {
            totalCount: PAGE_SIZE + 1,
            pageInfo: { endCursor: 'cursor-20', hasNextPage: true },
          }),
        );
      }
      return failing ? LOAD_FAILURE : ok(historyOf(productsFrom(21, 1)));
    });

    await renderHistory();
    await expect.poll(() => items().elements()).toHaveLength(PAGE_SIZE);

    await userEvent.click(loadMoreButton());

    const alert = panel().getByRole('alert');
    await expect.element(alert).toHaveTextContent(LOAD_MORE_ERROR);
    await expect.element(loadMoreButton()).toHaveFocus();
    expect(items().elements()).toHaveLength(PAGE_SIZE);
    expect(
      alert.element().parentElement?.contains(loadMoreButton().element()),
    ).toBe(true);

    failing = false;
    await userEvent.click(loadMoreButton());

    await expect.poll(() => items().elements()).toHaveLength(PAGE_SIZE + 1);
    expect(panel().getByRole('alert').elements()).toHaveLength(0);
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('本人の一覧(未掲載・受賞・マッチ中・続き)で、アクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    respond(() =>
      ok(
        historyOf([MATCHING, PITCH, SCHEDULED], {
          viewerIsOwner: true,
          totalCount: 30,
          pageInfo: { endCursor: 'cursor-3', hasNextPage: true },
        }),
      ),
    );

    await renderHistory({ owner: true });
    await expect.element(itemOf('Pitch Notes')).toBeVisible();

    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test('停止中の本人の一覧で、アクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    respond(() =>
      ok(
        historyOf([PITCH], {
          viewerIsOwner: true,
          ownerSuspended: true,
        }),
      ),
    );

    await renderHistory({ owner: true, suspended: true });
    await expect.element(itemOf('Pitch Notes')).toBeVisible();

    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test('本人の0件で、アクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    respond(() => ok(historyOf([], { viewerIsOwner: true })));

    await renderHistory({ owner: true });
    await expect.element(panel().getByText(EMPTY_TITLE)).toBeVisible();

    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test('最初の取得の失敗で、アクセシビリティの検査の違反が0件', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    applyColorScheme(scheme);
    respond(() => LOAD_FAILURE);

    await renderHistory();
    await expect
      .element(panel().getByRole('alert'))
      .toHaveTextContent(LOAD_ERROR);

    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
