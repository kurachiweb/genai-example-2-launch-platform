import { asc } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { launchComments } from '../../../db/schema/engagement/launch-comments.ts';
import {
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../core/time/business-time.ts';
import { D1EngagementErasureStore } from './d1-engagement-erasure-store.ts';
import {
  clearEngagementTables,
  commentIdOf,
  countComments,
  db,
  insertComment,
  insertComments,
  insertLaunch,
  insertProduct,
  insertUser,
  readComment,
  T0,
  userIdOf,
} from './testing/engagement-fixtures.ts';

const OWNER = 1;
const COMMENTER = 2;
const REPLIER = 3;
const WITHDRAWN = 4;
const PRODUCT = 1;
const LAUNCH = 1;
const LIMIT = 500;

function businessTime(date: string, hour = 0, minute = 0): Date {
  return fromBusinessDateTime(parseBusinessDate(date), { hour, minute });
}

// 実行日2026-11-27の4:21のジョブが渡す閾値(実行日−12日の0:00)と、期限を過ぎた行を数える閾値(実行日−13日の0:00)
const RUN_AT = businessTime('2026-11-27', 4, 21);
const THRESHOLD = businessTime('2026-11-15');
const OVERDUE_THRESHOLD = businessTime('2026-11-14');

const store = new D1EngagementErasureStore(db);

async function anonymizedIds(): Promise<string[]> {
  const rows = await db
    .select({
      id: launchComments.id,
      anonymizedAt: launchComments.anonymizedAt,
    })
    .from(launchComments)
    .orderBy(asc(launchComments.id));
  return rows.filter((row) => row.anonymizedAt !== null).map((row) => row.id);
}

beforeEach(async () => {
  await clearEngagementTables();
  await insertUser(OWNER, { emailVerifiedAt: T0 });
  await insertUser(COMMENTER, { emailVerifiedAt: T0 });
  await insertUser(REPLIER, { emailVerifiedAt: T0 });
  await insertUser(WITHDRAWN, {
    emailVerifiedAt: T0,
    deletedAt: businessTime('2026-11-13', 22, 0),
  });
  await insertProduct(PRODUCT, OWNER);
  await insertLaunch(LAUNCH, PRODUCT);
});

describe('D1EngagementErasureStore.anonymizeDeletedBefore', () => {
  test('削除の業務日付から13日目の閾値より前の未匿名化のコメントだけを、本文を空・投稿者を外して行を残し、12日目の行は残す', async () => {
    const thirteenthDayLate = businessTime('2026-11-14', 23, 59);
    await insertComment({
      index: 1,
      product: PRODUCT,
      launch: LAUNCH,
      author: COMMENTER,
      columns: { deletedAt: thirteenthDayLate },
    });
    await insertComment({
      index: 2,
      product: PRODUCT,
      launch: LAUNCH,
      author: COMMENTER,
      columns: { deletedAt: businessTime('2026-11-14') },
    });
    await insertComment({
      index: 3,
      product: PRODUCT,
      launch: LAUNCH,
      author: COMMENTER,
      columns: { deletedAt: businessTime('2026-11-15') },
    });
    await insertComment({
      index: 4,
      product: PRODUCT,
      launch: LAUNCH,
      author: COMMENTER,
      columns: { deletedAt: businessTime('2026-11-26', 23, 0) },
    });
    await insertComment({
      index: 5,
      product: PRODUCT,
      launch: LAUNCH,
      author: COMMENTER,
    });

    const anonymized = await store.anonymizeDeletedBefore({
      threshold: THRESHOLD,
      at: RUN_AT,
      limit: LIMIT,
    });

    expect(anonymized).toBe(2);
    expect(await readComment(1)).toMatchObject({
      body: '',
      authorUserId: null,
      anonymizedAt: RUN_AT,
      updatedAt: RUN_AT,
      deletedAt: thirteenthDayLate,
    });
    expect(await readComment(2)).toMatchObject({
      body: '',
      authorUserId: null,
      anonymizedAt: RUN_AT,
    });
    for (const index of [3, 4, 5]) {
      expect(await readComment(index)).toMatchObject({
        body: `コメント${String(index)}`,
        authorUserId: userIdOf(COMMENTER),
        anonymizedAt: null,
      });
    }
    expect(await countComments()).toBe(5);
  });

  test('管理者が非公開化しただけのコメントは匿名化せず、非公開化と削除の両方の印を持つコメントは匿名化する', async () => {
    await insertComment({
      index: 1,
      product: PRODUCT,
      launch: LAUNCH,
      author: COMMENTER,
      columns: { hiddenAt: businessTime('2026-11-01') },
    });
    await insertComment({
      index: 2,
      product: PRODUCT,
      launch: LAUNCH,
      author: COMMENTER,
      columns: {
        hiddenAt: businessTime('2026-11-01'),
        deletedAt: businessTime('2026-11-02'),
      },
    });

    const anonymized = await store.anonymizeDeletedBefore({
      threshold: THRESHOLD,
      at: RUN_AT,
      limit: LIMIT,
    });

    expect(anonymized).toBe(1);
    expect(await anonymizedIds()).toEqual([commentIdOf(2)]);
    expect(await readComment(1)).toMatchObject({
      body: 'コメント1',
      authorUserId: userIdOf(COMMENTER),
      hiddenAt: businessTime('2026-11-01'),
    });
  });

  test('退会で論理削除したコメントも退会の日時で匿名化し、付いている返信と親子のつながりを保つ', async () => {
    await insertComment({
      index: 1,
      product: PRODUCT,
      launch: LAUNCH,
      author: WITHDRAWN,
      columns: { deletedAt: businessTime('2026-11-13', 22, 0) },
    });
    await insertComment({
      index: 2,
      product: PRODUCT,
      launch: LAUNCH,
      author: REPLIER,
      parent: { index: 1, root: 1 },
      depth: 2,
    });

    await store.anonymizeDeletedBefore({
      threshold: THRESHOLD,
      at: RUN_AT,
      limit: LIMIT,
    });

    expect(await readComment(1)).toMatchObject({
      body: '',
      authorUserId: null,
      anonymizedAt: RUN_AT,
    });
    expect(await readComment(2)).toMatchObject({
      parentId: commentIdOf(1),
      rootId: commentIdOf(1),
      authorUserId: userIdOf(REPLIER),
      body: 'コメント2',
      anonymizedAt: null,
    });
  });

  test('同じ日に2回実行しても、匿名化済みの行を変えず0件を返す', async () => {
    await insertComment({
      index: 1,
      product: PRODUCT,
      launch: LAUNCH,
      author: COMMENTER,
      columns: { deletedAt: businessTime('2026-11-10') },
    });
    await store.anonymizeDeletedBefore({
      threshold: THRESHOLD,
      at: RUN_AT,
      limit: LIMIT,
    });
    const first = await readComment(1);

    const second = await store.anonymizeDeletedBefore({
      threshold: THRESHOLD,
      at: businessTime('2026-11-27', 4, 30),
      limit: LIMIT,
    });

    expect(second).toBe(0);
    expect(await readComment(1)).toEqual(first);
  });

  test('1回で500件までを削除の古い順に匿名化し、残りは次の呼び出しで匿名化する', async () => {
    const total = LIMIT + 1;
    const newestIndex = total;
    await insertComments(
      Array.from({ length: total }, (_, offset) => ({
        index: offset + 1,
        product: PRODUCT,
        launch: LAUNCH,
        author: COMMENTER,
        columns: {
          deletedAt: new Date(businessTime('2026-11-01').getTime() + offset),
        },
      })),
    );

    const first = await store.anonymizeDeletedBefore({
      threshold: THRESHOLD,
      at: RUN_AT,
      limit: LIMIT,
    });

    expect(first).toBe(LIMIT);
    expect(await readComment(newestIndex)).toMatchObject({
      anonymizedAt: null,
    });
    expect(await store.countOverdue(THRESHOLD)).toBe(1);

    const second = await store.anonymizeDeletedBefore({
      threshold: THRESHOLD,
      at: RUN_AT,
      limit: LIMIT,
    });
    const third = await store.anonymizeDeletedBefore({
      threshold: THRESHOLD,
      at: RUN_AT,
      limit: LIMIT,
    });

    expect(second).toBe(1);
    expect(third).toBe(0);
    expect(await store.countOverdue(THRESHOLD)).toBe(0);
    expect(await countComments()).toBe(total);
  });
});

describe('D1EngagementErasureStore.countOverdue', () => {
  test('期限の閾値より前に削除され未匿名化のコメントだけを数え、閾値ちょうど・匿名化済み・非公開化だけ・未削除は数えない', async () => {
    await insertComment({
      index: 1,
      product: PRODUCT,
      launch: LAUNCH,
      author: COMMENTER,
      columns: { deletedAt: businessTime('2026-11-13', 23, 59) },
    });
    await insertComment({
      index: 2,
      product: PRODUCT,
      launch: LAUNCH,
      author: COMMENTER,
      columns: { deletedAt: businessTime('2026-11-01') },
    });
    await insertComment({
      index: 3,
      product: PRODUCT,
      launch: LAUNCH,
      author: COMMENTER,
      columns: { deletedAt: OVERDUE_THRESHOLD },
    });
    await insertComment({
      index: 4,
      product: PRODUCT,
      launch: LAUNCH,
      author: null,
      columns: {
        body: '',
        deletedAt: businessTime('2026-11-01'),
        anonymizedAt: businessTime('2026-11-14', 4, 21),
      },
    });
    await insertComment({
      index: 5,
      product: PRODUCT,
      launch: LAUNCH,
      author: COMMENTER,
      columns: { hiddenAt: businessTime('2026-11-01') },
    });
    await insertComment({
      index: 6,
      product: PRODUCT,
      launch: LAUNCH,
      author: COMMENTER,
    });

    expect(await store.countOverdue(OVERDUE_THRESHOLD)).toBe(2);
  });

  test('コメントが無ければ0を返す', async () => {
    expect(await store.countOverdue(OVERDUE_THRESHOLD)).toBe(0);
  });
});
