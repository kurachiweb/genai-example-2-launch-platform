import { resetSync } from '@logtape/logtape';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { CHECKOUT_CONSENT_VERSION } from '../../../common-lib/payments/checkout-consent.ts';
import { paymentPurchases } from '../../../db/schema/payments/payment-purchases.ts';
import { paymentRefunds } from '../../../db/schema/payments/payment-refunds.ts';
import {
  PAYMENTS_AUTOMATIC_REFUND_KIND,
  PAYMENTS_PURCHASE_CONFIRMATION_KIND,
} from '../../core/email/kinds/payments.ts';
import type { EmailSender, EmailSendRequest } from '../../core/email/ports.ts';
import type {
  UserContact,
  UserContactDirectory,
} from '../../core/identity/ports.ts';
import type { CheckoutSummaryText } from '../../core/payments/purchase-kind-contract.ts';
import { reflectionRequestKeyOf } from '../../core/payments/refund-rules.ts';
import { emailOf } from '../identity/testing/identity-store-fixtures.ts';
import { D1PurchaseStore } from './d1-purchase-store.ts';
import { D1RefundStore } from './d1-refund-store.ts';
import { EmailPurchaseNotifier } from './purchase-notifier.ts';
import { recordLogs } from './testing/fake-stripe.ts';
import {
  after,
  clearPaymentTables,
  db,
  insertUser,
  newPurchase,
  newRefundRequest,
  purchaseIdOf,
  refundIdOf,
  T0,
  tokenOf,
  userIdOf,
} from './testing/payment-store-fixtures.ts';

const MINUTE = 60_000;
const CLIENT_SITE_ORIGIN = 'https://client.example';
const PAYMENT_HISTORY_URL = 'https://client.example/settings/billing';
const PAID_AT = new Date('2026-11-02T07:40:12.345Z');
const CONSENTED_AT = new Date('2026-11-02T07:39:01.000Z');
const REFUNDED_AT = new Date('2026-11-02T08:15:00.000Z');
const CONSENT_TEXT =
  '購入の確定後すぐに役務の提供が始まることに同意し、提供の開始により、EU・英国の消費者に認められる14日間の撤回権を失うことを了承します。';
const SUMMARY: CheckoutSummaryText = {
  itemName: 'Ultrasプラン',
  quantityLabel: '1か月',
  serviceTiming: '決済の直後から',
  additionalNotes: [
    '毎月自動で更新されます。',
    '毎月の請求額は$5.00 USDです。',
    '設定ページからいつでも解約できます。',
  ],
};

const purchases = new D1PurchaseStore(db);
const refunds = new D1RefundStore(db);

interface RecordingSender {
  readonly sender: EmailSender;
  readonly sent: EmailSendRequest<unknown>[];
}

// 実際の送信要求と同じく、入力が種別の検証規則に合わなければ拒否する
function createRecordingSender(failure?: Error): RecordingSender {
  const sent: EmailSendRequest<unknown>[] = [];
  const sender: EmailSender = {
    send: <TInput>(request: EmailSendRequest<TInput>) => {
      if (failure !== undefined) {
        return Promise.reject(failure);
      }
      request.kind.inputSchema.parse(request.input);
      sent.push(request);
      return Promise.resolve(
        `01JC0EMAIL${String(sent.length).padStart(16, '0')}`,
      );
    },
  };
  return { sender, sent };
}

function contactOf(index: number): UserContact {
  return {
    userId: userIdOf(index),
    email: emailOf(index),
    nickname: `利用者${String(index)}`,
    emailVerified: true,
  };
}

// 退会済み・物理削除済みの利用者は登録しない。停止中の利用者は宛先を返す
function createContactDirectory(
  contacts: readonly UserContact[] = [contactOf(1)],
): UserContactDirectory {
  const byUserId = new Map(
    contacts.map((contact) => [contact.userId, contact]),
  );
  return {
    findContact: (userId) => Promise.resolve(byUserId.get(userId)),
  };
}

function notifierWith(
  sender: EmailSender,
  contacts: UserContactDirectory = createContactDirectory(),
): EmailPurchaseNotifier {
  return new EmailPurchaseNotifier({
    appName: 'api',
    purchases,
    refunds,
    contacts,
    emails: sender,
    clientSiteOrigin: CLIENT_SITE_ORIGIN,
  });
}

interface ConfirmablePurchaseOptions {
  readonly userIndex?: number;
  readonly summary?: CheckoutSummaryText;
  readonly reflectedAt?: Date;
  readonly consentVersion?: string | null;
}

async function insertConfirmablePurchases(
  indexes: readonly number[],
  options: ConfirmablePurchaseOptions = {},
): Promise<void> {
  const [first, ...rest] = indexes.map((index) =>
    purchases.create(
      newPurchase(index, {
        userId: userIdOf(options.userIndex ?? 1),
        kind: 'ultras',
        quantity: 1,
        unitAmount: 500,
        amountTotal: 500,
        summary: options.summary ?? SUMMARY,
      }),
    ),
  );
  if (first === undefined) {
    return;
  }
  await db.batch([first, ...rest]);
  const consent = {
    consentedAt: options.consentVersion === null ? null : CONSENTED_AT,
    consentVersion:
      options.consentVersion === undefined
        ? CHECKOUT_CONSENT_VERSION
        : options.consentVersion,
  };
  const [firstConsent, ...restConsents] = indexes.map((index) =>
    db
      .update(paymentPurchases)
      .set(consent)
      .where(eq(paymentPurchases.id, purchaseIdOf(index))),
  );
  if (firstConsent !== undefined) {
    await db.batch([firstConsent, ...restConsents]);
  }
  const [firstAdvance, ...restAdvances] = indexes.map((index) =>
    purchases.advance({
      purchaseId: purchaseIdOf(index),
      to: 'fulfilled',
      from: ['open'],
      nextToken: tokenOf(index + 1000),
      patch: {
        stripePaymentIntentId: `pi_test_${String(index)}`,
        paidAt: PAID_AT,
        reflectedAt: options.reflectedAt ?? PAID_AT,
        confirmationEmailStatus: 'pending',
      },
    }),
  );
  if (firstAdvance !== undefined) {
    await db.batch([firstAdvance, ...restAdvances]);
  }
}

async function insertConfirmablePurchase(
  index: number,
  options: ConfirmablePurchaseOptions = {},
): Promise<void> {
  await insertConfirmablePurchases([index], options);
}

async function insertRejectedPurchase(index: number): Promise<void> {
  await db.batch([
    purchases.create(
      newPurchase(index, {
        kind: 'week_tournament_entry',
        quantity: 7,
        unitAmount: 300,
        amountTotal: 2_100,
        summary: {
          itemName: 'ウィークトーナメントへの参加',
          quantityLabel: '7日間(2026年11月1日〜7日)',
          serviceTiming: '大会の期間中',
          additionalNotes: [],
        },
      }),
    ),
  ]);
  await db.batch([
    purchases.advance({
      purchaseId: purchaseIdOf(index),
      to: 'rejected',
      from: ['open'],
      nextToken: tokenOf(index + 1000),
      patch: {
        rejectionReason: 'late',
        stripePaymentIntentId: `pi_test_${String(index)}`,
        paidAt: PAID_AT,
        reflectedAt: PAID_AT,
      },
    }),
  ]);
}

interface RefundOptions {
  readonly purchaseIndex: number;
  readonly requestKey?: string;
  readonly reason?: string;
  readonly status?: 'requested' | 'submitted' | 'succeeded';
  readonly noticeStatus?: 'none' | 'pending';
  readonly updatedAt?: Date;
}

async function insertRefund(
  index: number,
  options: RefundOptions,
): Promise<void> {
  const purchaseId = purchaseIdOf(options.purchaseIndex);
  await db.batch([
    refunds.insert(
      newRefundRequest(index, {
        purchaseId,
        requestKey: options.requestKey ?? reflectionRequestKeyOf(purchaseId),
        amount: 2_100,
        reason: options.reason ?? 'late',
        noticeStatus: options.noticeStatus ?? 'pending',
      }),
    ),
  ]);
  await db
    .update(paymentRefunds)
    .set({
      status: options.status ?? 'succeeded',
      updatedAt: options.updatedAt ?? REFUNDED_AT,
    })
    .where(eq(paymentRefunds.id, refundIdOf(index)));
}

async function confirmationStatusOf(
  index: number,
): Promise<string | undefined> {
  return (await purchases.findById(purchaseIdOf(index)))
    ?.confirmationEmailStatus;
}

async function noticeStatusOf(index: number): Promise<string | undefined> {
  return (await refunds.findById(refundIdOf(index)))?.noticeStatus;
}

beforeEach(async () => {
  await clearPaymentTables();
  await insertUser(1);
  await insertUser(2);
});

afterAll(() => {
  resetSync();
});

describe('EmailPurchaseNotifierの購入確認メール', () => {
  test('購入の表示事項・金額・購入日時・同意の日時と記録した版の文言・決済履歴のURLを入力にして、購入者へトランザクションメールを依頼する', async () => {
    await insertConfirmablePurchase(1);
    const { sender, sent } = createRecordingSender();

    const outcome = await notifierWith(sender).notifyPurchase(purchaseIdOf(1));

    expect(outcome).toBe('requested');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.kind).toBe(PAYMENTS_PURCHASE_CONFIRMATION_KIND);
    expect(sent[0]?.kind.category).toBe('transactional');
    expect(sent[0]?.to).toBe(emailOf(1));
    expect(sent[0]?.input).toEqual({
      nickname: '利用者1',
      itemName: 'Ultrasプラン',
      quantityLabel: '1か月',
      amount: 500,
      purchasedAt: '2026-11-02T07:40:12.345Z',
      serviceTiming: '決済の直後から',
      additionalNotes: [
        '毎月自動で更新されます。',
        '毎月の請求額は$5.00 USDです。',
        '設定ページからいつでも解約できます。',
      ],
      consentedAt: '2026-11-02T07:39:01.000Z',
      consentText: CONSENT_TEXT,
      paymentHistoryUrl: PAYMENT_HISTORY_URL,
    });
    expect(await confirmationStatusOf(1)).toBe('requested');
  });

  test('追加事項の無い購入では追加事項を空にする', async () => {
    await insertConfirmablePurchase(1, {
      summary: { ...SUMMARY, additionalNotes: [] },
    });
    const { sender, sent } = createRecordingSender();

    await notifierWith(sender).notifyPurchase(purchaseIdOf(1));

    expect(sent[0]?.input).toMatchObject({ additionalNotes: [] });
  });

  test('依頼を記録した購入では2回目を依頼しない', async () => {
    await insertConfirmablePurchase(1);
    const { sender, sent } = createRecordingSender();
    const notifier = notifierWith(sender);

    expect(await notifier.notifyPurchase(purchaseIdOf(1))).toBe('requested');
    expect(await notifier.notifyPurchase(purchaseIdOf(1))).toBe('not_pending');
    expect(sent).toHaveLength(1);
  });

  test('送信の依頼に失敗すると依頼待ちのまま残ってwarningのログになり、次の依頼で送れる', async () => {
    await insertConfirmablePurchase(1);
    const logs = recordLogs();

    const outcome = await notifierWith(
      createRecordingSender(new Error('queue unavailable')).sender,
    ).notifyPurchase(purchaseIdOf(1));

    expect(outcome).toBe('failed');
    expect(await confirmationStatusOf(1)).toBe('pending');
    expect(logs.filter(({ method }) => method === 'warn')).toHaveLength(1);
    expect(JSON.stringify(logs)).not.toContain(emailOf(1));

    const { sender, sent } = createRecordingSender();
    expect(await notifierWith(sender).notifyPurchase(purchaseIdOf(1))).toBe(
      'requested',
    );
    expect(sent).toHaveLength(1);
  });

  test('宛先が無い利用者(退会済み・物理削除済み)には送らずに対象外として記録する', async () => {
    await insertConfirmablePurchase(1);
    const { sender, sent } = createRecordingSender();
    const notifier = notifierWith(sender, createContactDirectory([]));

    expect(await notifier.notifyPurchase(purchaseIdOf(1))).toBe('skipped');
    expect(await confirmationStatusOf(1)).toBe('skipped');
    expect(await notifier.notifyPurchase(purchaseIdOf(1))).toBe('not_pending');
    expect(sent).toHaveLength(0);
  });

  test('停止中の利用者にも宛先が返れば送る', async () => {
    await insertConfirmablePurchase(1, { userIndex: 2 });
    const { sender, sent } = createRecordingSender();
    const suspended = { ...contactOf(2), emailVerified: false };

    const outcome = await notifierWith(
      sender,
      createContactDirectory([suspended]),
    ).notifyPurchase(purchaseIdOf(1));

    expect(outcome).toBe('requested');
    expect(sent[0]?.to).toBe(emailOf(2));
    expect(sent[0]?.input).toMatchObject({ nickname: '利用者2' });
  });

  test('依頼待ちでない購入と存在しない購入には送らない', async () => {
    await db.batch([purchases.create(newPurchase(1))]);
    const { sender, sent } = createRecordingSender();
    const notifier = notifierWith(sender);

    expect(await notifier.notifyPurchase(purchaseIdOf(1))).toBe('not_pending');
    expect(await notifier.notifyPurchase(purchaseIdOf(9))).toBe('not_pending');
    expect(sent).toHaveLength(0);
    expect(await confirmationStatusOf(1)).toBe('none');
  });

  test.each([
    ['同意の記録が無い', null],
    ['同意の版の文言が無い', '2000-01-01'],
  ] as const)(
    '%s購入には送らず、依頼待ちのまま残してwarningのログになる',
    async (_label, consentVersion) => {
      await insertConfirmablePurchase(1, { consentVersion });
      const logs = recordLogs();
      const { sender, sent } = createRecordingSender();

      const outcome = await notifierWith(sender).notifyPurchase(
        purchaseIdOf(1),
      );

      expect(outcome).toBe('failed');
      expect(sent).toHaveLength(0);
      expect(await confirmationStatusOf(1)).toBe('pending');
      expect(logs.filter(({ method }) => method === 'warn')).toHaveLength(1);
    },
  );
});

describe('EmailPurchaseNotifierの自動返金の通知', () => {
  test('反映の自動返金の成功を、購入の表示事項・返金した金額・理由・お支払いと返金の日時・決済履歴のURLを入力にして知らせる', async () => {
    await insertRejectedPurchase(1);
    await insertRefund(1, { purchaseIndex: 1, reason: 'late' });
    const { sender, sent } = createRecordingSender();

    const outcome = await notifierWith(sender).notifyAutomaticRefund(
      refundIdOf(1),
    );

    expect(outcome).toBe('requested');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.kind).toBe(PAYMENTS_AUTOMATIC_REFUND_KIND);
    expect(sent[0]?.kind.category).toBe('transactional');
    expect(sent[0]?.to).toBe(emailOf(1));
    expect(sent[0]?.input).toEqual({
      nickname: '利用者1',
      itemName: 'ウィークトーナメントへの参加',
      quantityLabel: '7日間(2026年11月1日〜7日)',
      amount: 2_100,
      reason: 'late',
      purchasedAt: '2026-11-02T07:40:12.345Z',
      refundedAt: '2026-11-02T08:15:00.000Z',
      paymentHistoryUrl: PAYMENT_HISTORY_URL,
    });
    expect(await noticeStatusOf(1)).toBe('requested');
  });

  test.each(['late', 'duplicate'])(
    '後続specの依頼は理由が%sでも自動返金として知らせない',
    async (reason) => {
      await insertRejectedPurchase(1);
      await insertRefund(1, {
        purchaseIndex: 1,
        requestKey: 'tournament-week:entry-1',
        reason,
      });
      const { sender, sent } = createRecordingSender();

      const outcome = await notifierWith(sender).notifyAutomaticRefund(
        refundIdOf(1),
      );

      expect(outcome).toBe('not_pending');
      expect(sent).toHaveLength(0);
    },
  );

  test.each(['requested', 'submitted'] as const)(
    '返金が成功していない依頼(%s)は知らせない',
    async (status) => {
      await insertRejectedPurchase(1);
      await insertRefund(1, { purchaseIndex: 1, status });
      const { sender, sent } = createRecordingSender();

      const outcome = await notifierWith(sender).notifyAutomaticRefund(
        refundIdOf(1),
      );

      expect(outcome).toBe('not_pending');
      expect(sent).toHaveLength(0);
      expect(await noticeStatusOf(1)).toBe('pending');
    },
  );

  test('依頼を記録した通知と存在しない依頼では依頼しない', async () => {
    await insertRejectedPurchase(1);
    await insertRefund(1, { purchaseIndex: 1 });
    const { sender, sent } = createRecordingSender();
    const notifier = notifierWith(sender);

    expect(await notifier.notifyAutomaticRefund(refundIdOf(1))).toBe(
      'requested',
    );
    expect(await notifier.notifyAutomaticRefund(refundIdOf(1))).toBe(
      'not_pending',
    );
    expect(await notifier.notifyAutomaticRefund(refundIdOf(9))).toBe(
      'not_pending',
    );
    expect(sent).toHaveLength(1);
  });

  test('送信の依頼に失敗すると通知待ちのまま残ってwarningのログになる', async () => {
    await insertRejectedPurchase(1);
    await insertRefund(1, { purchaseIndex: 1 });
    const logs = recordLogs();

    const outcome = await notifierWith(
      createRecordingSender(new Error('queue unavailable')).sender,
    ).notifyAutomaticRefund(refundIdOf(1));

    expect(outcome).toBe('failed');
    expect(await noticeStatusOf(1)).toBe('pending');
    expect(logs.filter(({ method }) => method === 'warn')).toHaveLength(1);
  });

  test('宛先が無い利用者には送らずに対象外として記録する', async () => {
    await insertRejectedPurchase(1);
    await insertRefund(1, { purchaseIndex: 1 });
    const { sender, sent } = createRecordingSender();

    const outcome = await notifierWith(
      sender,
      createContactDirectory([]),
    ).notifyAutomaticRefund(refundIdOf(1));

    expect(outcome).toBe('skipped');
    expect(sent).toHaveLength(0);
    expect(await noticeStatusOf(1)).toBe('skipped');
  });
});

describe('EmailPurchaseNotifierの依頼待ちの依頼し直し', () => {
  const NOW = after(24 * 60 * MINUTE);
  const STALE_BEFORE = new Date(NOW.getTime() - 10 * MINUTE);
  const LIMIT = 100;
  const STALE_INDEXES = Array.from({ length: LIMIT + 1 }, (_, i) => i + 1);
  const RECENT_INDEX = 500;
  const REQUESTED_INDEX = 501;

  test('10分以上依頼待ちの購入確認メールを最大100件ずつ依頼し直し、依頼済みと10分未満の購入は依頼しない', async () => {
    await insertConfirmablePurchases(STALE_INDEXES, { reflectedAt: T0 });
    await insertConfirmablePurchase(RECENT_INDEX, {
      reflectedAt: new Date(NOW.getTime() - 5 * MINUTE),
    });
    await insertConfirmablePurchase(REQUESTED_INDEX, { reflectedAt: T0 });
    await purchases.markConfirmationEmail({
      purchaseId: purchaseIdOf(REQUESTED_INDEX),
      to: 'requested',
    });
    const { sender, sent } = createRecordingSender();
    const notifier = notifierWith(sender);
    const resend = async (): Promise<number> => {
      const pending = await purchases.findPendingConfirmations({
        reflectedBefore: STALE_BEFORE,
        limit: LIMIT,
      });
      for (const purchase of pending) {
        await notifier.notifyPurchase(purchase.id);
      }
      return pending.length;
    };

    expect(await resend()).toBe(LIMIT);
    expect(sent).toHaveLength(LIMIT);
    expect(await resend()).toBe(1);
    expect(sent).toHaveLength(LIMIT + 1);
    expect(await resend()).toBe(0);
    expect(await confirmationStatusOf(RECENT_INDEX)).toBe('pending');
    expect(await confirmationStatusOf(REQUESTED_INDEX)).toBe('requested');
  });

  test('10分以上通知待ちの自動返金の通知を最大100件ずつ依頼し直し、10分未満の依頼は依頼しない', async () => {
    await insertConfirmablePurchases([...STALE_INDEXES, RECENT_INDEX]);
    for (const index of STALE_INDEXES) {
      await insertRefund(index, { purchaseIndex: index, updatedAt: T0 });
    }
    await insertRefund(RECENT_INDEX, {
      purchaseIndex: RECENT_INDEX,
      updatedAt: new Date(NOW.getTime() - 5 * MINUTE),
    });
    const { sender, sent } = createRecordingSender();
    const notifier = notifierWith(sender);
    const resend = async (): Promise<number> => {
      const pending = await refunds.findPendingNotices({
        updatedBefore: STALE_BEFORE,
        limit: LIMIT,
      });
      for (const refund of pending) {
        await notifier.notifyAutomaticRefund(refund.id);
      }
      return pending.length;
    };

    expect(await resend()).toBe(LIMIT);
    expect(sent).toHaveLength(LIMIT);
    expect(await resend()).toBe(1);
    expect(sent).toHaveLength(LIMIT + 1);
    expect(await resend()).toBe(0);
    expect(await noticeStatusOf(RECENT_INDEX)).toBe('pending');
  });
});
