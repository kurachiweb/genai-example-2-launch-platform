import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  insertLaunch,
  insertProduct,
  insertUser,
  T0,
} from '../product/testing/product-fixtures.ts';
import {
  installRecordingSentry,
  recordLogs,
  resetObservability,
} from '../tournament/testing/observability-fixtures.ts';
import {
  acceptAll,
  createFollowUp,
  createRefunds,
  createSender,
  followUpEntryOf,
  NOTICE_PENDING,
  NOW,
  OVER_CAPACITY,
  pendingEntryIds,
  purchaseIdOf,
  readEntryRow,
  readEntryRows,
  SUSPENDED,
} from './testing/year-entry-follow-up-fixtures.ts';
import {
  clearYearTournamentTables,
  insertYearEntries,
  YEAR,
  yearEntryIdOf,
} from './testing/year-tournament-fixtures.ts';

// 利用者1のプロダクト1〜9を、同じ番号のローンチ付きで作る
beforeEach(async () => {
  recordLogs();
  installRecordingSentry();
  await clearYearTournamentTables();
  await insertUser(1);
  for (const index of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    await insertProduct(index, 1);
    await insertLaunch(index, index);
  }
});

afterEach(resetObservability);

// 他の年と喪失の枠が先に読まれても、その年の枠を読み進めることを確かめる
const BEFORE_T0 = new Date(T0.getTime() - 1);

function failingFor(...indexes: number[]) {
  const failing = new Set(indexes.map(purchaseIdOf));
  return createRefunds((input) =>
    failing.has(input.purchaseId)
      ? Promise.reject(new Error(`Stripeの一時的な失敗: ${input.purchaseId}`))
      : acceptAll(input),
  );
}

describe('YearEntryRefundFollowUp.process(対象と失敗)', () => {
  test('返金待ち・知らせ待ちでない枠と存在しない枠は何もしない', async () => {
    await insertYearEntries([
      followUpEntryOf(1, { refundStatus: 'not_needed' }),
      followUpEntryOf(2, { refundStatus: 'already_refunded' }),
      followUpEntryOf(3, { refundStatus: 'rejected' }),
      followUpEntryOf(4, {
        refundStatus: 'requested',
        refundNoticeStatus: 'sent',
      }),
      followUpEntryOf(5, {
        refundStatus: 'requested',
        refundNoticeStatus: 'skipped',
      }),
    ]);
    const before = await readEntryRows();
    const { refunds, requests } = createRefunds();
    const { sender, sent } = createSender();

    await createFollowUp(refunds, sender).process(
      [1, 2, 3, 4, 5, 6].map(yearEntryIdOf),
      NOW,
    );

    expect(requests).toEqual([]);
    expect(sent).toEqual([]);
    await expect(readEntryRows()).resolves.toEqual(before);
  });

  test('1件の失敗で残りの枠を止めず、最後にその失敗をそのまま投げる', async () => {
    await insertYearEntries([followUpEntryOf(1), followUpEntryOf(2)]);
    const { refunds, requests } = failingFor(1);
    const { sender, sent } = createSender();

    const failure = createFollowUp(refunds, sender).process(
      [yearEntryIdOf(1), yearEntryIdOf(2)],
      NOW,
    );

    await expect(failure).rejects.toThrow(
      `Stripeの一時的な失敗: ${purchaseIdOf(1)}`,
    );
    await expect(failure).rejects.not.toBeInstanceOf(AggregateError);
    expect(requests).toHaveLength(2);
    expect(sent).toHaveLength(1);
    await expect(readEntryRow(1)).resolves.toMatchObject({
      refundStatus: 'pending',
    });
    await expect(readEntryRow(2)).resolves.toMatchObject({
      refundStatus: 'requested',
      refundNoticeStatus: 'sent',
    });
  });

  test('複数の失敗はAggregateErrorにまとめて投げる', async () => {
    await insertYearEntries([
      followUpEntryOf(1),
      followUpEntryOf(2),
      followUpEntryOf(3),
    ]);
    const { refunds, requests } = failingFor(1, 3);
    const { sender, sent } = createSender();

    const failure = createFollowUp(refunds, sender).process(
      [1, 2, 3].map(yearEntryIdOf),
      NOW,
    );

    await expect(failure).rejects.toBeInstanceOf(AggregateError);
    await expect(failure).rejects.toMatchObject({
      errors: [
        expect.objectContaining({
          message: `Stripeの一時的な失敗: ${purchaseIdOf(1)}`,
        }),
        expect.objectContaining({
          message: `Stripeの一時的な失敗: ${purchaseIdOf(3)}`,
        }),
      ],
    });
    expect(requests).toHaveLength(3);
    expect(sent).toHaveLength(1);
    await expect(pendingEntryIds()).resolves.toEqual([
      yearEntryIdOf(1),
      yearEntryIdOf(3),
    ]);
  });
});

describe('YearEntryRefundFollowUp.processYear', () => {
  test('その年の組み合わせ決定で終えた返金待ち・知らせ待ちの枠だけを、読み取りの上限を超えても全て処理する', async () => {
    const indexes = [1, 2, 3, 4, 5, 6, 7];
    await insertYearEntries([
      ...indexes.map((index) =>
        followUpEntryOf(index, {
          ...(index % 2 === 0 ? SUSPENDED : OVER_CAPACITY),
          ...(index % 3 === 0 ? NOTICE_PENDING : {}),
        }),
      ),
      followUpEntryOf(8, {
        ...SUSPENDED,
        classifiedYear: YEAR + 1,
        updatedAt: BEFORE_T0,
      }),
      followUpEntryOf(9, { updatedAt: BEFORE_T0 }),
    ]);
    const { refunds, requests } = createRefunds();
    const { sender, sent } = createSender();

    await createFollowUp(refunds, sender).processYear(YEAR, NOW);

    expect(requests.map(({ purchaseId }) => purchaseId)).toEqual(
      [1, 2, 4, 5, 7].map(purchaseIdOf),
    );
    expect(sent).toHaveLength(7);
    await expect(pendingEntryIds()).resolves.toEqual([
      yearEntryIdOf(8),
      yearEntryIdOf(9),
    ]);
  });

  test('依頼に失敗して返金待ちに残る枠で繰り返さず、残りの枠を処理してから例外にする', async () => {
    await insertYearEntries([
      followUpEntryOf(1, SUSPENDED),
      followUpEntryOf(2, SUSPENDED),
    ]);
    const { refunds, requests } = failingFor(1);
    const { sender } = createSender();

    await expect(
      createFollowUp(refunds, sender).processYear(YEAR, NOW),
    ).rejects.toThrow(`Stripeの一時的な失敗: ${purchaseIdOf(1)}`);

    expect(requests.map(({ purchaseId }) => purchaseId)).toEqual([
      purchaseIdOf(1),
      purchaseIdOf(2),
    ]);
    await expect(pendingEntryIds()).resolves.toEqual([yearEntryIdOf(1)]);
  });

  test('拒否で依頼を終えた枠は処理の対象から外れ、もう一度呼んでも依頼しない', async () => {
    await insertYearEntries([followUpEntryOf(1, SUSPENDED)]);
    const { refunds, requests } = createRefunds(() =>
      Promise.resolve({ kind: 'rejected', code: 'amount_exceeds_refundable' }),
    );
    const { sender, sent } = createSender();
    const followUp = createFollowUp(refunds, sender);

    await followUp.processYear(YEAR, NOW);
    await followUp.processYear(YEAR, NOW);
    await followUp.process([yearEntryIdOf(1)], NOW);

    expect(requests).toHaveLength(1);
    expect(sent).toEqual([]);
  });
});
