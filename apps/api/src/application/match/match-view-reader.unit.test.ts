import { describe, expect, test } from 'bun:test';

import { teamColorIndexOf } from '../../../common-lib/match/team-colors.ts';
import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import type { MatchRecord } from '../../../lib/core/match/ports.ts';
import { DirectoryMatchViewReader } from './match-view-reader.ts';
import {
  createFakeKickoffProductDirectory,
  productSummaryOf,
} from './testing/kickoff-fakes.ts';
import { VOTER_ID, voterOf } from './testing/upvote-fakes.ts';
import {
  createFakeMatchBoardStore,
  createFakeMatchDirectory,
  matchRecordOf,
  VIEW_NOW,
  VIEW_WINDOW,
  viewEntryIdOf,
  viewMatchIdOf,
  viewOwnerIdOf,
  viewProductIdOf,
} from './testing/view-fakes.ts';

function summariesOf(records: readonly MatchRecord[]) {
  return records.flatMap((record) =>
    record.entries.flatMap((entry) =>
      entry.productId === null
        ? []
        : [
            productSummaryOf(entry.productId, {
              ownerUserId: entry.ownerUserId ?? 'owner-unknown',
            }),
          ],
    ),
  );
}

function readerOf(
  records: readonly MatchRecord[],
  options: {
    readonly summaries?: ReturnType<typeof summariesOf>;
    readonly upvotes?: ReadonlyMap<string, string>;
  } = {},
) {
  const matches = createFakeMatchDirectory(records);
  const products = createFakeKickoffProductDirectory(
    options.summaries ?? summariesOf(records),
    [],
  );
  const board = createFakeMatchBoardStore(options.upvotes);
  return {
    matches,
    products,
    board,
    reader: new DirectoryMatchViewReader(matches, products, board),
  };
}

const ownerOf = (matchIndex: number, slot: 1 | 2): CurrentUser =>
  voterOf({ id: viewOwnerIdOf(matchIndex, slot) });

describe('DirectoryMatchViewReader.findViews の照会', () => {
  test('マッチの照会・プロダクトの照会・閲覧者のUpvoteの照会を、複数のマッチでも1回ずつ呼ぶ', async () => {
    const records = [matchRecordOf(1), matchRecordOf(2), matchRecordOf(3)];
    const { reader, matches, products, board } = readerOf(records);

    const views = await reader.findViews({
      matchIds: records.map((record) => record.matchId),
      viewer: voterOf(),
      now: VIEW_NOW,
    });

    expect([...views.keys()]).toEqual(records.map((record) => record.matchId));
    expect(matches.findReads).toEqual([
      {
        matchIds: [viewMatchIdOf(1), viewMatchIdOf(2), viewMatchIdOf(3)],
        now: VIEW_NOW,
      },
    ]);
    expect(products.summaryReads).toEqual([
      {
        productIds: [1, 2, 3].flatMap((index) => [
          viewProductIdOf(index, 1),
          viewProductIdOf(index, 2),
        ]),
        scope: 'visible',
      },
    ]);
    expect(board.reads).toEqual([
      {
        matchIds: [viewMatchIdOf(1), viewMatchIdOf(2), viewMatchIdOf(3)],
        userId: VOTER_ID,
      },
    ]);
  });

  test('未ログインの閲覧者では閲覧者のUpvoteを照会せず、制限をguestにする', async () => {
    const { reader, board } = readerOf([matchRecordOf(1)]);

    const views = await reader.findViews({
      matchIds: [viewMatchIdOf(1)],
      viewer: undefined,
      now: VIEW_NOW,
    });

    expect(board.reads).toEqual([]);
    expect(views.get(viewMatchIdOf(1))).toMatchObject({
      viewerUpvotedEntryId: null,
      viewerRestriction: 'guest',
    });
  });

  test('見つからないマッチは結果に含めず、マッチが無ければプロダクトと閲覧者のUpvoteを照会しない', async () => {
    const { reader, products, board } = readerOf([]);

    const views = await reader.findViews({
      matchIds: [viewMatchIdOf(9)],
      viewer: voterOf(),
      now: VIEW_NOW,
    });

    expect(views.size).toBe(0);
    expect(products.summaryReads).toEqual([]);
    expect(board.reads).toEqual([]);
  });
});

describe('DirectoryMatchViewReader の側の組み立て', () => {
  test('表示できるプロダクトの項目と、側の集計値・結果をそのまま写す', async () => {
    const record = matchRecordOf(1, {
      entries: [{ upvoteCount: 12, result: null }, { upvoteCount: 9 }],
    });
    const { reader } = readerOf([record], {
      summaries: [
        productSummaryOf(viewProductIdOf(1, 1), {
          handle: 'alpha',
          name: 'アルファ',
          tagline: '速いツール',
          category: { id: 'category-9', name: '開発', handle: 'dev' },
          websiteUrl: 'https://alpha.example/',
          logoFileId: 'logo-alpha',
          listed: true,
        }),
        productSummaryOf(viewProductIdOf(1, 2)),
      ],
    });

    const view = (
      await reader.assemble({ records: [record], viewer: undefined })
    ).get(viewMatchIdOf(1));

    expect(view?.record).toBe(record);
    expect(view?.entries[0]).toEqual({
      entryId: viewEntryIdOf(1, 1),
      product: {
        productId: viewProductIdOf(1, 1),
        handle: 'alpha',
        name: 'アルファ',
        tagline: '速いツール',
        categoryId: 'category-9',
        websiteUrl: 'https://alpha.example/',
        logoFileId: 'logo-alpha',
        listed: true,
      },
      isViewerOwn: false,
      upvoteCount: 12,
      result: null,
      colorIndex: teamColorIndexOf(viewProductIdOf(1, 1)),
    });
    expect(view?.entries[1]?.upvoteCount).toBe(9);
  });

  test('表示できないプロダクトと紐付けを解除した側はプロダクトを空にし、紐付けを解除した側の配色の番号は0にする', async () => {
    const record = matchRecordOf(1, {
      decidedAt: VIEW_WINDOW.endsAt,
      decision: 'votes',
      entries: [
        { upvoteCount: 3, result: 'won' },
        { productId: null, ownerUserId: null, launchId: null, result: 'lost' },
      ],
    });
    const hidden = matchRecordOf(2);
    const { reader } = readerOf([record, hidden], {
      summaries: [
        productSummaryOf(viewProductIdOf(1, 1), { visible: false }),
        productSummaryOf(viewProductIdOf(2, 1)),
      ],
    });

    const views = await reader.assemble({
      records: [record, hidden],
      viewer: undefined,
    });

    expect(views.get(viewMatchIdOf(1))?.entries).toEqual([
      expect.objectContaining({
        product: null,
        upvoteCount: 3,
        result: 'won',
        colorIndex: teamColorIndexOf(viewProductIdOf(1, 1)),
      }),
      expect.objectContaining({ product: null, result: 'lost', colorIndex: 0 }),
    ]);
    expect(
      views
        .get(viewMatchIdOf(2))
        ?.entries.map((entry) => entry.product?.productId ?? null),
    ).toEqual([viewProductIdOf(2, 1), null]);
  });

  test('配色の番号はプロダクトのIDで決まり、同じプロダクトは別のマッチでも同じ番号になる', async () => {
    const shared = viewProductIdOf(1, 1);
    const first = matchRecordOf(1);
    const second = matchRecordOf(2, { entries: [{ productId: shared }, {}] });
    const { reader } = readerOf([first, second]);

    const views = await reader.assemble({
      records: [first, second],
      viewer: undefined,
    });

    expect(views.get(viewMatchIdOf(1))?.entries[0]?.colorIndex).toBe(
      teamColorIndexOf(shared),
    );
    expect(views.get(viewMatchIdOf(2))?.entries[0]?.colorIndex).toBe(
      teamColorIndexOf(shared),
    );
    expect(views.get(viewMatchIdOf(2))?.entries[1]?.colorIndex).toBe(
      teamColorIndexOf(viewProductIdOf(2, 2)),
    );
  });
});

describe('DirectoryMatchViewReader の閲覧者の印と制限', () => {
  test('閲覧者自身の側に印を付け、自分のマッチの制限をown_matchにする', async () => {
    const record = matchRecordOf(1);
    const { reader } = readerOf([record]);

    const view = (
      await reader.assemble({ records: [record], viewer: ownerOf(1, 2) })
    ).get(viewMatchIdOf(1));

    expect(view?.entries.map((entry) => entry.isViewerOwn)).toEqual([
      false,
      true,
    ]);
    expect(view?.viewerRestriction).toBe('own_match');
  });

  test('閲覧者の有効なUpvoteの側を返し、受け付け中で制限の無い閲覧者の制限はnullにする', async () => {
    const records = [matchRecordOf(1), matchRecordOf(2)];
    const { reader } = readerOf(records, {
      upvotes: new Map([[viewMatchIdOf(1), viewEntryIdOf(1, 2)]]),
    });

    const views = await reader.assemble({ records, viewer: voterOf() });

    expect(views.get(viewMatchIdOf(1))).toMatchObject({
      viewerUpvotedEntryId: viewEntryIdOf(1, 2),
      viewerRestriction: null,
    });
    expect(views.get(viewMatchIdOf(2))?.viewerUpvotedEntryId).toBeNull();
  });

  test.each([
    ['集計中', { now: VIEW_WINDOW.endsAt }, 'not_accepting'],
    ['開始の記録の前', { startedAt: null }, 'not_accepting'],
  ] as const)(
    '%sのマッチは閲覧者によらずnot_acceptingにする',
    async (_label, options, expected) => {
      const record = matchRecordOf(1, options);
      const { reader } = readerOf([record]);

      const view = (
        await reader.assemble({ records: [record], viewer: voterOf() })
      ).get(viewMatchIdOf(1));

      expect(view?.viewerRestriction).toBe(expected);
    },
  );

  test.each([
    ['メールアドレスが未確認', { emailVerifiedAt: null }, 'email_not_verified'],
    ['停止中', { status: 'suspended' as const }, 'account_unavailable'],
  ] as const)('%sの閲覧者の制限を示す', async (_label, overrides, expected) => {
    const record = matchRecordOf(1);
    const { reader } = readerOf([record]);

    const view = (
      await reader.assemble({
        records: [record],
        viewer: voterOf(overrides),
      })
    ).get(viewMatchIdOf(1));

    expect(view?.viewerRestriction).toBe(expected);
  });
});
