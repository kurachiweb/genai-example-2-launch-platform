import { use } from 'react';
import { toast } from 'sonner';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  test,
  vi,
} from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { reportUnexpectedErrorInBrowser } from '../../../lib/start/observability/browser-error-reporting.ts';
import { executeGraphQL } from '../../../lib/start/graphql/execute-graphql.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import { resetFakeTurnstile } from '../../../lib/test/fake-turnstile.tsx';
import { ClientUpvoteDocument } from '../../graphql/generated/graphql.ts';
import type { MatchFragment } from '../../graphql/generated/graphql.ts';
import { byeOf, entryOf } from '../match/match-fixtures.ts';
import { renderInMatchFrame } from '../match/match-testing.tsx';
import { UpvoteBotProtection } from '../match/upvote-bot-protection.tsx';
import {
  FULL_TIME_AT,
  NEXT_KICKOFF_AT,
  qualifierBoardOf,
  qualifierMatchesOf,
  qualifierMatchOf,
  type QualifierBoardView,
} from './qualifier-board-fixtures.ts';
import {
  QualifierSection,
  type QualifierSectionProps,
} from './qualifier-section.tsx';
import type { QualifierListInsert } from './top-page-section-types.ts';

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../../../lib/test/fake-turnstile.tsx'),
);

vi.mock('../../../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

const executeGraphQLMock = vi.mocked(executeGraphQL);

const DESKTOP = { width: 1280, height: 900 } as const;

const EMPTY_MESSAGE = '本日のマッチはありません。ローンチを予約しましょう。';

const RELOAD_NOTICE =
  '結果の反映に時間がかかっています。ページを再読み込みすると最新の状態を表示します。';

type SectionOptions = {
  readonly signedIn?: boolean;
  readonly inserts?: readonly QualifierListInsert[];
  readonly statusMessage?: string | null;
};

const renderSection = async (
  board: QualifierBoardView = qualifierBoardOf(),
  { signedIn = false, inserts = [], statusMessage = null }: SectionOptions = {},
) => {
  const onUpdated = vi.fn<(match: MatchFragment) => void>();
  // 表示設定は描画の後にブラウザのタイムゾーンとロケールへ合わせ直されるため、ブラウザの側も閲覧者の設定にする
  await emulateBrowserDisplay({ timeZone: 'Asia/Tokyo', locale: 'ja-JP' });
  await renderInMatchFrame(
    <UpvoteBotProtection>
      <QualifierSection
        board={board}
        signedIn={signedIn}
        onUpdated={onUpdated}
        inserts={inserts}
        statusMessage={statusMessage}
      />
    </UpvoteBotProtection>,
  );
  return { onUpdated };
};

const section = () => page.getByRole('region', { name: '予選' });

const timeOf = (dateTime: string): HTMLTimeElement | null =>
  document.querySelector(`time[datetime="${dateTime}"]`);

// 対戦カード・差し込み・不戦勝の項目を文書の順に、カードと項目は名前、差し込みは文言で並べる
const listedOrder = (): string[] =>
  Array.from(
    document.querySelectorAll<HTMLElement>('article, [data-test-insert]'),
  ).map((element) =>
    element.tagName === 'ARTICLE'
      ? (element.getAttribute('aria-label') ?? '')
      : element.textContent,
  );

const insertOf = (
  id: string,
  every: number,
  order: number,
): QualifierListInsert => ({
  id,
  order,
  every,
  component: ({ position }) => (
    <p data-test-insert="">{`${String(every)}件ごとの差し込み${String(position)}`}</p>
  ),
});

function FailingInsert(): never {
  throw new Error('差し込みの描画に失敗しました');
}

// モバイルのGoldのように、広い画面では自分で表示をやめる差し込み
const wideHiddenInsert: QualifierListInsert = {
  id: 'test.mobile-only',
  order: 10,
  every: 2,
  component: ({ position }) => (
    <p data-test-insert="" className="xl:hidden">
      {`狭い画面だけの差し込み${String(position)}`}
    </p>
  ),
};

const deferred = () => {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

// 最初は描画に失敗し、再試行の後は取得を待ってから描く差し込み
const recoveringInsertOf = () => {
  const gate = deferred();
  const state = { failing: true };
  function RecoveringInsert({ position }: { readonly position: number }) {
    if (state.failing) {
      throw new Error('差し込みの描画に失敗しました');
    }
    use(gate.promise);
    return <p data-test-insert="">{`復旧した差し込み${String(position)}`}</p>;
  }
  const insert: QualifierListInsert = {
    id: 'test.recovering',
    order: 10,
    every: 1,
    component: RecoveringInsert,
  };
  return { insert, state, gate };
};

const topOf = (element: Element): number =>
  Math.round(element.getBoundingClientRect().top);

const leftOf = (element: Element): number =>
  Math.round(element.getBoundingClientRect().left);

beforeEach(() => {
  executeGraphQLMock.mockReset();
  vi.mocked(reportUnexpectedErrorInBrowser).mockClear();
  resetFakeTurnstile();
});

afterEach(async () => {
  toast.dismiss();
  await emulateBrowserDisplay(null);
  applyColorScheme('light');
  await page.viewport(DESKTOP.width, DESKTOP.height);
});

describe('QualifierSectionの見出し', () => {
  test('マッチ中は見出し「予選」に試合数と「フルタイム」の終了の時刻を閲覧者のタイムゾーンで添える', async () => {
    await renderSection(qualifierBoardOf({ heldCount: 3 }));

    await expect
      .element(page.getByRole('heading', { name: '予選', level: 2 }))
      .toBeVisible();
    await expect
      .element(section().getByText('本日の予選マッチ3試合', { exact: true }))
      .toBeVisible();
    const fullTime = timeOf(FULL_TIME_AT);
    expect(fullTime?.textContent).toBe('23:40');
    expect(fullTime?.parentElement?.textContent).toBe('フルタイム23:40');
    expect(timeOf(NEXT_KICKOFF_AT)).toBeNull();
  });

  test('結果の時間帯は「明日のキックオフ」と翌日の開始の時刻を添え、終了の時刻を出さない', async () => {
    await renderSection(
      qualifierBoardOf({
        phase: 'RESULT',
        matches: qualifierMatchesOf(2).map((match) => ({
          ...match,
          phase: 'TALLYING' as const,
          viewerRestriction: 'NOT_ACCEPTING' as const,
        })),
      }),
    );

    await expect
      .element(section().getByText('本日の予選マッチ3試合', { exact: true }))
      .toBeVisible();
    const kickoff = timeOf(NEXT_KICKOFF_AT);
    expect(kickoff?.textContent).toBe('00:00');
    expect(kickoff?.parentElement?.textContent).toBe('明日のキックオフ00:00');
    expect(timeOf(FULL_TIME_AT)).toBeNull();
  });

  test('試合数は表示設定の桁区切りで示す', async () => {
    await renderSection(qualifierBoardOf({ heldCount: 1234 }));

    await expect
      .element(
        section().getByText('本日の予選マッチ1,234試合', { exact: true }),
      )
      .toBeVisible();
  });

  test('見出しの下の状態の領域は、呼び出し元が渡した文を支援技術へ伝える', async () => {
    await renderSection(qualifierBoardOf(), { statusMessage: RELOAD_NOTICE });

    await expect
      .element(section().getByRole('status'))
      .toHaveTextContent(RELOAD_NOTICE);
  });

  test('状態の文が無い間も、状態の領域を空のまま置いておく', async () => {
    await renderSection();

    await expect.element(section().getByRole('status')).toBeInTheDocument();
    expect(section().getByRole('status').element().textContent).toBe('');
  });
});

describe('QualifierSectionの一覧', () => {
  test('対戦カードを受け取った順に並べ、末尾に不戦勝の一覧を置く', async () => {
    await renderSection(
      qualifierBoardOf({
        matches: [3, 1, 2].map((n) => qualifierMatchOf(n)),
        byes: [byeOf({ match: { endedEarly: true } })],
      }),
    );

    await expect
      .element(page.getByRole('heading', { name: '不戦勝', level: 3 }))
      .toBeVisible();
    expect(listedOrder()).toStrictEqual([
      'Left 3 vs Right 3',
      'Left 1 vs Right 1',
      'Left 2 vs Right 2',
      'Pitch Notes(不戦勝)',
    ]);
  });

  test('画面幅1280px以上は2列に並べ、先頭のカードだけを全幅にする', async () => {
    await renderSection(qualifierBoardOf({ matches: qualifierMatchesOf(3) }));

    const cards = section().getByRole('article').elements();
    const [first, second, third] = cards.map(
      (card) => card.getBoundingClientRect().width,
    );
    expect(first).toBeGreaterThan((second ?? 0) * 1.8);
    expect(second).toBeCloseTo(third ?? 0, 0);
  });

  test('画面幅1280px未満は1列に並べる', async () => {
    await page.viewport(1024, 900);
    await renderSection(qualifierBoardOf({ matches: qualifierMatchesOf(3) }));

    const widths = section()
      .getByRole('article')
      .elements()
      .map((card) => card.getBoundingClientRect().width);
    expect(new Set(widths).size).toBe(1);
  });

  test('差し込みを指定の件数ごとに、同じ位置では順の値の小さい順に、何番目かを渡して置く', async () => {
    await renderSection(
      qualifierBoardOf({ matches: qualifierMatchesOf(6), byes: [] }),
      {
        inserts: [
          insertOf('test.every-two', 2, 10),
          insertOf('test.every-three', 3, 5),
        ],
      },
    );

    await expect
      .element(page.getByText('2件ごとの差し込み3', { exact: true }))
      .toBeVisible();
    expect(listedOrder()).toStrictEqual([
      'Left 1 vs Right 1',
      'Left 2 vs Right 2',
      '2件ごとの差し込み1',
      'Left 3 vs Right 3',
      '3件ごとの差し込み1',
      'Left 4 vs Right 4',
      '2件ごとの差し込み2',
      'Left 5 vs Right 5',
      'Left 6 vs Right 6',
      '3件ごとの差し込み2',
      '2件ごとの差し込み3',
    ]);
  });

  test('差し込みの登録は呼び出し元が必ず渡す', () => {
    expectTypeOf<QualifierSectionProps>()
      .pick<'inserts'>()
      .toEqualTypeOf<{ readonly inserts: readonly QualifierListInsert[] }>();
  });

  test('対戦カードが差し込みの件数に満たなければ差し込まない', async () => {
    await renderSection(
      qualifierBoardOf({ matches: qualifierMatchesOf(1), byes: [] }),
      { inserts: [insertOf('test.every-two', 2, 10)] },
    );

    await expect.element(section().getByRole('article')).toBeVisible();
    expect(listedOrder()).toStrictEqual(['Left 1 vs Right 1']);
  });

  test('画面幅1280px以上で自分で表示をやめた差し込みは、2列の並びに空いたセルを残さない', async () => {
    await renderSection(
      qualifierBoardOf({ matches: qualifierMatchesOf(5), byes: [] }),
      { inserts: [wideHiddenInsert] },
    );

    const [first, second, third, fourth, fifth] = section()
      .getByRole('article')
      .elements();
    if (
      first === undefined ||
      second === undefined ||
      third === undefined ||
      fourth === undefined ||
      fifth === undefined
    ) {
      throw new Error('対戦カードが5件描かれていません');
    }
    expect(
      document.querySelectorAll('[data-test-insert]').length,
    ).toBeGreaterThan(0);
    expect(topOf(third)).toBe(topOf(second));
    expect(leftOf(third)).toBeGreaterThan(leftOf(second));
    expect(topOf(fifth)).toBe(topOf(fourth));
    expect(leftOf(fourth)).toBe(leftOf(second));
    expect(topOf(fourth)).toBeGreaterThan(topOf(second));
    expect(leftOf(first)).toBe(leftOf(second));
  });

  test('差し込みの失敗の再試行で取得を待つ間は差し込みの位置へ、描けた後は差し込みへフォーカスを移す', async () => {
    const { insert, state, gate } = recoveringInsertOf();
    await renderSection(
      qualifierBoardOf({ matches: qualifierMatchesOf(1), byes: [] }),
      { inserts: [insert] },
    );
    const retry = section().getByRole('button', { name: '再試行' });
    await expect.element(retry).toBeVisible();
    state.failing = false;

    await userEvent.click(retry);

    await expect
      .poll(() => document.activeElement?.querySelector('[role="status"]'))
      .not.toBeNull();
    const slot = document.activeElement;
    expect(slot?.getAttribute('tabindex')).toBe('-1');
    expect(slot?.getBoundingClientRect().height).toBeGreaterThan(0);

    gate.resolve();

    await expect
      .poll(() => document.activeElement?.textContent)
      .toBe('復旧した差し込み1');
  });

  test('差し込みの描画の失敗はその位置に留め、対戦カードと他の差し込みの表示を続ける', async () => {
    await renderSection(
      qualifierBoardOf({ matches: qualifierMatchesOf(2), byes: [] }),
      {
        inserts: [
          { id: 'test.failing', order: 1, every: 1, component: FailingInsert },
          insertOf('test.every-two', 2, 10),
        ],
      },
    );

    await expect
      .element(page.getByText('2件ごとの差し込み1', { exact: true }))
      .toBeVisible();
    expect(section().getByRole('alert').elements()).toHaveLength(2);
    expect(
      section().getByRole('button', { name: '再試行' }).elements(),
    ).toHaveLength(2);
    expect(section().getByRole('article').elements()).toHaveLength(2);
    expect(reportUnexpectedErrorInBrowser).toHaveBeenCalled();
  });

  test('対戦カードがなく不戦勝だけの日は、空の状態にせず不戦勝の一覧を出す', async () => {
    await renderSection(
      qualifierBoardOf({ heldCount: 0, matches: [], byes: [byeOf()] }),
    );

    await expect
      .element(page.getByRole('heading', { name: '不戦勝', level: 3 }))
      .toBeVisible();
    expect(page.getByText(EMPTY_MESSAGE).elements()).toHaveLength(0);
  });

  test('対戦カードのUpvoteは、成功するとサーバーが返したマッチを呼び出し元へ渡す', async () => {
    const [match] = qualifierMatchesOf(1);
    if (match === undefined) {
      throw new Error('対戦カードの準備に失敗しました');
    }
    const [left, right] = match.entries;
    const updated: MatchFragment = {
      ...match,
      viewerUpvotedEntryId: left?.id ?? null,
      entries: [
        entryOf('left', { ...left, upvoteCount: 13 }),
        right ?? entryOf('right'),
      ],
    };
    executeGraphQLMock.mockResolvedValue({
      ok: true,
      data: { upvote: updated },
    });
    const { onUpdated } = await renderSection(
      qualifierBoardOf({ matches: [match], byes: [] }),
      { signedIn: true },
    );
    await userEvent.click(
      page.getByRole('button', { name: '判定を成功させる' }),
    );

    await userEvent.click(
      page.getByRole('button', { name: /^Left 1にUpvote/ }),
    );

    await expect.poll(() => onUpdated.mock.calls).toStrictEqual([[updated]]);
    expect(executeGraphQLMock).toHaveBeenCalledWith(
      ClientUpvoteDocument,
      { input: { matchId: match.id, entryId: left?.id } },
      { turnstileToken: 'turnstile-token-1' },
    );
  });

  test('未ログインの閲覧者が対戦カードのUpvoteを押すと、ログインが必要な旨のダイアログを開く', async () => {
    await renderSection(
      qualifierBoardOf({
        matches: [qualifierMatchOf(1, { viewerRestriction: 'GUEST' })],
        byes: [],
      }),
    );

    await userEvent.click(
      page.getByRole('button', { name: /^Left 1にUpvote/ }),
    );

    await expect
      .element(
        page.getByRole('dialog', { name: 'Upvoteにはログインが必要です' }),
      )
      .toBeVisible();
    expect(executeGraphQLMock).not.toHaveBeenCalled();
  });
});

describe('QualifierSectionの空の状態', () => {
  const emptyBoard = () =>
    qualifierBoardOf({ heldCount: 0, matches: [], byes: [] });

  test('対戦カードも不戦勝も無ければ、見出しと試合数0を残し、人のいないピッチの図を背景にその旨を示す', async () => {
    await renderSection(emptyBoard());

    await expect
      .element(page.getByRole('heading', { name: '予選', level: 2 }))
      .toBeVisible();
    await expect
      .element(section().getByText('本日の予選マッチ0試合', { exact: true }))
      .toBeVisible();
    await expect
      .element(section().getByText(EMPTY_MESSAGE, { exact: true }))
      .toBeVisible();
    const pitches = section()
      .element()
      .querySelectorAll('svg[aria-hidden="true"]');
    expect(pitches.length).toBeGreaterThan(0);
    const stands = section().element().querySelectorAll('[data-pitch-crowd]');
    expect(stands.length).toBeGreaterThan(0);
    expect(
      section().element().querySelectorAll('[data-pitch-crowd] circle'),
    ).toHaveLength(0);
    expect(section().getByRole('article').elements()).toHaveLength(0);
  });

  test('未ログインの導線「ログインしてローンチを予約🚀」は、プロダクト登録を戻り先にしたログインへ遷移する', async () => {
    await renderSection(emptyBoard(), { signedIn: false });

    await expect
      .element(
        section().getByRole('link', {
          name: 'ログインしてローンチを予約🚀',
          exact: true,
        }),
      )
      .toHaveAttribute('href', '/auth/login?redirect=%2Fmy%2Fproducts%2Fnew');
  });

  test('ログイン中の導線「ローンチを予約🚀」は、プロダクト登録へ遷移する', async () => {
    await renderSection(emptyBoard(), { signedIn: true });

    await expect
      .element(
        section().getByRole('link', { name: 'ローンチを予約🚀', exact: true }),
      )
      .toHaveAttribute('href', '/my/products/new');
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  beforeEach(() => {
    applyColorScheme(scheme);
  });

  test('対戦カード・差し込み・不戦勝を並べた区画のアクセシビリティの検査の違反が0件', async () => {
    await renderSection(qualifierBoardOf({ matches: qualifierMatchesOf(3) }), {
      inserts: [insertOf('test.every-two', 2, 10)],
      statusMessage: RELOAD_NOTICE,
    });
    await expect
      .element(page.getByRole('heading', { name: '不戦勝' }))
      .toBeVisible();

    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test('空の状態の区画のアクセシビリティの検査の違反が0件', async () => {
    await renderSection(
      qualifierBoardOf({ heldCount: 0, matches: [], byes: [] }),
    );
    await expect
      .element(section().getByText(EMPTY_MESSAGE, { exact: true }))
      .toBeVisible();

    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
