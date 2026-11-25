import type { Event } from '@sentry/cloudflare';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { users } from '../../../db/schema/identity/users.ts';
import type { LogObject } from '../../core/logging/log-record.ts';
import { emailOf } from '../identity/testing/identity-store-fixtures.ts';
import {
  db,
  insertLaunch,
  insertProduct,
  insertUser,
  launchIdOf,
  productIdOf,
  T0,
  userIdOf,
} from '../product/testing/product-fixtures.ts';
import {
  installRecordingSentry,
  recordLogs,
  resetObservability,
} from '../tournament/testing/observability-fixtures.ts';
import {
  createFollowUp,
  createRefunds,
  createSender,
  FOLLOW_UP_CATEGORY,
  FORFEITED,
  followUpEntryOf,
  NOTICE_PENDING,
  NOW,
  OVER_CAPACITY,
  pendingEntryIds,
  purchaseIdOf,
  readEntryRow,
  type RefundAnswer,
  refundEmailOf,
  SUSPENDED,
  WITHDRAWN,
} from './testing/year-entry-follow-up-fixtures.ts';
import {
  championWeekTournamentIdOf,
  clearYearTournamentTables,
  insertYearEntries,
  yearEntryIdOf,
} from './testing/year-tournament-fixtures.ts';

let logs: LogObject[] = [];
let events: Event[] = [];

function followUpLogs(): LogObject[] {
  return logs.filter(({ category }) => category === FOLLOW_UP_CATEGORY);
}

function incidentEvents(): Event[] {
  return events.filter(
    (event) => event.tags?.tournament_year_incident !== undefined,
  );
}

// 購入と枠以外の識別(ローンチ・プロダクト・投稿者・Week優勝)と、名称・メールアドレスが出ないこと
function expectOnlyPurchaseAndEntryIds(): void {
  const recorded = JSON.stringify([followUpLogs(), incidentEvents()]);
  for (const value of [
    emailOf(1),
    '利用者1',
    launchIdOf(1),
    productIdOf(1),
    userIdOf(1),
    championWeekTournamentIdOf(1),
  ]) {
    expect(recorded).not.toContain(value);
  }
}

// 利用者1のプロダクト1〜8と利用者2のプロダクト9を、同じ番号のローンチ付きで作る
beforeEach(async () => {
  logs = recordLogs();
  events = installRecordingSentry();
  await clearYearTournamentTables();
  await insertUser(1);
  await insertUser(2);
  for (const index of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    await insertProduct(index, index === 9 ? 2 : 1);
    await insertLaunch(index, index);
  }
});

afterEach(resetObservability);

describe('YearEntryRefundFollowUp.process(返金の依頼)', () => {
  test.each([
    { label: '削除による喪失', columns: FORFEITED, reason: 'entitlement_lost' },
    { label: '退会による喪失', columns: WITHDRAWN, reason: 'entitlement_lost' },
    {
      label: '非公開化・停止による除外',
      columns: SUSPENDED,
      reason: 'entitlement_suspended',
    },
    {
      label: '上限による除外',
      columns: OVER_CAPACITY,
      reason: 'capacity_exceeded',
    },
  ] as const)(
    '$labelの返金待ちの枠は、購入の全額の返金を理由と依頼キー付きで依頼し、依頼済みにして返金の知らせを送る',
    async ({ columns, reason }) => {
      await insertYearEntries([followUpEntryOf(1, columns)]);
      const { refunds, requests } = createRefunds();
      const { sender, sent } = createSender();

      await createFollowUp(refunds, sender).process([yearEntryIdOf(1)], NOW);

      expect(requests).toEqual([
        {
          purchaseId: purchaseIdOf(1),
          amount: null,
          reason,
          requestKey: `tournament-year:${purchaseIdOf(1)}:${reason}`,
        },
      ]);
      expect(sent).toEqual([refundEmailOf(reason)]);
      await expect(readEntryRow(1)).resolves.toMatchObject({
        refundStatus: 'requested',
        refundRequestedAt: NOW,
        refundNoticeStatus: 'sent',
        updatedAt: NOW,
      });
      await expect(pendingEntryIds()).resolves.toEqual([]);
      expect(incidentEvents()).toEqual([]);
      expectOnlyPurchaseAndEntryIds();
    },
  );

  test('同じ依頼キーの既存の依頼(重複)も受け付けとして依頼済みにし、返金の知らせを送る', async () => {
    await insertYearEntries([followUpEntryOf(1)]);
    const { refunds } = createRefunds(() =>
      Promise.resolve({
        kind: 'accepted',
        refundRequestId: '01JD0REFVND000000000000001',
        duplicate: true,
      }),
    );
    const { sender, sent } = createSender();

    await createFollowUp(refunds, sender).process([yearEntryIdOf(1)], NOW);

    expect(sent).toEqual([refundEmailOf('entitlement_lost')]);
    await expect(readEntryRow(1)).resolves.toMatchObject({
      refundStatus: 'requested',
      refundNoticeStatus: 'sent',
    });
  });

  test.each(['not_paid', 'purchase_not_found'] as const)(
    '拒否(%s)は返金不要にし、知らせを送らず、購入の識別だけのinfoログを残してcaptureEventしない',
    async (code) => {
      await insertYearEntries([followUpEntryOf(1)]);
      const { refunds } = createRefunds(() =>
        Promise.resolve({ kind: 'rejected', code }),
      );
      const { sender, sent } = createSender();

      await createFollowUp(refunds, sender).process([yearEntryIdOf(1)], NOW);

      expect(sent).toEqual([]);
      await expect(readEntryRow(1)).resolves.toMatchObject({
        refundStatus: 'not_needed',
        refundRequestedAt: null,
        refundNoticeStatus: 'none',
        updatedAt: NOW,
      });
      await expect(pendingEntryIds()).resolves.toEqual([]);
      const [log, ...otherLogs] = followUpLogs();
      expect(otherLogs).toEqual([]);
      expect(log?.level).toBe('info');
      expect(Object.keys(log ?? {}).sort()).toEqual([
        'category',
        'code',
        'entryId',
        'level',
        'message',
        'purchaseId',
        'time',
      ]);
      expect(log).toMatchObject({
        entryId: yearEntryIdOf(1),
        purchaseId: purchaseIdOf(1),
        code,
      });
      expect(incidentEvents()).toEqual([]);
      expectOnlyPurchaseAndEntryIds();
    },
  );

  test('返金できる残額が無い拒否は返金済みで依頼を終え、知らせを送らずrefund-already-refundedをcaptureEventする', async () => {
    await insertYearEntries([followUpEntryOf(1)]);
    const { refunds } = createRefunds(() =>
      Promise.resolve({ kind: 'rejected', code: 'amount_exceeds_refundable' }),
    );
    const { sender, sent } = createSender();

    await createFollowUp(refunds, sender).process([yearEntryIdOf(1)], NOW);

    expect(sent).toEqual([]);
    await expect(readEntryRow(1)).resolves.toMatchObject({
      refundStatus: 'already_refunded',
      refundNoticeStatus: 'none',
    });
    await expect(pendingEntryIds()).resolves.toEqual([]);
    const [log, ...otherLogs] = followUpLogs();
    expect(otherLogs).toEqual([]);
    expect(log?.level).toBe('warning');
    expect(Object.keys(log ?? {}).sort()).toEqual([
      'category',
      'code',
      'entryId',
      'level',
      'message',
      'purchaseId',
      'time',
    ]);
    expect(log).toMatchObject({
      entryId: yearEntryIdOf(1),
      purchaseId: purchaseIdOf(1),
      code: 'amount_exceeds_refundable',
    });
    const [event, ...otherEvents] = incidentEvents();
    expect(otherEvents).toEqual([]);
    expect(event?.level).toBe('warning');
    expect(event?.logentry?.message).toBe(log?.message);
    expect(event?.message).toBeUndefined();
    expect(event?.fingerprint).toEqual([
      'tournament-year',
      'refund-already-refunded',
    ]);
    expect(event?.tags).toStrictEqual({
      tournament_year_incident: 'refund-already-refunded',
      entry_id: yearEntryIdOf(1),
      purchase_id: purchaseIdOf(1),
    });
    expectOnlyPurchaseAndEntryIds();
  });

  test.each([
    {
      label: '金額の形式の誤り',
      answer: () =>
        Promise.resolve({ kind: 'rejected', code: 'invalid_amount' } as const),
      code: 'invalid_amount',
    },
    {
      label: '依頼キーの形式の誤り',
      answer: () =>
        Promise.resolve({
          kind: 'rejected',
          code: 'invalid_request_key',
        } as const),
      code: 'invalid_request_key',
    },
    {
      label: '理由の形式違反の例外',
      answer: () => Promise.reject(new RangeError('返金の理由の形式違反')),
      code: 'invalid_reason',
    },
  ] satisfies readonly {
    label: string;
    answer: RefundAnswer;
    code: string;
  }[])(
    '$labelは拒否で依頼を終え、知らせを送らずrefund-rejectedをcaptureEventする',
    async ({ answer, code }) => {
      await insertYearEntries([followUpEntryOf(1)]);
      const { refunds } = createRefunds(answer);
      const { sender, sent } = createSender();

      await createFollowUp(refunds, sender).process([yearEntryIdOf(1)], NOW);

      expect(sent).toEqual([]);
      await expect(readEntryRow(1)).resolves.toMatchObject({
        refundStatus: 'rejected',
        refundNoticeStatus: 'none',
      });
      await expect(pendingEntryIds()).resolves.toEqual([]);
      const [log, ...otherLogs] = followUpLogs();
      expect(otherLogs).toEqual([]);
      expect(log?.level).toBe('error');
      expect(log).toMatchObject({
        entryId: yearEntryIdOf(1),
        purchaseId: purchaseIdOf(1),
        code,
      });
      const [event, ...otherEvents] = incidentEvents();
      expect(otherEvents).toEqual([]);
      expect(event?.level).toBe('error');
      expect(event?.logentry?.message).toBe(log?.message);
      expect(event?.fingerprint).toEqual([
        'tournament-year',
        'refund-rejected',
      ]);
      expect(event?.tags).toStrictEqual({
        tournament_year_incident: 'refund-rejected',
        entry_id: yearEntryIdOf(1),
        purchase_id: purchaseIdOf(1),
      });
      expectOnlyPurchaseAndEntryIds();
    },
  );

  test('購入の記録が無い返金待ちの枠は依頼をせずに返金不要で終える', async () => {
    await insertYearEntries([
      followUpEntryOf(1, { entitlementSource: 'ultras', purchaseId: null }),
    ]);
    const { refunds, requests } = createRefunds();
    const { sender, sent } = createSender();

    await createFollowUp(refunds, sender).process([yearEntryIdOf(1)], NOW);

    expect(requests).toEqual([]);
    expect(sent).toEqual([]);
    await expect(readEntryRow(1)).resolves.toMatchObject({
      refundStatus: 'not_needed',
      refundNoticeStatus: 'none',
    });
    expect(followUpLogs()).toEqual([
      expect.objectContaining({ level: 'error', entryId: yearEntryIdOf(1) }),
    ]);
  });

  test('返金の依頼の一時的な失敗は例外にし、枠を返金待ちのまま変えない', async () => {
    await insertYearEntries([followUpEntryOf(1)]);
    const before = await readEntryRow(1);
    const { refunds } = createRefunds(() =>
      Promise.reject(new Error('Stripeの一時的な失敗')),
    );
    const { sender, sent } = createSender();

    await expect(
      createFollowUp(refunds, sender).process([yearEntryIdOf(1)], NOW),
    ).rejects.toThrow('Stripeの一時的な失敗');

    expect(sent).toEqual([]);
    await expect(readEntryRow(1)).resolves.toEqual(before);
    expect(incidentEvents()).toEqual([]);
  });
});

describe('YearEntryRefundFollowUp.process(返金の知らせ)', () => {
  test('知らせ待ちの枠は依頼をせずに返金の知らせだけを送り、送信済みにする', async () => {
    await insertYearEntries([followUpEntryOf(1, NOTICE_PENDING)]);
    const { refunds, requests } = createRefunds();
    const { sender, sent } = createSender();

    await createFollowUp(refunds, sender).process([yearEntryIdOf(1)], NOW);

    expect(requests).toEqual([]);
    expect(sent).toEqual([refundEmailOf('entitlement_lost')]);
    await expect(readEntryRow(1)).resolves.toMatchObject({
      refundStatus: 'requested',
      refundRequestedAt: T0,
      refundNoticeStatus: 'sent',
      updatedAt: NOW,
    });
  });

  test('組み合わせ決定で終えた枠は終えた年、喪失の枠はWeek優勝の日の対象年を、枠のWeek優勝の週と投稿者の宛先で知らせる', async () => {
    await insertYearEntries([
      followUpEntryOf(1, { ...OVER_CAPACITY, classifiedYear: 2028 }),
      followUpEntryOf(
        9,
        {
          weekPeriod: '2027-W22',
          awardedAt: new Date('2027-06-08T07:45:00.000Z'),
          awardedDate: '2027-06-07',
        },
        { owner: 2 },
      ),
    ]);
    const { refunds } = createRefunds();
    const { sender, sent } = createSender();

    await createFollowUp(refunds, sender).process(
      [yearEntryIdOf(1), yearEntryIdOf(9)],
      NOW,
    );

    expect(sent).toEqual([
      refundEmailOf('capacity_exceeded', { year: 2028 }),
      refundEmailOf('entitlement_lost', {
        year: 2028,
        weekStart: '2027-05-31',
        owner: 2,
      }),
    ]);
  });

  test('退会済みの投稿者には送らず省略にする', async () => {
    await db
      .update(users)
      .set({ deletedAt: T0 })
      .where(eq(users.id, userIdOf(1)));
    await insertYearEntries([followUpEntryOf(1, WITHDRAWN)]);
    const { refunds, requests } = createRefunds();
    const { sender, sent } = createSender();

    await createFollowUp(refunds, sender).process([yearEntryIdOf(1)], NOW);

    expect(requests).toHaveLength(1);
    expect(sent).toEqual([]);
    await expect(readEntryRow(1)).resolves.toMatchObject({
      refundStatus: 'requested',
      refundNoticeStatus: 'skipped',
    });
    await expect(pendingEntryIds()).resolves.toEqual([]);
  });

  test('紐付けを解除した枠には送らず省略にする', async () => {
    await insertYearEntries([
      {
        ...followUpEntryOf(1, { ...SUSPENDED, ...NOTICE_PENDING }),
        launch: null,
        product: null,
        owner: null,
      },
    ]);
    const { refunds } = createRefunds();
    const { sender, sent } = createSender();

    await createFollowUp(refunds, sender).process([yearEntryIdOf(1)], NOW);

    expect(sent).toEqual([]);
    await expect(readEntryRow(1)).resolves.toMatchObject({
      refundNoticeStatus: 'skipped',
    });
  });

  test('送信の一時的な失敗は例外にし、知らせ待ちのまま変えない', async () => {
    await insertYearEntries([followUpEntryOf(1, NOTICE_PENDING)]);
    const before = await readEntryRow(1);
    const { refunds } = createRefunds();
    const { sender } = createSender(new Error('Queueの一時的な失敗'));

    await expect(
      createFollowUp(refunds, sender).process([yearEntryIdOf(1)], NOW),
    ).rejects.toThrow('Queueの一時的な失敗');

    await expect(readEntryRow(1)).resolves.toEqual(before);
  });

  test('依頼の後の送信の失敗は依頼済み・知らせ待ちで残し、次の処理で依頼し直さずに知らせだけを送る', async () => {
    await insertYearEntries([followUpEntryOf(1)]);
    const { refunds, requests } = createRefunds();
    const failing = createSender(new Error('Queueの一時的な失敗'));

    await expect(
      createFollowUp(refunds, failing.sender).process([yearEntryIdOf(1)], NOW),
    ).rejects.toThrow('Queueの一時的な失敗');
    await expect(readEntryRow(1)).resolves.toMatchObject({
      refundStatus: 'requested',
      refundNoticeStatus: 'pending',
    });

    const { sender, sent } = createSender();
    await createFollowUp(refunds, sender).process([yearEntryIdOf(1)], NOW);

    expect(requests).toHaveLength(1);
    expect(sent).toEqual([refundEmailOf('entitlement_lost')]);
    await expect(readEntryRow(1)).resolves.toMatchObject({
      refundNoticeStatus: 'sent',
    });
  });
});
