import { beforeEach, describe, expect, test } from 'vitest';

import type { NewPurchase, PurchaseRecord } from '../../core/payments/ports.ts';
import { D1PurchaseStore } from './d1-purchase-store.ts';
import {
  after,
  clearPaymentTables,
  db,
  insertUser,
  newPurchase,
  purchaseIdOf,
  readPurchaseRow,
  T0,
  tokenOf,
  userIdOf,
} from './testing/payment-store-fixtures.ts';

const MINUTE = 60_000;

const store = new D1PurchaseStore(db);

async function createPurchases(
  ...purchases: readonly NewPurchase[]
): Promise<void> {
  const [first, ...rest] = purchases.map((purchase) => store.create(purchase));
  if (first !== undefined) {
    await db.batch([first, ...rest]);
  }
}

async function advanceTo(
  index: number,
  to: PurchaseRecord['status'],
  patch: Parameters<D1PurchaseStore['advance']>[0]['patch'] = {},
): Promise<void> {
  await db.batch([
    store.advance({
      purchaseId: purchaseIdOf(index),
      to,
      from: ['open', 'processing', 'superseded'],
      nextToken: tokenOf(index + 1000),
      patch,
    }),
  ]);
}

function idsOf(records: readonly PurchaseRecord[]): string[] {
  return records.map(({ id }) => id);
}

beforeEach(async () => {
  await clearPaymentTables();
  await insertUser(1);
  await insertUser(2);
});

describe('D1PurchaseStoreの作成と検索', () => {
  test('作成した購入を購入IDで、表示事項と初期の状態とともに返す', async () => {
    const purchase = newPurchase(1, {
      targetId: 'target-1',
      relatedId: 'related-1',
      exclusivityKey: 'week_tournament_entry:target-1',
      deadlineAt: after(10 * MINUTE),
      acceptUntil: after(5 * MINUTE),
      fulfillableUntil: after(20 * MINUTE),
      summary: {
        itemName: '週ごとのトーナメントへの参加',
        quantityLabel: '1件',
        serviceTiming: '決済の直後',
        additionalNotes: ['自動更新はありません'],
      },
    });
    await createPurchases(purchase);

    expect(await store.findById(purchase.id)).toEqual({
      ...purchase,
      status: 'open',
      rejectionReason: null,
      stripeCheckoutSessionId: null,
      stripePaymentIntentId: null,
      stripeInvoiceId: null,
      stripeSubscriptionId: null,
      consentedAt: null,
      consentVersion: null,
      paidAt: null,
      reflectedAt: null,
      confirmationEmailStatus: 'none',
      lastEventAt: null,
      createdAt: expect.any(Date) as unknown,
    });
  });

  test('無い購入はundefinedを返す', async () => {
    expect(await store.findById(purchaseIdOf(1))).toBeUndefined();
    expect(await store.findBySessionId('cs_test_none')).toBeUndefined();
    expect(await store.findByPaymentIntentId('pi_none')).toBeUndefined();
  });

  test('決済セッションのIDと有効期限を保存し、セッションのIDで引ける', async () => {
    await createPurchases(newPurchase(1), newPurchase(2));

    await store.attachSession({
      purchaseId: purchaseIdOf(1),
      sessionId: 'cs_test_1',
      expiresAt: after(30 * MINUTE),
    });

    expect(await store.findBySessionId('cs_test_1')).toMatchObject({
      id: purchaseIdOf(1),
      stripeCheckoutSessionId: 'cs_test_1',
      expiresAt: after(30 * MINUTE),
    });
    expect(await store.findById(purchaseIdOf(2))).toMatchObject({
      stripeCheckoutSessionId: null,
    });
  });

  test('前進の文で保存したPaymentIntentのIDで引ける', async () => {
    await createPurchases(newPurchase(1), newPurchase(2));
    await advanceTo(1, 'processing', { stripePaymentIntentId: 'pi_1' });

    expect(await store.findByPaymentIntentId('pi_1')).toMatchObject({
      id: purchaseIdOf(1),
      status: 'processing',
    });
  });

  test('二重決済の判定の鍵が同じ権利の付与済みの購入だけを引く', async () => {
    const key = 'launch:1:week';
    await createPurchases(
      newPurchase(1, { exclusivityKey: key }),
      newPurchase(2, { exclusivityKey: key }),
      newPurchase(3, { exclusivityKey: 'launch:2:week' }),
    );
    await advanceTo(2, 'rejected', { rejectionReason: 'duplicate' });
    await advanceTo(3, 'fulfilled');

    expect(await store.findFulfilledByExclusivityKey(key)).toBeUndefined();

    await advanceTo(1, 'fulfilled');

    expect(await store.findFulfilledByExclusivityKey(key)).toMatchObject({
      id: purchaseIdOf(1),
      status: 'fulfilled',
    });
  });

  test('作成の文は利用者が無ければ外部キーの違反で失敗する', async () => {
    await expect(
      createPurchases(newPurchase(1, { userId: userIdOf(9) })),
    ).rejects.toThrow();
  });
});

describe('D1PurchaseStoreの未完了の購入の検索', () => {
  test('本人の未完了・処理中の購入を作成順に返し、他の状態と他人の購入を含めない', async () => {
    await createPurchases(
      newPurchase(1),
      newPurchase(2),
      newPurchase(3),
      newPurchase(4),
      newPurchase(5, { userId: userIdOf(2) }),
    );
    await advanceTo(2, 'processing');
    await advanceTo(3, 'fulfilled');
    await advanceTo(4, 'expired');

    expect(idsOf(await store.findOpenByUser(userIdOf(1)))).toEqual([
      purchaseIdOf(1),
      purchaseIdOf(2),
    ]);
  });

  test('同じ利用者・購入種別・対象の未完了の購入だけを返す', async () => {
    await createPurchases(
      newPurchase(1, { kind: 'sponsorship', targetId: 't1' }),
      newPurchase(2, { kind: 'sponsorship', targetId: 't2' }),
      newPurchase(3, { kind: 'ultras', targetId: 't1' }),
      newPurchase(4, { kind: 'sponsorship', targetId: 't1' }),
      newPurchase(5, {
        kind: 'sponsorship',
        targetId: 't1',
        userId: userIdOf(2),
      }),
      newPurchase(6, { kind: 'sponsorship', targetId: 't1' }),
    );
    await advanceTo(4, 'processing');

    expect(
      idsOf(
        await store.findOpenByTarget({
          userId: userIdOf(1),
          kind: 'sponsorship',
          targetId: 't1',
        }),
      ),
    ).toEqual([purchaseIdOf(1), purchaseIdOf(6)]);
  });

  test('対象の無い購入種別はtargetIdがnullの購入を返す', async () => {
    await createPurchases(newPurchase(1), newPurchase(2, { targetId: 'x' }));

    expect(
      idsOf(
        await store.findOpenByTarget({
          userId: userIdOf(1),
          kind: 'payments_smoke',
          targetId: null,
        }),
      ),
    ).toEqual([purchaseIdOf(1)]);
  });
});

describe('D1PurchaseStoreの突合と日次の確認の対象', () => {
  async function prepareWithSessions(
    purchases: readonly NewPurchase[],
  ): Promise<void> {
    await createPurchases(...purchases);
    for (const { id, expiresAt } of purchases) {
      await store.attachSession({
        purchaseId: id,
        sessionId: `cs_${id}`,
        expiresAt,
      });
    }
  }

  test('決済期限が範囲内(両端を含む)の未完了・処理中・置き換え済みを決済期限の順に上限まで返す', async () => {
    await prepareWithSessions([
      newPurchase(1, { deadlineAt: after(30) }),
      newPurchase(2, { deadlineAt: after(10) }),
      newPurchase(3, { deadlineAt: after(20) }),
      newPurchase(4, { deadlineAt: after(20) }),
      newPurchase(5, { deadlineAt: after(9) }),
      newPurchase(6, { deadlineAt: after(31) }),
      newPurchase(7, { deadlineAt: null }),
      newPurchase(8, { deadlineAt: after(15) }),
      newPurchase(9, { deadlineAt: after(16) }),
    ]);
    await advanceTo(3, 'processing');
    await advanceTo(4, 'superseded');
    await advanceTo(8, 'fulfilled');
    await advanceTo(9, 'expired');

    const query = { deadlineFrom: after(10), deadlineTo: after(30) };

    expect(
      idsOf(await store.findReconcilable({ ...query, limit: 10 })),
    ).toEqual([
      purchaseIdOf(2),
      purchaseIdOf(3),
      purchaseIdOf(4),
      purchaseIdOf(1),
    ]);
    expect(idsOf(await store.findReconcilable({ ...query, limit: 2 }))).toEqual(
      [purchaseIdOf(2), purchaseIdOf(3)],
    );
  });

  test('決済セッションのIDが無い購入は取得できないため突合の対象にしない', async () => {
    await createPurchases(newPurchase(1, { deadlineAt: after(10) }));

    expect(
      await store.findReconcilable({
        deadlineFrom: T0,
        deadlineTo: after(20),
        limit: 10,
      }),
    ).toEqual([]);
    expect(
      await store.findStaleOpen({ expiredBefore: after(1e9), limit: 10 }),
    ).toEqual([]);
  });

  test('有効期限が指定の日時より前の未完了・処理中・置き換え済みを有効期限の順に上限まで返す', async () => {
    await prepareWithSessions([
      newPurchase(1, { expiresAt: after(20) }),
      newPurchase(2, { expiresAt: after(10) }),
      newPurchase(3, { expiresAt: after(15) }),
      newPurchase(4, { expiresAt: after(30) }),
      newPurchase(5, { expiresAt: after(5) }),
      newPurchase(6, { expiresAt: after(6) }),
    ]);
    await advanceTo(3, 'superseded');
    await advanceTo(5, 'rejected', { rejectionReason: 'late' });
    await advanceTo(6, 'processing');

    expect(
      idsOf(await store.findStaleOpen({ expiredBefore: after(30), limit: 10 })),
    ).toEqual([
      purchaseIdOf(6),
      purchaseIdOf(2),
      purchaseIdOf(3),
      purchaseIdOf(1),
    ]);
    expect(
      idsOf(await store.findStaleOpen({ expiredBefore: after(30), limit: 1 })),
    ).toEqual([purchaseIdOf(6)]);
  });
});

describe('D1PurchaseStoreの同意の記録', () => {
  test('本人の未完了の購入に同意の日時と版を記録し、再記録は最新の値で上書きする', async () => {
    await createPurchases(newPurchase(1));
    const input = {
      purchaseId: purchaseIdOf(1),
      userId: userIdOf(1),
    };

    expect(
      await store.recordConsent({
        ...input,
        consentedAt: after(1),
        version: 'v1',
      }),
    ).toBe('recorded');
    expect(
      await store.recordConsent({
        ...input,
        consentedAt: after(2),
        version: 'v2',
      }),
    ).toBe('recorded');

    expect(await store.findById(purchaseIdOf(1))).toMatchObject({
      consentedAt: after(2),
      consentVersion: 'v2',
    });
  });

  test('未完了でない購入・他人の購入・無い購入には記録しない', async () => {
    await createPurchases(newPurchase(1), newPurchase(2));
    await advanceTo(2, 'processing');
    const consent = { consentedAt: after(1), version: 'v1' };

    expect(
      await store.recordConsent({
        ...consent,
        purchaseId: purchaseIdOf(2),
        userId: userIdOf(1),
      }),
    ).toBe('not_open');
    expect(
      await store.recordConsent({
        ...consent,
        purchaseId: purchaseIdOf(1),
        userId: userIdOf(2),
      }),
    ).toBe('not_open');
    expect(
      await store.recordConsent({
        ...consent,
        purchaseId: purchaseIdOf(9),
        userId: userIdOf(1),
      }),
    ).toBe('not_open');
    expect(await store.findById(purchaseIdOf(1))).toMatchObject({
      consentedAt: null,
      consentVersion: null,
    });
  });
});

describe('D1PurchaseStoreの状態の前進', () => {
  test('前進の文は前進の元の状態のときだけ状態・state_token・保存する値を書き、省略した値を変えない', async () => {
    await createPurchases(newPurchase(1));
    await advanceTo(1, 'processing', {
      stripePaymentIntentId: 'pi_1',
      amountTotal: 120,
    });

    await db.batch([
      store.advance({
        purchaseId: purchaseIdOf(1),
        to: 'fulfilled',
        from: ['open', 'processing'],
        nextToken: tokenOf(2001),
        patch: {
          stripeInvoiceId: 'in_1',
          stripeSubscriptionId: 'sub_1',
          paidAt: after(5),
          reflectedAt: after(6),
          confirmationEmailStatus: 'pending',
          lastEventAt: after(4),
        },
      }),
    ]);

    expect(await store.findById(purchaseIdOf(1))).toMatchObject({
      status: 'fulfilled',
      stateToken: tokenOf(2001),
      stripePaymentIntentId: 'pi_1',
      stripeInvoiceId: 'in_1',
      stripeSubscriptionId: 'sub_1',
      amountTotal: 120,
      paidAt: after(5),
      reflectedAt: after(6),
      confirmationEmailStatus: 'pending',
      lastEventAt: after(4),
    });
  });

  test('前進の元に無い状態の購入は前進の文で変わらない', async () => {
    await createPurchases(newPurchase(1));
    await advanceTo(1, 'expired');

    await db.batch([
      store.advance({
        purchaseId: purchaseIdOf(1),
        to: 'rejected',
        from: ['open', 'processing'],
        nextToken: tokenOf(2002),
        patch: { rejectionReason: 'late' },
      }),
    ]);

    expect(await store.findById(purchaseIdOf(1))).toMatchObject({
      status: 'expired',
      stateToken: tokenOf(1001),
      rejectionReason: null,
    });
  });

  test('他の文を伴わない前進は進めたかを返し、前進の元に無い状態では進めない', async () => {
    await createPurchases(newPurchase(1));
    const input = {
      purchaseId: purchaseIdOf(1),
      to: 'expired',
      from: ['open', 'processing', 'superseded'],
      patch: {},
    } as const;

    expect(
      await store.advanceAlone({ ...input, nextToken: tokenOf(3001) }),
    ).toBe(true);
    expect(
      await store.advanceAlone({ ...input, nextToken: tokenOf(3002) }),
    ).toBe(false);
    expect(
      await store.advanceAlone({
        ...input,
        purchaseId: purchaseIdOf(9),
        nextToken: tokenOf(3003),
      }),
    ).toBe(false);
    expect(await store.findById(purchaseIdOf(1))).toMatchObject({
      status: 'expired',
      stateToken: tokenOf(3001),
    });
  });
});

describe('D1PurchaseStoreの購入確認メールの依頼の状態', () => {
  test('依頼待ちのまま反映から指定の日時より前の購入を反映の順に上限まで返す', async () => {
    await createPurchases(
      newPurchase(1),
      newPurchase(2),
      newPurchase(3),
      newPurchase(4),
      newPurchase(5),
    );
    await advanceTo(1, 'fulfilled', {
      confirmationEmailStatus: 'pending',
      reflectedAt: after(3 * MINUTE),
    });
    await advanceTo(2, 'fulfilled', {
      confirmationEmailStatus: 'pending',
      reflectedAt: after(1 * MINUTE),
    });
    await advanceTo(3, 'fulfilled', {
      confirmationEmailStatus: 'pending',
      reflectedAt: after(10 * MINUTE),
    });
    await advanceTo(4, 'fulfilled', {
      confirmationEmailStatus: 'requested',
      reflectedAt: after(1 * MINUTE),
    });
    await advanceTo(5, 'rejected', {
      rejectionReason: 'late',
      confirmationEmailStatus: 'pending',
      reflectedAt: after(2 * MINUTE),
    });

    const reflectedBefore = after(10 * MINUTE);

    expect(
      idsOf(
        await store.findPendingConfirmations({ reflectedBefore, limit: 10 }),
      ),
    ).toEqual([purchaseIdOf(2), purchaseIdOf(5), purchaseIdOf(1)]);
    expect(
      idsOf(
        await store.findPendingConfirmations({ reflectedBefore, limit: 1 }),
      ),
    ).toEqual([purchaseIdOf(2)]);
  });

  test('依頼待ちのときだけ依頼済み・対象外へ進め、進めたかを返す', async () => {
    await createPurchases(newPurchase(1), newPurchase(2), newPurchase(3));
    await advanceTo(1, 'fulfilled', { confirmationEmailStatus: 'pending' });
    await advanceTo(2, 'fulfilled', { confirmationEmailStatus: 'pending' });

    expect(
      await store.markConfirmationEmail({
        purchaseId: purchaseIdOf(1),
        to: 'requested',
      }),
    ).toBe(true);
    expect(
      await store.markConfirmationEmail({
        purchaseId: purchaseIdOf(1),
        to: 'skipped',
      }),
    ).toBe(false);
    expect(
      await store.markConfirmationEmail({
        purchaseId: purchaseIdOf(2),
        to: 'skipped',
      }),
    ).toBe(true);
    expect(
      await store.markConfirmationEmail({
        purchaseId: purchaseIdOf(3),
        to: 'requested',
      }),
    ).toBe(false);

    expect(
      (await readPurchaseRow(purchaseIdOf(1)))?.confirmationEmailStatus,
    ).toBe('requested');
    expect(
      (await readPurchaseRow(purchaseIdOf(2)))?.confirmationEmailStatus,
    ).toBe('skipped');
    expect(
      (await readPurchaseRow(purchaseIdOf(3)))?.confirmationEmailStatus,
    ).toBe('none');
  });
});

describe('D1PurchaseStoreの利用者の行の削除', () => {
  test('削除の文は利用者の購入だけを消す', async () => {
    await createPurchases(
      newPurchase(1),
      newPurchase(2),
      newPurchase(3, { userId: userIdOf(2) }),
    );

    await db.batch([store.deleteByUser(userIdOf(1))]);

    expect(await store.findById(purchaseIdOf(1))).toBeUndefined();
    expect(await store.findById(purchaseIdOf(2))).toBeUndefined();
    expect(await store.findById(purchaseIdOf(3))).toBeDefined();
  });
});
