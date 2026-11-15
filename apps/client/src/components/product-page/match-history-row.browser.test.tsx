import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import {
  ClientMatchSupportersDocument,
  type ClientMatchSupportersQuery,
} from '../../graphql/generated/graphql.ts';
import { historyMatchOf, OPPONENT_LOGO } from './match-history-fixtures.ts';
import type { ProductPageMatchView } from './match-history-model.ts';
import { MatchHistoryRow } from './match-history-row.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const NOW = new Date('2026-11-10T08:00:00.000Z');

const PRODUCT_HANDLE = 'Pitch-Notes';

const SUPPORTERS: ClientMatchSupportersQuery = {
  matchSupporters: {
    nodes: [
      { handle: 'supporter_1', nickname: 'サポーター1号', avatar: null },
      { handle: 'supporter_2', nickname: 'サポーター2号', avatar: null },
    ],
    pageInfo: { hasNextPage: false, endCursor: null },
  },
};

const PRIVATE_OPPONENT: ProductPageMatchView['opponent'] = {
  kind: 'PRIVATE',
  handle: null,
  name: null,
  logo: null,
};

const NO_OPPONENT: ProductPageMatchView['opponent'] = {
  kind: 'NONE',
  handle: null,
  name: null,
  logo: null,
};

const renderRows = (matches: readonly ProductPageMatchView[]) =>
  renderInRouter(
    <DisplayPreferencesProvider
      initial={{ timeZone: 'Asia/Tokyo', locale: 'ja-JP' }}
    >
      <main className="bg-background p-4 text-foreground">
        <ol aria-label="第1回ローンチのマッチ" className="space-y-2.5">
          {matches.map((match) => (
            <MatchHistoryRow
              key={match.id}
              match={match}
              productHandle={PRODUCT_HANDLE}
            />
          ))}
        </ol>
      </main>
    </DisplayPreferencesProvider>,
    { path: `/p/${PRODUCT_HANDLE}` },
  );

const renderRow = (overrides: Partial<ProductPageMatchView> = {}) =>
  renderRows([historyMatchOf(overrides)]);

const row = () => page.getByRole('listitem').first();

const ratioBar = () => row().getByRole('img', { name: /^Upvote数の比率/u });

const supportersButton = (count: string) =>
  page.getByRole('button', { name: `サポーター${count}人` });

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  executeGraphQL.mockReset();
  executeGraphQL.mockImplementation((document: unknown) =>
    document === ClientMatchSupportersDocument
      ? Promise.resolve({ ok: true, data: SUPPORTERS })
      : Promise.reject(new Error('想定外の操作です。')),
  );
});

afterEach(() => {
  vi.useRealTimers();
  applyColorScheme('light');
});

describe('MatchHistoryRow', () => {
  test('予選は種別の印「予選」と、曜日の無いマッチ日を示す', async () => {
    await renderRow();

    await expect
      .element(row().getByText('予選', { exact: true }))
      .toBeVisible();
    const date = row().getByText('9月15日', { exact: true });
    await expect.element(date).toBeVisible();
    expect(date.element().tagName).toBe('TIME');
    expect(date.element().getAttribute('datetime')).toBe('2026-09-15');
  });

  test('トーナメントは種別とラウンドの印を示し、今年でないマッチ日には年を付ける', async () => {
    await renderRow({
      kind: 'WEEK',
      round: 3,
      stage: 'SEMIFINAL',
      date: '2025-12-20',
    });

    await expect
      .element(row().getByText('Week 準決勝', { exact: true }))
      .toBeVisible();
    await expect
      .element(row().getByText('2025年12月20日', { exact: true }))
      .toBeVisible();
  });

  test('掲載中の対戦相手は「vs」とロゴと詳細ページへのリンクの名称で示し、支援技術にだけ「対戦相手:」を伝える', async () => {
    await renderRow({
      opponent: {
        kind: 'LISTED',
        handle: 'deck-forge',
        name: 'Deck Forge',
        logo: OPPONENT_LOGO,
      },
    });

    const link = row().getByRole('link', { name: 'Deck Forge' });
    await expect.element(link).toHaveAttribute('href', '/p/deck-forge');
    await expect.element(row().getByText('vs', { exact: true })).toBeVisible();
    const prefix = row().getByText('対戦相手:', { exact: true });
    expect(prefix.element().classList.contains('sr-only')).toBe(true);
    // 画像が読み込めないテストの環境では仮の表示に替わるため、ロゴの位置に要素があることを確かめる
    expect(
      row().element().querySelector('[data-slot="opponent-logo"] > *'),
    ).not.toBeNull();
  });

  test('可視だが未掲載の対戦相手は、リンクの無い名称とロゴで示す', async () => {
    await renderRow({
      opponent: {
        kind: 'UNLISTED',
        handle: null,
        name: 'Quiet Draft',
        logo: null,
      },
    });

    await expect
      .element(row().getByText('Quiet Draft', { exact: true }))
      .toBeVisible();
    expect(row().getByRole('link').elements()).toStrictEqual([]);
    expect(
      row().element().querySelector('[data-slot="opponent-logo"] > *'),
    ).not.toBeNull();
  });

  test('表示できない対戦相手は、汎用のアイコンと「非公開のプロダクト」で示し、リンクを付けない', async () => {
    await renderRow({ opponent: PRIVATE_OPPONENT });

    await expect
      .element(row().getByText('非公開のプロダクト', { exact: true }))
      .toBeVisible();
    expect(row().getByRole('link').elements()).toStrictEqual([]);
    expect(
      row().element().querySelector('[data-slot="hidden-opponent-icon"] svg'),
    ).not.toBeNull();
  });

  test('勝ったマッチは比率のバー・「自分対相手」のスコア・「勝利」を示す', async () => {
    await renderRow({ ownUpvoteCount: 1234, opponentUpvoteCount: 9 });

    await expect
      .element(ratioBar())
      .toHaveAccessibleName('Upvote数の比率: 1,234対9');
    await expect
      .element(row().getByText('1,234対9', { exact: true }))
      .toBeVisible();
    await expect
      .element(row().getByText('勝利', { exact: true }))
      .toBeVisible();
  });

  test('負けたマッチは自分の数を先にしたスコアと「敗北」を示す', async () => {
    await renderRow({
      result: 'LOST',
      ownUpvoteCount: 9,
      opponentUpvoteCount: 12,
    });

    await expect
      .element(ratioBar())
      .toHaveAccessibleName('Upvote数の比率: 9対12');
    await expect
      .element(row().getByText('9対12', { exact: true }))
      .toBeVisible();
    await expect
      .element(row().getByText('敗北', { exact: true }))
      .toBeVisible();
  });

  test.each([
    ['WON', '同点・最終Upvote時間が早く勝利'],
    ['LOST', '同点・最終Upvote時間の差で敗北'],
  ] as const)(
    '同数で最終Upvote時間により決まったマッチ(%s)は「接戦」の印と注記を添え、枠を強調する',
    async (result, note) => {
      await renderRow({
        result,
        decision: 'LAST_UPVOTE',
        ownUpvoteCount: 10,
        opponentUpvoteCount: 10,
      });

      await expect
        .element(row().getByText('接戦', { exact: true }))
        .toBeVisible();
      await expect
        .element(row().getByText(note, { exact: true }))
        .toBeVisible();
      await expect.element(row()).toHaveAttribute('data-close-match', 'true');
    },
  );

  test('接戦でないマッチは印と注記を出さず、枠を強調しない', async () => {
    await renderRow();

    expect(row().getByText('接戦').elements()).toStrictEqual([]);
    await expect.element(row()).not.toHaveAttribute('data-close-match');
  });

  test('対戦相手がいない不戦勝は「対戦相手なし」「不戦勝」「対戦相手がいないため」を示し、Upvote数と比率のバーを出さない', async () => {
    await renderRow({
      result: 'BYE',
      decision: 'BYE',
      ownUpvoteCount: 0,
      opponentUpvoteCount: null,
      opponent: NO_OPPONENT,
    });

    await expect
      .element(row().getByText('対戦相手なし', { exact: true }))
      .toBeVisible();
    await expect
      .element(row().getByText('不戦勝', { exact: true }))
      .toBeVisible();
    await expect
      .element(row().getByText('対戦相手がいないため', { exact: true }))
      .toBeVisible();
    expect(row().getByRole('img', { name: /比率/u }).elements()).toStrictEqual(
      [],
    );
    expect(row().getByText(/対\d/u).elements()).toStrictEqual([]);
  });

  test('マッチ直前の相手の退会等による不戦勝は、対戦相手を「非公開のプロダクト」にして同じく示す', async () => {
    await renderRow({
      result: 'WALKOVER',
      decision: 'WALKOVER',
      ownUpvoteCount: 0,
      opponentUpvoteCount: null,
      opponent: PRIVATE_OPPONENT,
    });

    await expect
      .element(row().getByText('非公開のプロダクト', { exact: true }))
      .toBeVisible();
    await expect
      .element(row().getByText('不戦勝', { exact: true }))
      .toBeVisible();
    await expect
      .element(row().getByText('対戦相手がいないため', { exact: true }))
      .toBeVisible();
    expect(row().getByRole('img', { name: /比率/u }).elements()).toStrictEqual(
      [],
    );
  });

  test('マッチ中の相手の退会等による不戦勝は、「非公開のプロダクト」「不戦勝」と確定時点の自身のUpvote数だけを示す', async () => {
    await renderRow({
      result: 'WALKOVER',
      decision: 'WALKOVER',
      endedEarly: true,
      ownUpvoteCount: 12,
      opponentUpvoteCount: null,
      opponent: PRIVATE_OPPONENT,
    });

    await expect
      .element(row().getByText('非公開のプロダクト', { exact: true }))
      .toBeVisible();
    await expect
      .element(row().getByText('不戦勝', { exact: true }))
      .toBeVisible();
    await expect.element(row().getByText('確定時点で12票')).toBeVisible();
    expect(row().getByText('対戦相手がいないため').elements()).toStrictEqual(
      [],
    );
    expect(row().getByRole('img', { name: /比率/u }).elements()).toStrictEqual(
      [],
    );
    expect(row().getByText(/対\d/u).elements()).toStrictEqual([]);
  });

  test('両者敗北は「両者敗北」を示す', async () => {
    await renderRow({
      result: 'LOST',
      decision: 'NO_VOTES',
      ownUpvoteCount: 0,
      opponentUpvoteCount: 0,
    });

    await expect
      .element(row().getByText('両者敗北', { exact: true }))
      .toBeVisible();
    await expect
      .element(ratioBar())
      .toHaveAccessibleName('Upvote数の比率: 0対0');
    await expect
      .element(row().getByText('0対0', { exact: true }))
      .toBeVisible();
    expect(row().getByText('敗北', { exact: true }).elements()).toStrictEqual(
      [],
    );
  });

  test('確定のUpvote数が1以上なら「サポーター◯人」のボタンでマッチの下の一覧を開閉する', async () => {
    await renderRow({ ownUpvoteCount: 1234 });

    const button = supportersButton('1,234');
    await expect.element(button).toHaveAttribute('aria-expanded', 'false');
    const panelId = button.element().getAttribute('aria-controls');
    expect(panelId).not.toBeNull();
    const panel = document.getElementById(panelId ?? '');
    expect(panel).not.toBeNull();
    expect(row().element().contains(panel)).toBe(true);
    expect(panel?.hidden).toBe(true);
    expect(executeGraphQL).not.toHaveBeenCalled();

    await userEvent.click(button);

    await expect.element(button).toHaveAttribute('aria-expanded', 'true');
    await expect
      .element(page.getByRole('link', { name: 'サポーター2号' }))
      .toBeVisible();
    expect(executeGraphQL).toHaveBeenCalledWith(
      ClientMatchSupportersDocument,
      {
        productHandle: PRODUCT_HANDLE,
        matchId: '01JD0MATCH0000000000000001',
        entryId: '01JD0ENTRY0000000000000001',
        first: 20,
      },
      expect.anything(),
    );

    await userEvent.click(button);

    await expect.element(button).toHaveAttribute('aria-expanded', 'false');
    expect(panel?.hidden).toBe(true);
  });

  test('確定のUpvote数が0なら「サポーター◯人」を出さない', async () => {
    await renderRow({
      result: 'LOST',
      ownUpvoteCount: 0,
      opponentUpvoteCount: 3,
    });

    expect(row().getByRole('button').elements()).toStrictEqual([]);
  });

  test.each(COLOR_SCHEMES)(
    '%sの配色で、全ての見え方の行とサポーターの一覧を開いた状態でaxeの違反が0件である',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderRows([
        historyMatchOf({
          id: 'm1',
          decision: 'LAST_UPVOTE',
          ownUpvoteCount: 10,
          opponentUpvoteCount: 10,
          opponent: {
            kind: 'LISTED',
            handle: 'deck-forge',
            name: 'Deck Forge',
            logo: OPPONENT_LOGO,
          },
        }),
        historyMatchOf({
          id: 'm2',
          result: 'LOST',
          ownUpvoteCount: 3,
          opponentUpvoteCount: 12,
          opponent: {
            kind: 'UNLISTED',
            handle: null,
            name: 'Quiet Draft',
            logo: null,
          },
        }),
        historyMatchOf({
          id: 'm3',
          result: 'BYE',
          decision: 'BYE',
          ownUpvoteCount: 0,
          opponentUpvoteCount: null,
          opponent: NO_OPPONENT,
        }),
        historyMatchOf({
          id: 'm4',
          result: 'WALKOVER',
          decision: 'WALKOVER',
          endedEarly: true,
          ownUpvoteCount: 12,
          opponentUpvoteCount: null,
          opponent: PRIVATE_OPPONENT,
        }),
        historyMatchOf({
          id: 'm5',
          result: 'LOST',
          decision: 'NO_VOTES',
          ownUpvoteCount: 0,
          opponentUpvoteCount: 0,
        }),
      ]);
      await userEvent.click(supportersButton('10'));
      await expect
        .element(page.getByRole('link', { name: 'サポーター2号' }))
        .toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
