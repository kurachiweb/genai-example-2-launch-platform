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
  ClientUpvoteHistoryDocument,
  type ClientUpvoteHistoryQuery,
  type ClientUpvoteHistoryQueryVariables,
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

const LOAD_ERROR =
  'Upvote履歴を読み込めませんでした。時間をおいて再度お試しください。';
const LOAD_MORE_ERROR = '続きを読み込めませんでした。';
const EMPTY_TITLE = 'まだUpvoteしたマッチはありません。';
const EMPTY_OWNER_DESCRIPTION =
  '開催中のマッチで、応援したいプロダクトにUpvoteしましょう。';
const EMPTY_OWNER_ACTION = 'トップページで開催中のマッチを見る';
const EXCLUSION_NOTICE = '公開を停止・削除されたプロダクトは表示されません。';

type UpvoteHistory = NonNullable<ClientUpvoteHistoryQuery['upvoteHistory']>;
type HistoryNode = UpvoteHistory['nodes'][number];

const LOGO = {
  id: '01JD0FILE00000000000000001',
  objectKey: '0123456789abcdef'.repeat(2),
  fallbackFormat: 'PNG' as const,
  width: 512,
  height: 512,
};

const OWNER = { handle: 'scout_ken', nickname: 'スカウトの健', avatar: null };

const nodeOf = (
  id: string,
  date: string,
  overrides: Partial<HistoryNode> = {},
): HistoryNode => ({
  id,
  date,
  kind: 'QUALIFIER',
  round: null,
  stage: null,
  live: false,
  product: {
    handle: `product-${id}`,
    name: `プロダクト${id}`,
    listed: true,
    logo: null,
  },
  owner: OWNER,
  ...overrides,
});

const PITCH = nodeOf('01JD0MATCH0000000000000001', '2026-10-02', {
  live: true,
  product: {
    handle: 'pitch-notes',
    name: 'Pitch Notes',
    listed: true,
    logo: LOGO,
  },
});

const SNOOZE = nodeOf('01JD0MATCH0000000000000002', '2026-10-02', {
  product: {
    handle: 'snoozeless',
    name: 'Snoozeless',
    listed: false,
    logo: null,
  },
  owner: null,
});

const BOARD = nodeOf('01JD0MATCH0000000000000003', '2026-09-30', {
  kind: 'WEEK',
  round: 3,
  stage: 'SEMIFINAL',
  product: {
    handle: 'match-board',
    name: 'Match Board',
    listed: true,
    logo: null,
  },
  owner: { handle: 'maker_ai', nickname: 'AIの作り手', avatar: LOGO },
});

const historyOf = (
  nodes: readonly HistoryNode[],
  overrides: Partial<Omit<UpvoteHistory, 'nodes'>> = {},
): UpvoteHistory => ({
  totalCount: nodes.length,
  dateTotals: [...new Set(nodes.map(({ date }) => date))].map((date) => ({
    date,
    count: nodes.filter((node) => node.date === date).length,
  })),
  nodes: [...nodes],
  pageInfo: { endCursor: null, hasNextPage: false },
  ...overrides,
});

const ok = (upvoteHistory: UpvoteHistory | null) => ({
  ok: true,
  data: { upvoteHistory } satisfies ClientUpvoteHistoryQuery,
});

const LOAD_FAILURE = {
  ok: false,
  error: new GraphQLClientError({
    code: 'internal_error',
    message: 'サーバーでエラーが発生しました。',
    status: 500,
  }),
} as const;

type Responder = (variables: ClientUpvoteHistoryQueryVariables) => unknown;

const respond = (responder: Responder) => {
  executeGraphQLMock.mockImplementation(((
    document: unknown,
    variables: ClientUpvoteHistoryQueryVariables,
  ) => {
    if (document === ClientUpvoteHistoryDocument) {
      return Promise.resolve(responder(variables));
    }
    if (document === ClientLaunchHistoryDocument) {
      return Promise.resolve({ ok: true, data: { launchHistory: null } });
    }
    throw new Error('想定していない操作が実行されました。');
  }) as never);
};

const historyCalls = () =>
  executeGraphQLMock.mock.calls.filter(
    ([document]) => document === ClientUpvoteHistoryDocument,
  );

const nodesFrom = (start: number, count: number, date: string): HistoryNode[] =>
  Array.from({ length: count }, (_, index) =>
    nodeOf(`m${(start + index).toString()}`, date),
  );

const renderHistory = ({
  owner = false,
  suspended = false,
}: { readonly owner?: boolean; readonly suspended?: boolean } = {}) =>
  renderPublicProfilePage(
    publicProfileOf({
      viewerRelation: owner ? 'OWNER' : 'NOT_FOLLOWING',
      suspended,
    }),
    {
      path: '/?tab=upvotes',
      ...(owner
        ? {
            cachedViewer: signedInViewerQuery({
              handle: PROFILE_HANDLE,
              ...(suspended ? { status: 'SUSPENDED' } : {}),
            }),
          }
        : {}),
    },
  );

const panel = () => page.getByRole('tabpanel');
const items = () => panel().getByRole('article');
const itemOf = (name: string) => panel().getByRole('article', { name });
const dayOf = (name: RegExp) => panel().getByRole('region', { name });
const upvoteTab = () => page.getByRole('tab', { name: /Upvote履歴/ });
const loadMoreButton = () =>
  panel().getByRole('button', { name: 'さらに読み込む' });

const SYSTEM_NOTIFY_SCHEDULER = (callback: () => void): void => {
  setTimeout(callback, 0);
};

beforeEach(async () => {
  executeGraphQLMock.mockReset();
  vi.mocked(reportUnexpectedErrorInBrowser).mockClear();
  await emulateBrowserDisplay({
    timeZone: 'Pacific/Honolulu',
    locale: 'ja-JP',
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  notifyManager.setScheduler(SYSTEM_NOTIFY_SCHEDULER);
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('Upvote履歴のタブ', () => {
  test('クエリのtab=upvotesで選ばれ、除外を除いたUpvoteの総数を件数として添える', async () => {
    respond(() => ok(historyOf([PITCH], { totalCount: 1234 })));

    await renderHistory();

    await expect
      .element(page.getByRole('tab', { name: /Upvote履歴\s*1,234\s*件/ }))
      .toHaveAttribute('aria-selected', 'true');
    await expect.element(itemOf('Pitch Notes')).toBeVisible();
    expect(historyCalls()).toHaveLength(1);
    expect(historyCalls()[0]?.[1]).toEqual({
      userHandle: PROFILE_HANDLE,
      first: PAGE_SIZE,
    });
  });
});

describe('一覧', () => {
  test('一覧の上に除外の注記を置き、マッチ実施日ごとの小見出しに業務日付のままの日付とその日の総数を示す', async () => {
    respond(() =>
      ok(
        historyOf([PITCH, SNOOZE, BOARD], {
          dateTotals: [
            { date: '2026-10-02', count: 3 },
            { date: '2026-09-30', count: 1234 },
          ],
        }),
      ),
    );

    await renderHistory();

    const notice = panel().getByText(EXCLUSION_NOTICE);
    await expect.element(notice).toBeVisible();
    expect(
      notice.element().compareDocumentPosition(items().first().element()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const october = dayOf(/2026年10月2日\(金\)/);
    await expect
      .element(october.getByRole('heading', { level: 3 }))
      .toHaveTextContent(/^2026年10月2日\(金\)\s*3件$/u);
    expect(
      october.element().querySelector('time[datetime="2026-10-02"]'),
    ).not.toBeNull();
    expect(october.getByRole('article').elements()).toHaveLength(2);

    const september = dayOf(/2026年9月30日\(水\)/);
    await expect
      .element(september.getByRole('heading', { level: 3 }))
      .toHaveTextContent(/1,234件$/u);
    expect(september.getByRole('article').elements()).toHaveLength(1);
  });

  test('項目にロゴ・名称のリンク・投稿者のリンク・種別とラウンドを示し、時刻・勝敗・スコアを示さない', async () => {
    respond(() => ok(historyOf([PITCH, BOARD])));

    await renderHistory();

    const item = itemOf('Pitch Notes');
    await expect.element(item).toBeVisible();
    await expect
      .element(item.getByRole('img', { name: 'Pitch Notesのロゴ' }))
      .toBeInTheDocument();
    await expect
      .element(item.getByRole('link', { name: 'Pitch Notes', exact: true }))
      .toHaveAttribute('href', '/p/pitch-notes');
    const owner = item.getByRole('link', { name: /^投稿者:\s*スカウトの健$/u });
    await expect.element(owner).toHaveAttribute('href', '/@scout_ken');
    await expect.element(item.getByText('予選', { exact: true })).toBeVisible();

    const board = itemOf('Match Board');
    await expect
      .element(board.getByText('Week 準決勝', { exact: true }))
      .toBeVisible();
    await expect
      .element(board.getByRole('link', { name: /^投稿者:\s*AIの作り手$/u }))
      .toHaveAttribute('href', '/@maker_ai');

    for (const article of items().elements()) {
      expect(article.querySelector('time')).toBeNull();
      expect(article.textContent).not.toMatch(/\d{1,2}:\d{2}|票|勝利|敗北/u);
    }
  });

  test('掲載されていないプロダクトはリンクせず「未掲載」のバッジを付け、表示できない投稿者は示さない', async () => {
    respond(() => ok(historyOf([SNOOZE])));

    await renderHistory();

    const item = itemOf('Snoozeless');
    await expect
      .element(item.getByText('未掲載', { exact: true }))
      .toBeVisible();
    expect(item.getByRole('link').elements()).toHaveLength(0);
    expect(item.getByText(/投稿者/).elements()).toHaveLength(0);
  });

  test('マッチ中のマッチには「マッチ中」と「トップページで見る」を添え、取り消しの操作は置かない', async () => {
    respond(() => ok(historyOf([PITCH, BOARD])));

    await renderHistory({ owner: true });

    const live = itemOf('Pitch Notes');
    await expect
      .element(live.getByText('マッチ中', { exact: true }))
      .toBeVisible();
    await expect
      .element(live.getByRole('link', { name: 'トップページで見る' }))
      .toHaveAttribute('href', '/');
    expect(live.getByRole('button').elements()).toHaveLength(0);

    const finished = itemOf('Match Board');
    expect(finished.getByText('マッチ中').elements()).toHaveLength(0);
    expect(
      finished.getByRole('link', { name: 'トップページで見る' }).elements(),
    ).toHaveLength(0);
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
    expect(panel().getByText(EXCLUSION_NOTICE).elements()).toHaveLength(0);
  });

  test('本人には説明とトップページへの導線を添える', async () => {
    respond(() => ok(historyOf([])));

    await renderHistory({ owner: true });

    await expect.element(panel().getByText(EMPTY_TITLE)).toBeVisible();
    await expect
      .element(panel().getByText(EMPTY_OWNER_DESCRIPTION))
      .toBeVisible();
    await expect
      .element(panel().getByRole('link', { name: EMPTY_OWNER_ACTION }))
      .toHaveAttribute('href', '/');
  });

  test('Upvoteできない停止中の本人には導線を添えない', async () => {
    respond(() => ok(historyOf([])));

    await renderHistory({ owner: true, suspended: true });

    await expect.element(panel().getByText(EMPTY_TITLE)).toBeVisible();
    expect(panel().getByRole('link').elements()).toHaveLength(0);
  });

  test('利用者を表示できない時は0件として示す', async () => {
    respond(() => ok(null));

    await renderHistory();

    await expect.element(panel().getByText(EMPTY_TITLE)).toBeVisible();
    await expect
      .element(page.getByRole('tab', { name: /Upvote履歴\s*0\s*件/ }))
      .toBeVisible();
  });
});

describe('取得の失敗と続き', () => {
  test('最初の取得の失敗は一覧の位置に文言と再試行を示し、人物情報とタブを保ち、再試行で一覧を描く', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let failing = true;
    respond(() => (failing ? LOAD_FAILURE : ok(historyOf([PITCH]))));

    await renderHistory();

    const alert = panel().getByRole('alert');
    await expect.element(alert).toHaveTextContent(LOAD_ERROR);
    await expect.element(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect.element(upvoteTab()).toBeVisible();
    expect(reportUnexpectedErrorInBrowser).not.toHaveBeenCalled();

    failing = false;
    await userEvent.click(panel().getByRole('button', { name: '再試行' }));

    await expect.element(itemOf('Pitch Notes')).toBeVisible();
    expect(panel().getByRole('alert').elements()).toHaveLength(0);
  });

  test('「さらに読み込む」で続きを同じ日の後ろに加え、既出のマッチを除き、加えた最初の項目へフォーカスを移す', async () => {
    const firstPage = nodesFrom(1, PAGE_SIZE, '2026-10-02');
    respond(({ after }) =>
      after === undefined || after === null
        ? ok(
            historyOf(firstPage, {
              totalCount: PAGE_SIZE + 2,
              dateTotals: [{ date: '2026-10-02', count: PAGE_SIZE + 1 }],
              pageInfo: { endCursor: '2026-10-02:m20', hasNextPage: true },
            }),
          )
        : ok(
            historyOf(
              [
                nodeOf('m20', '2026-10-02'),
                ...nodesFrom(PAGE_SIZE + 1, 1, '2026-10-02'),
                nodeOf('m30', '2026-10-01'),
              ],
              {
                totalCount: PAGE_SIZE + 2,
                dateTotals: [
                  { date: '2026-10-02', count: PAGE_SIZE + 1 },
                  { date: '2026-10-01', count: 1 },
                ],
              },
            ),
          ),
    );

    await renderHistory();
    await expect.poll(() => items().elements()).toHaveLength(PAGE_SIZE);

    await userEvent.click(loadMoreButton());

    await expect.poll(() => items().elements()).toHaveLength(PAGE_SIZE + 2);
    await expect
      .poll(() => document.activeElement)
      .toBe(itemOf('プロダクトm21').element().parentElement);
    expect(historyCalls().at(-1)?.[1]).toEqual({
      userHandle: PROFILE_HANDLE,
      first: PAGE_SIZE,
      after: '2026-10-02:m20',
    });
    const october = dayOf(/2026年10月2日/);
    expect(october.getByRole('article').elements()).toHaveLength(PAGE_SIZE + 1);
    await expect
      .element(october.getByRole('heading', { level: 3 }))
      .toHaveTextContent(/21件$/u);
    expect(panel().getByRole('region').elements()).toHaveLength(2);
    expect(loadMoreButton().elements()).toHaveLength(0);
  });

  test('続きの取得の失敗は読み込んだ項目と「さらに読み込む」を残したまま近くにrole="alert"で示し、同じボタンで読み込み直せる', async () => {
    let failing = true;
    respond(({ after }) => {
      if (after === undefined || after === null) {
        return ok(
          historyOf(nodesFrom(1, PAGE_SIZE, '2026-10-02'), {
            totalCount: PAGE_SIZE + 1,
            pageInfo: { endCursor: '2026-10-02:m20', hasNextPage: true },
          }),
        );
      }
      return failing
        ? LOAD_FAILURE
        : ok(historyOf(nodesFrom(PAGE_SIZE + 1, 1, '2026-10-01')));
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
  test('一覧(マッチ中・未掲載・トーナメント・続き)で、アクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    respond(() =>
      ok(
        historyOf([PITCH, SNOOZE, BOARD], {
          totalCount: 30,
          pageInfo: { endCursor: '2026-09-30:m3', hasNextPage: true },
        }),
      ),
    );

    await renderHistory();
    await expect.element(itemOf('Pitch Notes')).toBeVisible();

    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test('本人の0件で、アクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    respond(() => ok(historyOf([])));

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
