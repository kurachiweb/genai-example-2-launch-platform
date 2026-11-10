import { beforeEach, describe, expect, test } from 'vitest';

import {
  db,
  insertUser,
  insertUsers,
  userIdOf,
} from '../product/testing/product-fixtures.ts';
import { D1SupporterDirectory } from './d1-match-directory.ts';
import {
  AFTER_DECISION,
  DURING_MATCH,
  minutesAfterStart,
  seedDirectoryOwners,
  settledQualifier,
  STARTS_AT,
} from './testing/directory-fixtures.ts';
import {
  entryIdOf,
  insertMatches,
  insertUpvotes,
  upvoteIdOf,
} from './testing/match-fixtures.ts';

const supporters = new D1SupporterDirectory(db);

beforeEach(seedDirectoryOwners);

describe('listSupporters', () => {
  const UPVOTER_COUNT = 25;

  function upvotedAt(minutes: number): Date {
    return minutesAfterStart(minutes);
  }

  beforeEach(async () => {
    await insertUsers(
      Array.from({ length: UPVOTER_COUNT + 3 }, (_, offset) => 10 + offset),
    );
    await insertUser(50, { status: 'suspended', suspendedAt: DURING_MATCH });
    await insertUser(51, { deletedAt: AFTER_DECISION });
    await insertMatches([
      settledQualifier(1),
      {
        index: 2,
        columns: { startedAt: STARTS_AT },
        entries: [
          { index: 21, launch: 2, product: 2, owner: 1 },
          { index: 22, launch: 4, product: 4, owner: 2 },
        ],
      },
    ]);
    await insertUpvotes([
      ...Array.from({ length: UPVOTER_COUNT }, (_, offset) => ({
        index: 100 + offset,
        match: 1,
        entry: 11,
        user: 10 + offset,
        upvotedAt: upvotedAt(UPVOTER_COUNT - offset),
      })),
      { index: 200, match: 1, entry: 12, user: 35, upvotedAt: upvotedAt(1) },
      {
        index: 201,
        match: 1,
        entry: 11,
        user: 36,
        upvotedAt: upvotedAt(2),
        columns: { deletedAt: DURING_MATCH },
      },
      { index: 202, match: 1, entry: 11, user: 50, upvotedAt: upvotedAt(3) },
      { index: 203, match: 1, entry: 11, user: 51, upvotedAt: upvotedAt(4) },
      { index: 300, match: 2, entry: 21, user: 10, upvotedAt: upvotedAt(5) },
    ]);
  });

  test('確定したマッチの側の有効なUpvoteを、Upvoteの日時の早い順に件数の上限まで返し、論理削除と退会済み・停止中の利用者を除く', async () => {
    const page = await supporters.listSupporters({
      entryId: entryIdOf(11),
      after: undefined,
      limit: 20,
    });

    expect(page).toHaveLength(20);
    expect(page[0]).toEqual({
      upvoteId: upvoteIdOf(124),
      userId: userIdOf(34),
      upvotedAt: upvotedAt(1),
    });
    expect(page.map((supporter) => supporter.upvotedAt.getTime())).toEqual(
      Array.from({ length: 20 }, (_, offset) =>
        upvotedAt(offset + 1).getTime(),
      ),
    );
    expect(page.map((supporter) => supporter.userId)).not.toContain(
      userIdOf(50),
    );
    expect(page.map((supporter) => supporter.userId)).not.toContain(
      userIdOf(51),
    );
    expect(page.map((supporter) => supporter.userId)).not.toContain(
      userIdOf(36),
    );
  });

  test('続きの位置を渡すと、その次のUpvoteから返す', async () => {
    const first = await supporters.listSupporters({
      entryId: entryIdOf(11),
      after: undefined,
      limit: 20,
    });
    const last = first.at(-1);

    const rest = await supporters.listSupporters({
      entryId: entryIdOf(11),
      after:
        last === undefined
          ? undefined
          : { upvotedAt: last.upvotedAt, upvoteId: last.upvoteId },
      limit: 20,
    });

    expect(rest.map((supporter) => supporter.upvoteId)).toEqual(
      [104, 103, 102, 101, 100].map(upvoteIdOf),
    );
  });

  test('Upvoteの日時が同じUpvoteはUpvoteのIDの順に並べ、続きの位置で取りこぼさない', async () => {
    await insertUpvotes([
      { index: 401, match: 1, entry: 12, user: 36, upvotedAt: upvotedAt(1) },
      { index: 402, match: 1, entry: 12, user: 37, upvotedAt: upvotedAt(1) },
    ]);

    const first = await supporters.listSupporters({
      entryId: entryIdOf(12),
      after: undefined,
      limit: 2,
    });
    const rest = await supporters.listSupporters({
      entryId: entryIdOf(12),
      after: { upvotedAt: upvotedAt(1), upvoteId: upvoteIdOf(401) },
      limit: 2,
    });

    expect(first.map((supporter) => supporter.upvoteId)).toEqual(
      [200, 401].map(upvoteIdOf),
    );
    expect(rest.map((supporter) => supporter.upvoteId)).toEqual([
      upvoteIdOf(402),
    ]);
  });

  test('結果が確定していないマッチの側には空を返す', async () => {
    const page = await supporters.listSupporters({
      entryId: entryIdOf(21),
      after: undefined,
      limit: 20,
    });

    expect(page).toEqual([]);
  });

  test.each([0, 21, 1.5])(
    '件数%sは1〜20の整数でないため拒否する',
    async (limit) => {
      await expect(
        supporters.listSupporters({
          entryId: entryIdOf(11),
          after: undefined,
          limit,
        }),
      ).rejects.toThrow(RangeError);
    },
  );
});
