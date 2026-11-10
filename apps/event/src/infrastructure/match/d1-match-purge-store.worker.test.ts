import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { asc } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { matchUpvotes } from '../../../db/schema/match/match-upvotes.ts';
import {
  minutesAfterStart,
  seedDirectoryOwners,
  settledQualifier,
} from '../../../lib/workers/match/testing/directory-fixtures.ts';
import { readEntryRows } from '../../../lib/workers/match/testing/event-fixtures.ts';
import {
  entryIdOf,
  insertMatches,
  insertUpvotes,
  upvoteIdOf,
} from '../../../lib/workers/match/testing/match-fixtures.ts';
import {
  db,
  insertUser,
  launchIdOf,
  productIdOf,
  T0,
  userIdOf,
} from '../../../lib/workers/product/testing/product-fixtures.ts';
import type { MatchPurgeStore } from '../../application/match/ports.ts';
import { D1MatchPurgeStore } from './d1-match-purge-store.ts';

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const SUPPORTER = 3;

const OTHER_SUPPORTER = 4;

const UNLINKED_AT = new Date('2026-12-20T03:00:05.000Z');

function createStore(): MatchPurgeStore {
  return new D1MatchPurgeStore(db);
}

async function upvoteIds(): Promise<readonly string[]> {
  const rows = await db
    .select({ id: matchUpvotes.id })
    .from(matchUpvotes)
    .orderBy(asc(matchUpvotes.id));
  return rows.map(({ id }) => id);
}

// 利用者1のプロダクト1と利用者2のプロダクト3の確定した予選(マッチ1)と、利用者1のプロダクト2と利用者2のプロダクト4の確定した予選(マッチ2)
async function seedSettledMatches(): Promise<void> {
  const second = settledQualifier(2);
  await insertMatches([
    settledQualifier(1),
    {
      ...second,
      entries: [
        { ...second.entries[0], index: 21, launch: 2, product: 2, owner: 1 },
        { ...second.entries[1], index: 22, launch: 4, product: 4, owner: 2 },
      ],
    },
  ]);
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await seedDirectoryOwners();
  await insertUser(SUPPORTER);
  await insertUser(OTHER_SUPPORTER);
  await seedSettledMatches();
});

describe('D1MatchPurgeStore.deleteUpvotesBatch', () => {
  test('利用者のUpvoteを論理削除済みも含めて消して件数を返し、他の利用者のUpvoteと側の確定値を残す', async () => {
    await insertUpvotes([
      {
        index: 1,
        match: 1,
        entry: 11,
        user: SUPPORTER,
        upvotedAt: minutesAfterStart(10),
      },
      {
        index: 2,
        match: 2,
        entry: 22,
        user: SUPPORTER,
        upvotedAt: minutesAfterStart(20),
        columns: { deletedAt: minutesAfterStart(30) },
      },
      {
        index: 3,
        match: 1,
        entry: 12,
        user: OTHER_SUPPORTER,
        upvotedAt: minutesAfterStart(40),
      },
    ]);
    const entriesBefore = await readEntryRows();

    await expect(
      createStore().deleteUpvotesBatch(userIdOf(SUPPORTER), 10),
    ).resolves.toBe(2);

    await expect(upvoteIds()).resolves.toStrictEqual([upvoteIdOf(3)]);
    await expect(readEntryRows()).resolves.toStrictEqual(entriesBefore);
  });

  test('上限の件数までだけを消し、残りを次の呼び出しで消して0件で終わる', async () => {
    await insertUpvotes(
      [1, 2, 3].map((index) => ({
        index,
        match: 1,
        entry: 11,
        user: SUPPORTER,
        upvotedAt: minutesAfterStart(index),
        columns: index < 3 ? { deletedAt: minutesAfterStart(index + 1) } : {},
      })),
    );
    const store = createStore();

    await expect(
      store.deleteUpvotesBatch(userIdOf(SUPPORTER), 2),
    ).resolves.toBe(2);
    await expect(upvoteIds()).resolves.toHaveLength(1);
    await expect(
      store.deleteUpvotesBatch(userIdOf(SUPPORTER), 2),
    ).resolves.toBe(1);
    await expect(
      store.deleteUpvotesBatch(userIdOf(SUPPORTER), 2),
    ).resolves.toBe(0);
    await expect(upvoteIds()).resolves.toStrictEqual([]);
  });
});

describe('D1MatchPurgeStore.clearOwner', () => {
  test('利用者が投稿者の側のowner_user_idだけをNULLにし、プロダクト・ローンチの紐付けと他の投稿者の側を残す', async () => {
    const entriesBefore = await readEntryRows();

    await createStore().clearOwner(userIdOf(1));

    const entries = await readEntryRows();
    expect(
      entries.map(({ id, ownerUserId }) => [id, ownerUserId]),
    ).toStrictEqual([
      [entryIdOf(11), null],
      [entryIdOf(12), userIdOf(2)],
      [entryIdOf(21), null],
      [entryIdOf(22), userIdOf(2)],
    ]);
    expect(
      entries.map(({ productId, launchId, unlinkedAt }) => ({
        productId,
        launchId,
        unlinkedAt,
      })),
    ).toStrictEqual(
      entriesBefore.map(({ productId, launchId, unlinkedAt }) => ({
        productId,
        launchId,
        unlinkedAt,
      })),
    );
  });

  test('投稿者の側が無ければ何も変えない', async () => {
    const entriesBefore = await readEntryRows();

    await createStore().clearOwner(userIdOf(SUPPORTER));

    await expect(readEntryRows()).resolves.toStrictEqual(entriesBefore);
  });
});

describe('D1MatchPurgeStore.unlinkProduct', () => {
  test('プロダクトの側のプロダクト・ローンチ・投稿者をNULLにして解除の日時を記録し、確定値・結果と相手の側を残す', async () => {
    const [entry11, entry12, ...others] = await readEntryRows();

    await createStore().unlinkProduct(productIdOf(1), UNLINKED_AT);

    const [unlinked, opponent, ...rest] = await readEntryRows();
    expect(unlinked).toStrictEqual({
      ...entry11,
      productId: null,
      launchId: null,
      ownerUserId: null,
      unlinkedAt: UNLINKED_AT,
      updatedAt: UNLINKED_AT,
    });
    expect(unlinked).toMatchObject({ upvoteCount: 12, result: 'won' });
    expect(opponent).toStrictEqual(entry12);
    expect(rest).toStrictEqual(others);
  });

  test('解除済みの側は書き換えず、2回目の呼び出しで解除の日時を変えない', async () => {
    const store = createStore();
    await store.unlinkProduct(productIdOf(1), UNLINKED_AT);
    const entriesBefore = await readEntryRows();

    await store.unlinkProduct(
      productIdOf(1),
      new Date(UNLINKED_AT.getTime() + 60_000),
    );

    await expect(readEntryRows()).resolves.toStrictEqual(entriesBefore);
  });

  test('側の無いプロダクトでは何も変えない', async () => {
    const entriesBefore = await readEntryRows();

    await createStore().unlinkProduct(productIdOf(9), UNLINKED_AT);

    await expect(readEntryRows()).resolves.toStrictEqual(entriesBefore);
    expect(entriesBefore[0]).toMatchObject({
      launchId: launchIdOf(1),
      createdAt: T0,
    });
  });
});
