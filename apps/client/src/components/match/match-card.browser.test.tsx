import { afterEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
  tokenColorOf,
} from '../../../lib/test/computed-style.ts';
import type { MatchFragment } from '../../graphql/generated/graphql.ts';
import { MatchCard } from './match-card.tsx';
import { ENTRY_IDS, entryOf, matchOf } from './match-fixtures.ts';
import { renderInMatchFrame } from './match-testing.tsx';

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const OWN_REASON = '自身のプロダクトとその対戦相手にはUpvoteできません。';
const NOT_ACCEPTING_REASON = 'このマッチはUpvoteを受け付けていません。';
const EMAIL_REASON =
  'この操作にはメールアドレスの確認が必要です。確認メールをご確認ください。';

const DESKTOP = { width: 1280, height: 900 } as const;

type CardOptions = {
  readonly width?: number;
  readonly caption?: string;
  readonly pendingEntryId?: string | null;
};

const renderCard = async (
  match: MatchFragment,
  { width, caption, pendingEntryId = null }: CardOptions = {},
) => {
  const onToggleUpvote = vi.fn<(entryId: string) => void>();
  await renderInMatchFrame(
    <MatchCard
      match={match}
      caption={caption}
      pendingEntryId={pendingEntryId}
      onToggleUpvote={onToggleUpvote}
    />,
    { width },
  );
  return { onToggleUpvote };
};

const card = () => page.getByRole('article');

const upvoteButton = (name: string) =>
  page.getByRole('button', { name: `${name}にUpvote` });

const finishedMatch = (overrides: Partial<MatchFragment>): MatchFragment =>
  matchOf({
    phase: 'FINISHED',
    viewerRestriction: 'NOT_ACCEPTING',
    ...overrides,
  });

afterEach(async () => {
  applyColorScheme('light');
  await page.viewport(DESKTOP.width, DESKTOP.height);
});

describe('MatchCardの見出しの行', () => {
  test('対戦カードは「<名称> vs <名称>」の名前を持ち、予選の種別の印「予選」を置く', async () => {
    await renderCard(matchOf());

    await expect
      .element(card())
      .toHaveAccessibleName('Pitch Notes vs Tactics Board');
    await expect
      .element(card().getByText('予選', { exact: true }))
      .toBeVisible();
  });

  test.each([
    [{ kind: 'WEEK', round: 3, stage: 'SEMIFINAL' }, 'Week 準決勝'],
    [{ kind: 'YEAR', round: 2, stage: null }, 'Year 2回戦'],
  ] as const)(
    'トーナメントのマッチは種別とラウンドの印を置く(%o)',
    async (round, label) => {
      await renderCard(matchOf(round));

      await expect.element(card().getByText(label)).toBeVisible();
    },
  );

  test('マッチ中は呼び出し元の補足を示す', async () => {
    await renderCard(matchOf(), { caption: '注目のマッチ' });

    await expect.element(card().getByText('注目のマッチ')).toBeVisible();
  });

  test('終了の時刻を過ぎて結果の確定を待つ間は「結果を集計しています」を示し、補足は示さない', async () => {
    await renderCard(
      matchOf({ phase: 'TALLYING', viewerRestriction: 'NOT_ACCEPTING' }),
      { caption: '注目のマッチ' },
    );

    await expect
      .element(card().getByText('結果を集計しています'))
      .toBeVisible();
    expect(card().getByText('注目のマッチ').elements()).toHaveLength(0);
  });

  test('確定の後は勝者のUpvote数を先に置いた結果を示す', async () => {
    await renderCard(
      finishedMatch({
        decision: 'VOTES',
        entries: [
          entryOf('left', { upvoteCount: 9, result: 'LOST' }),
          entryOf('right', { upvoteCount: 12, result: 'WON' }),
        ],
      }),
    );

    await expect
      .element(card().getByText('フルタイム！12対9でTactics Boardの勝利'))
      .toBeVisible();
  });

  test('最終Upvote時間で決まった結果には注記を添える', async () => {
    await renderCard(
      finishedMatch({
        decision: 'LAST_UPVOTE',
        entries: [
          entryOf('left', { upvoteCount: 7, result: 'WON' }),
          entryOf('right', { upvoteCount: 7, result: 'LOST' }),
        ],
      }),
    );

    await expect
      .element(
        card().getByText(
          'フルタイム！7対7でPitch Notesの勝利(最終Upvote時刻が早いため)',
        ),
      )
      .toBeVisible();
  });

  test('0対0は両者敗北を示し、比率のバーを空にする', async () => {
    await renderCard(
      finishedMatch({
        decision: 'NO_VOTES',
        entries: [
          entryOf('left', { upvoteCount: 0, result: 'LOST' }),
          entryOf('right', { upvoteCount: 0, result: 'LOST' }),
        ],
      }),
    );

    await expect
      .element(card().getByText('フルタイム。0対0で両者敗北'))
      .toBeVisible();
    await expect
      .element(
        page.getByRole('img', { name: 'Pitch Notes0票、Tactics Board0票' }),
      )
      .toBeVisible();
    const fills = Array.from(
      document.querySelectorAll('[data-vote-bar-fill]'),
    ).filter((fill) => (fill as HTMLElement).offsetParent !== null);
    expect(fills).toHaveLength(0);
  });
});

describe('MatchCardのUpvoteのボタン', () => {
  test('両側にボタンを置き、閲覧者がUpvoteした側を押された状態で示し、比率のバーで両者のUpvote数を読ませる', async () => {
    await renderCard(matchOf({ viewerUpvotedEntryId: ENTRY_IDS.right }));

    await expect
      .element(upvoteButton('Pitch Notes'))
      .toHaveAttribute('aria-pressed', 'false');
    await expect
      .element(
        page.getByRole('button', { name: 'Tactics BoardへのUpvoteを取り消す' }),
      )
      .toHaveAttribute('aria-pressed', 'true');
    await expect
      .element(
        page.getByRole('img', { name: 'Pitch Notes12票、Tactics Board9票' }),
      )
      .toBeVisible();
  });

  test('押した側の識別子で呼び出し元の関数を呼ぶ', async () => {
    const { onToggleUpvote } = await renderCard(matchOf());

    await upvoteButton('Tactics Board').click();

    expect(onToggleUpvote).toHaveBeenCalledWith(ENTRY_IDS.right);
  });

  test('未ログインの閲覧者にはボタンを押せる状態で示す', async () => {
    const { onToggleUpvote } = await renderCard(
      matchOf({ viewerRestriction: 'GUEST' }),
    );

    await expect
      .element(upvoteButton('Pitch Notes'))
      .not.toHaveAttribute('aria-disabled');
    await upvoteButton('Pitch Notes').click();

    expect(onToggleUpvote).toHaveBeenCalledWith(ENTRY_IDS.left);
  });

  test('送信中の側のボタンは処理中であることを伝える', async () => {
    await renderCard(matchOf(), { pendingEntryId: ENTRY_IDS.left });

    await expect
      .element(upvoteButton('Pitch Notes'))
      .toHaveAttribute('aria-busy', 'true');
    await expect
      .element(upvoteButton('Tactics Board'))
      .not.toHaveAttribute('aria-busy');
  });

  test('閲覧者自身のプロダクトの側はUpvote数だけを示し、対戦相手の側のボタンを理由付きで無効にする', async () => {
    await renderCard(
      matchOf({
        viewerRestriction: 'OWN_MATCH',
        entries: [entryOf('left', { isViewerOwn: true }), entryOf('right')],
      }),
    );

    expect(page.getByRole('button').elements()).toHaveLength(1);
    await expect.element(card().getByText('12票')).toBeInTheDocument();
    const opponent = upvoteButton('Tactics Board');
    await expect.element(opponent).toHaveAttribute('aria-disabled', 'true');
    await expect.element(opponent).toHaveAccessibleDescription(OWN_REASON);
  });

  test.each([
    ['マッチ外', 'NOT_ACCEPTING', NOT_ACCEPTING_REASON],
    ['メールアドレス未確認', 'EMAIL_NOT_VERIFIED', EMAIL_REASON],
  ] as const)(
    '%sの閲覧者には両側のボタンを理由付きで無効にする',
    async (_label, viewerRestriction, reason) => {
      await renderCard(matchOf({ viewerRestriction }));

      for (const name of ['Pitch Notes', 'Tactics Board']) {
        const button = upvoteButton(name);
        await expect.element(button).toHaveAttribute('aria-disabled', 'true');
        await expect.element(button).toHaveAccessibleDescription(reason);
      }
    },
  );

  test('表示できない側は「非公開のプロダクト」と示し、その側のボタンとリンクを出さない', async () => {
    await renderCard(
      matchOf({
        entries: [entryOf('left', { product: null }), entryOf('right')],
      }),
    );

    await expect
      .element(card())
      .toHaveAccessibleName('非公開のプロダクト vs Tactics Board');
    expect(page.getByRole('button').elements()).toHaveLength(1);
    await expect.element(upvoteButton('Tactics Board')).toBeVisible();
    await expect
      .element(
        page.getByRole('img', {
          name: '非公開のプロダクト12票、Tactics Board9票',
        }),
      )
      .toBeVisible();
  });
});

describe('MatchCardの配置', () => {
  const topOf = (name: string): DOMRect =>
    page.getByRole('heading', { name }).element().getBoundingClientRect();

  const isStacked = (): boolean =>
    topOf('Tactics Board').top >= topOf('Pitch Notes').bottom;

  test('画面幅640px未満では2つの側を縦に積み、比率のバーをその間に置く', async () => {
    await page.viewport(375, 800);
    await renderCard(matchOf());
    await expect.element(card()).toBeVisible();

    expect(isStacked()).toBe(true);
    const bar = page
      .getByRole('img', { name: 'Pitch Notes12票、Tactics Board9票' })
      .element()
      .getBoundingClientRect();
    expect(bar.top).toBeGreaterThanOrEqual(topOf('Pitch Notes').bottom);
    expect(bar.bottom).toBeLessThanOrEqual(topOf('Tactics Board').top);
  });

  test('画面幅640px以上でもカードの幅が768px未満なら2つの側を縦に積む', async () => {
    await renderCard(matchOf(), { width: 600 });
    await expect.element(card()).toBeVisible();

    expect(isStacked()).toBe(true);
  });

  test('カードの幅が768px以上なら2つの側を横に並べる', async () => {
    await renderCard(matchOf(), { width: 960 });
    await expect.element(card()).toBeVisible();

    expect(isStacked()).toBe(false);
    const left = page.getByRole('heading', { name: 'Pitch Notes' }).element();
    const right = page
      .getByRole('heading', { name: 'Tactics Board' })
      .element();
    expect(right.getBoundingClientRect().left).toBeGreaterThan(
      left.getBoundingClientRect().right,
    );
  });
});

const DECIDED_MATCH = finishedMatch({
  decision: 'VOTES',
  entries: [
    entryOf('left', { upvoteCount: 12, result: 'WON' }),
    entryOf('right', { upvoteCount: 9, result: 'LOST' }),
  ],
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('確定して敗れた側も、名称を前景色、タグラインを控えめな前景色で示し、文字の色で敗北を示さない', async () => {
    applyColorScheme(scheme);
    await renderCard(DECIDED_MATCH, { width: 960 });

    const name = page.getByRole('heading', { name: 'Tactics Board' });
    await expect.element(name).toBeVisible();
    const tagline = page.getByText('試合の戦術を共有できるホワイトボード');
    expect(getComputedStyle(name.element()).color).toBe(
      tokenColorOf('foreground'),
    );
    expect(getComputedStyle(tagline.element()).color).toBe(
      tokenColorOf('muted-foreground'),
    );
  });

  test.each([
    ['マッチ中の', matchOf({ viewerUpvotedEntryId: ENTRY_IDS.left }), 960],
    ['マッチ中の縦に積んだ', matchOf(), 480],
    [
      '自分のプロダクトの',
      matchOf({
        viewerRestriction: 'OWN_MATCH',
        entries: [entryOf('left', { isViewerOwn: true }), entryOf('right')],
      }),
      960,
    ],
    [
      '確定した',
      finishedMatch({
        decision: 'VOTES',
        entries: [
          entryOf('left', { upvoteCount: 12, result: 'WON' }),
          entryOf('right', { upvoteCount: 9, result: 'LOST', product: null }),
        ],
      }),
      960,
    ],
    ['確定して敗れた側にもプロダクトがある', DECIDED_MATCH, 960],
    [
      'Week 準決勝の',
      matchOf({ kind: 'WEEK', round: 3, stage: 'SEMIFINAL' }),
      960,
    ],
    ['Year 決勝の', matchOf({ kind: 'YEAR', round: 6, stage: 'FINAL' }), 960],
  ] as const)(
    '%s対戦カードのアクセシビリティの検査の違反が0件',
    async (_label, match, width) => {
      applyColorScheme(scheme);
      await renderCard(match, { width });
      await expect.element(card()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
