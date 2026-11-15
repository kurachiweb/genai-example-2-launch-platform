import { isObjectType } from 'graphql';
import { describe, expect, test } from 'vitest';

import { CHECKOUT_CONSENT_VERSION } from '../../../../../common-lib/payments/checkout-consent.ts';
import {
  type PurchaseOfferPolicy,
  type PurchaseOffer,
} from '../../../../../lib/core/payments/purchase-kind-contract.ts';
import { StripeUnavailableError } from '../../../../../lib/core/payments/ports.ts';
import { SmokePurchaseOfferPolicy } from '../../../../../lib/workers/payments/smoke-purchase.ts';
import {
  type CheckoutFields,
  codesOf,
  confirmCheckoutReturn,
  detailsOf,
  fetchCheckout,
  fetchPaymentHistory,
  insertPaymentRecords,
  insertStoredPurchase,
  insertUser,
  insertVerifiedUser,
  installPaymentsGraphQLTest,
  issueUserSession,
  newPaymentRecord,
  markRejected,
  openSessionOf,
  purchaseIdOf,
  readPurchase,
  recordCheckoutConsent,
  type StartedSessions,
  startHandlers,
  startSmokeCheckout,
  suspendUser,
  T0,
  usePaymentsEnv,
  useSmokeOffer,
  useStripe,
  userIdOf,
} from '../../../../../test/support/payments-graphql-operations.ts';
import {
  botTokenFor,
  type GatewayResponse,
  stubExternalServices,
} from '../../../../../test/support/graphql-gateway.ts';
import { composeGatewaySchema } from '../../schema-composer.ts';
import { PURCHASE_ID_TOO_LONG_MESSAGE } from './errors.ts';
import { paymentsSchemaModule } from './index.ts';
import { SMOKE_CHECKOUT_BOT_ACTION } from './resolvers.ts';

const OWNER = 1;

const OTHER = 2;

const MINUTE = 60_000;

installPaymentsGraphQLTest();

async function ownerSession(): Promise<string> {
  await insertVerifiedUser(OWNER);
  return issueUserSession(OWNER);
}

// 疎通確認の決済を始め、作った購入のIDと決済セッションのIDを返す
async function startOwnCheckout(sessionToken: string): Promise<{
  readonly purchaseId: string;
  readonly sessionId: string;
  readonly sessions: StartedSessions;
}> {
  const sessions: StartedSessions = { sessionIds: [], inputs: [] };
  useStripe(startHandlers(sessions));
  const response = await startSmokeCheckout({ sessionToken });
  const purchaseId = response.data?.startSmokeCheckout?.purchaseId;
  const [sessionId] = sessions.sessionIds;
  if (purchaseId === undefined || sessionId === undefined) {
    throw new Error(`決済を開始できませんでした: ${JSON.stringify(response)}`);
  }
  return { purchaseId, sessionId, sessions };
}

function retrieveOpen(sessions: StartedSessions) {
  return {
    retrieveCheckoutSession: (sessionId: string) => {
      const index = sessions.sessionIds.indexOf(sessionId);
      const input = sessions.inputs[index];
      if (input === undefined) {
        return Promise.reject(new Error(`未知の決済セッション: ${sessionId}`));
      }
      return Promise.resolve(openSessionOf(input, sessionId));
    },
  };
}

const TOO_LONG_PURCHASE_ID = 'P'.repeat(65);

// 疎通確認の購入の内容の一部を差し替えた購入の可否の口
function smokeOfferWith(
  overrides: Partial<PurchaseOffer>,
): PurchaseOfferPolicy {
  return {
    async describe() {
      const decision = await new SmokePurchaseOfferPolicy().describe();
      if (decision.kind !== 'available') {
        throw new Error('疎通確認の購入の内容を読めませんでした');
      }
      return { kind: 'available', offer: { ...decision.offer, ...overrides } };
    },
  };
}

function expectPurchaseIdTooLong(response: GatewayResponse): void {
  expect(codesOf(response)).toEqual(['validation_error']);
  expect(detailsOf(response)).toEqual([
    expect.objectContaining({
      field: 'purchaseId',
      message: PURCHASE_ID_TOO_LONG_MESSAGE,
    }),
  ]);
}

function expectOpenSmokeCheckout(
  checkout: CheckoutFields | null | undefined,
  purchaseId: string,
  sessionId: string,
): void {
  expect(checkout).toEqual({
    purchaseId,
    kind: 'PAYMENTS_SMOKE',
    status: 'OPEN',
    rejectionReason: null,
    clientSecret: `${sessionId}_secret_test`,
    unitPrice: { amount: 100, currency: 'usd' },
    quantity: 1,
    total: { amount: 100, currency: 'usd' },
    summary: {
      itemName: '決済の疎通確認',
      quantityLabel: '1件',
      serviceTiming: '提供する役務はありません',
      additionalNotes: [
        '決済の疎通確認のための購入です。開発と検証の環境だけで受け付け、権利は付与されません。',
      ],
      isSubscription: false,
    },
    acceptUntil: null,
    expiresAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.+Z$/u) as string,
    consentVersion: CHECKOUT_CONSENT_VERSION,
    canRestart: false,
  });
}

describe('スキーマ', () => {
  test('後続specの決済を始める変更操作が返すCheckoutStartは購入のIDだけを持ち、疎通確認の開始が返す', () => {
    const schema = composeGatewaySchema([paymentsSchemaModule]);

    const start = schema.getMutationType()?.getFields()['startSmokeCheckout'];
    const checkoutStart = schema.getType('CheckoutStart');

    expect(String(start?.type)).toBe('CheckoutStart!');
    expect(
      isObjectType(checkoutStart)
        ? Object.fromEntries(
            Object.entries(checkoutStart.getFields()).map(([name, field]) => [
              name,
              String(field.type),
            ]),
          )
        : undefined,
    ).toEqual({ purchaseId: 'ID!' });
  });
});

describe('呼び出し元の確認', () => {
  test.each([
    ['checkout', () => fetchCheckout('purchase', { caller: 'admin' })],
    ['paymentHistory', () => fetchPaymentHistory({}, { caller: 'admin' })],
    [
      'recordCheckoutConsent',
      () => recordCheckoutConsent('purchase', { caller: 'admin' }),
    ],
    [
      'confirmCheckoutReturn',
      () => confirmCheckoutReturn('cs_test_1', { caller: 'admin' }),
    ],
    ['startSmokeCheckout', () => startSmokeCheckout({ caller: 'admin' })],
  ])(
    '管理者側の呼び出し元からの%sはforbiddenで拒否する',
    async (_name, call) => {
      const response = await call();

      expect(codesOf(response)).toEqual(['forbidden']);
    },
  );
});

describe('ログインしていない要求', () => {
  test.each([
    ['checkout', () => fetchCheckout('purchase')],
    ['paymentHistory', () => fetchPaymentHistory({})],
    ['recordCheckoutConsent', () => recordCheckoutConsent('purchase')],
    ['confirmCheckoutReturn', () => confirmCheckoutReturn('cs_test_1')],
    ['startSmokeCheckout', () => startSmokeCheckout()],
  ])('%sはunauthenticatedで拒否し、Stripeを呼ばない', async (_name, call) => {
    const stripe = useStripe(startHandlers());

    const response = await call();

    expect(codesOf(response)).toEqual(['unauthenticated']);
    expect(response.errors?.[0]?.message).toBe('ログインが必要です。');
    expect(stripe.calls).toEqual([]);
  });
});

describe('startSmokeCheckout', () => {
  test('確認済みの利用者の疎通確認の決済を始め、購入のIDを返して決済セッションのIDを購入に保存する', async () => {
    const sessionToken = await ownerSession();
    const sessions: StartedSessions = { sessionIds: [], inputs: [] };
    useStripe(startHandlers(sessions));

    const response = await startSmokeCheckout({ sessionToken });

    expect(response.errors).toBeUndefined();
    const purchaseId = response.data?.startSmokeCheckout?.purchaseId ?? '';
    expect(await readPurchase(purchaseId)).toEqual(
      expect.objectContaining({
        userId: userIdOf(OWNER),
        kind: 'payments_smoke',
        status: 'open',
        amountTotal: 100,
        stripeCheckoutSessionId: 'cs_test_1',
      }),
    );
    expect(sessions.inputs).toEqual([
      expect.objectContaining({
        purchaseId,
        mode: 'payment',
        quantity: 1,
        metadata: expect.objectContaining({
          purchase_id: purchaseId,
          purchase_kind: 'payments_smoke',
        }) as unknown,
      }),
    ]);
  });

  test('疎通確認が無効な環境ではpurchase_kind_unavailableで拒否し、購入を作らない', async () => {
    const sessionToken = await ownerSession();
    usePaymentsEnv({ PAYMENTS_SMOKE_ENABLED: 'false' });
    const stripe = useStripe(startHandlers());

    const response = await startSmokeCheckout({ sessionToken });

    expect(response.status).toBe(200);
    expect(codesOf(response)).toEqual(['purchase_kind_unavailable']);
    expect(response.errors?.[0]?.message).toBe(
      'この決済は現在ご利用いただけません。',
    );
    expect(stripe.calls).toEqual([]);
  });

  test('受付期限の後はcheckout_closedで拒否し、Stripeを呼ばない', async () => {
    const sessionToken = await ownerSession();
    useSmokeOffer(
      smokeOfferWith({ acceptUntil: new Date(Date.now() - MINUTE) }),
    );
    const stripe = useStripe(startHandlers());

    const response = await startSmokeCheckout({ sessionToken });

    expect(codesOf(response)).toEqual(['checkout_closed']);
    expect(response.errors?.[0]?.message).toBe('決済の受付は終了しました。');
    expect(stripe.calls).toEqual([]);
  });

  test('Stripeに到達できなければ503のpayments_unavailableで拒否する', async () => {
    const sessionToken = await ownerSession();
    useStripe({
      resolvePrices: () =>
        Promise.reject(new StripeUnavailableError('Stripeに接続できません')),
    });

    const response = await startSmokeCheckout({ sessionToken });

    expect(response.status).toBe(503);
    expect(codesOf(response)).toEqual(['payments_unavailable']);
    expect(response.errors?.[0]?.message).toBe(
      '現在、決済をご利用いただけません。決済サービスで障害が発生しています。閲覧やその他の操作は引き続きご利用いただけます。',
    );
  });

  test('メールアドレスを確認していない利用者はemail_not_verifiedで拒否する', async () => {
    await insertUser(OWNER);
    const sessionToken = await issueUserSession(OWNER);
    const stripe = useStripe(startHandlers());

    const response = await startSmokeCheckout({ sessionToken });

    expect(codesOf(response)).toEqual(['email_not_verified']);
    expect(stripe.calls).toEqual([]);
  });

  test('購入の内容がbot判定を求めるとき、トークンが無ければbot_verification_failedで拒否し、疎通確認の操作名のトークンなら始める', async () => {
    const sessionToken = await ownerSession();
    useSmokeOffer(smokeOfferWith({ requiresBotVerification: true }));
    const calls = stubExternalServices();
    const sessions: StartedSessions = { sessionIds: [], inputs: [] };
    useStripe(startHandlers(sessions));
    const botToken = botTokenFor(SMOKE_CHECKOUT_BOT_ACTION);

    const rejected = await startSmokeCheckout({ sessionToken });
    const started = await startSmokeCheckout({ sessionToken, botToken });

    expect(codesOf(rejected)).toEqual(['bot_verification_failed']);
    expect(started.errors).toBeUndefined();
    expect(calls.siteverifyTokens).toEqual([botToken]);
    expect(sessions.inputs).toHaveLength(1);
  });

  test('停止中の利用者はaccount_unavailableで拒否する', async () => {
    const sessionToken = await ownerSession();
    await suspendUser(OWNER);
    const stripe = useStripe(startHandlers());

    const response = await startSmokeCheckout({ sessionToken });

    expect(codesOf(response)).toEqual(['account_unavailable']);
    expect(stripe.calls).toEqual([]);
  });

  test('同じ利用者の21回目の開始は、429のrate_limit_exceededと再送までの秒数で拒否する', async () => {
    const userIndex = 9;
    await insertVerifiedUser(userIndex);
    const sessionToken = await issueUserSession(userIndex);
    const sessions: StartedSessions = { sessionIds: [], inputs: [] };
    useStripe(startHandlers(sessions));
    for (let count = 0; count < 20; count += 1) {
      const started = await startSmokeCheckout({ sessionToken });
      expect(started.errors).toBeUndefined();
    }

    const response = await startSmokeCheckout({ sessionToken });

    expect(response.status).toBe(429);
    expect(codesOf(response)).toEqual(['rate_limit_exceeded']);
    expect(response.errors?.[0]?.message).toBe(
      '操作が集中しています。しばらく待ってから再度お試しください。',
    );
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(sessions.inputs).toHaveLength(20);
  });
});

describe('checkout', () => {
  test('本人の未完了の購入の表示事項と支払いに使うclientSecretを返す', async () => {
    const sessionToken = await ownerSession();
    const { purchaseId, sessionId, sessions } =
      await startOwnCheckout(sessionToken);
    useStripe(retrieveOpen(sessions));

    const response = await fetchCheckout(purchaseId, { sessionToken });

    expect(response.errors).toBeUndefined();
    expectOpenSmokeCheckout(response.data?.checkout, purchaseId, sessionId);
  });

  test('有効期限を過ぎた購入は失効として示し、受付期限が無ければやり直せる', async () => {
    const sessionToken = await ownerSession();
    await insertStoredPurchase(1, { userId: userIdOf(OWNER) });

    const response = await fetchCheckout(purchaseIdOf(1), { sessionToken });

    expect(response.data?.checkout).toEqual(
      expect.objectContaining({
        status: 'EXPIRED',
        clientSecret: null,
        rejectionReason: null,
        canRestart: true,
      }),
    );
  });

  test('権利を付与できなかった購入は返金中として理由を示す', async () => {
    const sessionToken = await ownerSession();
    await insertStoredPurchase(1, { userId: userIdOf(OWNER) });
    await markRejected(purchaseIdOf(1), 'late');

    const response = await fetchCheckout(purchaseIdOf(1), { sessionToken });

    expect(response.data?.checkout).toEqual(
      expect.objectContaining({
        status: 'REFUNDING',
        rejectionReason: 'LATE',
        clientSecret: null,
      }),
    );
  });

  test.each([
    ['他人の購入', true],
    ['存在しない購入', false],
  ])(
    '%sはcheckout_not_foundで拒否し、状態を明かさない',
    async (_name, otherOwns) => {
      const sessionToken = await ownerSession();
      if (otherOwns) {
        await insertVerifiedUser(OTHER);
        await insertStoredPurchase(1, { userId: userIdOf(OTHER) });
      }

      const response = await fetchCheckout(
        otherOwns ? purchaseIdOf(1) : purchaseIdOf(99),
        { sessionToken },
      );

      expect(response.data).toBeNull();
      expect(codesOf(response)).toEqual(['checkout_not_found']);
      expect(response.errors?.[0]?.message).toBe(
        'お探しの決済は見つかりませんでした。',
      );
    },
  );
});

describe('checkout(購入のIDの長さ)', () => {
  test('64文字を超える購入のIDはpurchaseIdの欄のvalidation_errorで拒否する', async () => {
    const sessionToken = await ownerSession();
    const stripe = useStripe({});

    const response = await fetchCheckout(TOO_LONG_PURCHASE_ID, {
      sessionToken,
    });

    expectPurchaseIdTooLong(response);
    expect(stripe.calls).toEqual([]);
  });
});

describe('recordCheckoutConsent', () => {
  test('64文字を超える購入のIDはpurchaseIdの欄のvalidation_errorで拒否する', async () => {
    const sessionToken = await ownerSession();
    const stripe = useStripe({});

    const response = await recordCheckoutConsent(TOO_LONG_PURCHASE_ID, {
      sessionToken,
    });

    expectPurchaseIdTooLong(response);
    expect(stripe.calls).toEqual([]);
  });

  test('本人の支払える購入に同意の日時と版を記録し、決済画面の表示事項を返す', async () => {
    const sessionToken = await ownerSession();
    const { purchaseId, sessionId, sessions } =
      await startOwnCheckout(sessionToken);
    useStripe(retrieveOpen(sessions));

    const response = await recordCheckoutConsent(purchaseId, { sessionToken });

    expect(response.errors).toBeUndefined();
    expectOpenSmokeCheckout(
      response.data?.recordCheckoutConsent,
      purchaseId,
      sessionId,
    );
    const row = await readPurchase(purchaseId);
    expect(row?.consentVersion).toBe(CHECKOUT_CONSENT_VERSION);
    expect(row?.consentedAt).toBeInstanceOf(Date);
  });

  test('支払える状態でない購入はcheckout_not_openで拒否する', async () => {
    const sessionToken = await ownerSession();
    await insertStoredPurchase(1, { userId: userIdOf(OWNER) });

    const response = await recordCheckoutConsent(purchaseIdOf(1), {
      sessionToken,
    });

    expect(codesOf(response)).toEqual(['checkout_not_open']);
    expect(response.errors?.[0]?.message).toBe(
      'この決済は既に完了しているか、受付が終了しています。',
    );
  });

  test('他人の購入はcheckout_not_foundで拒否する', async () => {
    const sessionToken = await ownerSession();
    await insertVerifiedUser(OTHER);
    await insertStoredPurchase(1, { userId: userIdOf(OTHER) });

    const response = await recordCheckoutConsent(purchaseIdOf(1), {
      sessionToken,
    });

    expect(codesOf(response)).toEqual(['checkout_not_found']);
  });

  test('停止中の利用者はaccount_unavailableで拒否し、同意を記録しない', async () => {
    const sessionToken = await ownerSession();
    const { purchaseId, sessions } = await startOwnCheckout(sessionToken);
    useStripe(retrieveOpen(sessions));
    await suspendUser(OWNER);

    const response = await recordCheckoutConsent(purchaseId, { sessionToken });

    expect(codesOf(response)).toEqual(['account_unavailable']);
    expect((await readPurchase(purchaseId))?.consentedAt).toBeNull();
  });
});

describe('confirmCheckoutReturn', () => {
  test('完了した決済セッションを反映し、完了した購入と決済履歴の記録を返す', async () => {
    const sessionToken = await ownerSession();
    const { purchaseId, sessionId, sessions } =
      await startOwnCheckout(sessionToken);
    const [input] = sessions.inputs;
    useStripe({
      retrieveCheckoutSession: () =>
        Promise.resolve({
          ...openSessionOf(
            input ?? { purchaseId, expiresAt: new Date() },
            sessionId,
          ),
          status: 'complete',
          paymentStatus: 'paid',
          clientSecret: null,
          paymentIntentId: 'pi_test_payments_1',
          paymentIntentStatus: 'succeeded',
          metadata: input?.metadata ?? {},
        }),
    });

    const response = await confirmCheckoutReturn(sessionId, { sessionToken });

    expect(response.errors).toBeUndefined();
    expect(response.data?.confirmCheckoutReturn?.checkout).toEqual(
      expect.objectContaining({ purchaseId, status: 'COMPLETED' }),
    );
    expect((await readPurchase(purchaseId))?.status).toBe('fulfilled');
    const history = await fetchPaymentHistory({}, { sessionToken });
    expect(history.data?.paymentHistory?.nodes).toEqual([
      expect.objectContaining({
        kind: 'ONE_TIME',
        purpose: 'PAYMENTS_SMOKE',
        amount: { amount: 100, currency: 'usd' },
        status: 'SUCCEEDED',
      }),
    ]);
  });

  test('形式の正しくない決済セッションのIDはsessionIdの欄のvalidation_errorで拒否する', async () => {
    const sessionToken = await ownerSession();
    const stripe = useStripe({});

    const response = await confirmCheckoutReturn('pi_test_1', { sessionToken });

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      {
        field: 'sessionId',
        code: 'invalid',
        message: '決済の確認に必要な情報が正しくありません。',
      },
    ]);
    expect(stripe.calls).toEqual([]);
  });

  test('本人の購入の決済セッションでなければcheckout_not_foundで拒否する', async () => {
    const sessionToken = await ownerSession();
    const stripe = useStripe({});

    const response = await confirmCheckoutReturn('cs_test_unknown', {
      sessionToken,
    });

    expect(codesOf(response)).toEqual(['checkout_not_found']);
    expect(stripe.calls).toEqual([]);
  });
});

describe('paymentHistory', () => {
  async function insertHistory(): Promise<void> {
    await insertPaymentRecords([
      newPaymentRecord(1, {
        pseudonymousId: `pseudonymous-${String(OWNER)}`,
        occurredAt: new Date(T0.getTime()),
      }),
      newPaymentRecord(2, {
        pseudonymousId: `pseudonymous-${String(OWNER)}`,
        kind: 'refund',
        amount: -100,
        quantity: null,
        occurredAt: new Date(T0.getTime() + MINUTE),
      }),
      newPaymentRecord(3, {
        pseudonymousId: `pseudonymous-${String(OWNER)}`,
        occurredAt: new Date(T0.getTime() + 2 * MINUTE),
      }),
      newPaymentRecord(4, {
        pseudonymousId: `pseudonymous-${String(OTHER)}`,
        occurredAt: new Date(T0.getTime() + 3 * MINUTE),
      }),
    ]);
  }

  test('本人の記録だけを発生時刻の新しい順にカーソルで返す', async () => {
    const sessionToken = await ownerSession();
    await insertHistory();

    const first = await fetchPaymentHistory({ first: 2 }, { sessionToken });
    const rest = await fetchPaymentHistory(
      {
        first: 2,
        after: first.data?.paymentHistory?.pageInfo.endCursor ?? null,
      },
      { sessionToken },
    );

    expect(first.errors).toBeUndefined();
    expect(first.data?.paymentHistory?.nodes).toEqual([
      {
        id: newPaymentRecord(3).id,
        kind: 'ONE_TIME',
        purpose: 'PAYMENTS_SMOKE',
        amount: { amount: 100, currency: 'usd' },
        quantity: 1,
        status: 'SUCCEEDED',
        occurredAt: new Date(T0.getTime() + 2 * MINUTE).toISOString(),
      },
      expect.objectContaining({
        id: newPaymentRecord(2).id,
        kind: 'REFUND',
        amount: { amount: -100, currency: 'usd' },
        quantity: null,
      }),
    ]);
    expect(first.data?.paymentHistory?.pageInfo).toEqual({
      hasNextPage: true,
      endCursor: expect.any(String) as string,
    });
    expect(rest.data?.paymentHistory?.nodes.map(({ id }) => id)).toEqual([
      newPaymentRecord(1).id,
    ]);
    expect(rest.data?.paymentHistory?.pageInfo.hasNextPage).toBe(false);
  });

  test('件数を省くと既定の件数で返す', async () => {
    const sessionToken = await ownerSession();
    await insertHistory();

    const response = await fetchPaymentHistory(
      { first: null, after: null },
      { sessionToken },
    );

    expect(response.data?.paymentHistory?.nodes).toHaveLength(3);
  });

  test('範囲外の件数はfirstの欄のvalidation_errorで拒否する', async () => {
    const sessionToken = await ownerSession();

    const response = await fetchPaymentHistory({ first: 51 }, { sessionToken });

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      {
        field: 'first',
        code: 'out-of-range',
        message: '表示する件数は1〜50件の整数で指定してください。',
      },
    ]);
  });

  test('上限の256文字を超えるカーソルはafterの欄のvalidation_errorで拒否する', async () => {
    const sessionToken = await ownerSession();

    const response = await fetchPaymentHistory(
      { after: 'a'.repeat(257) },
      { sessionToken },
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({
        field: 'after',
        message: 'ページの位置の指定が正しくありません。',
      }),
    ]);
  });

  test('形式の正しくないカーソルはinvalid_cursorで拒否する', async () => {
    const sessionToken = await ownerSession();

    const response = await fetchPaymentHistory(
      { after: 'not-a-cursor' },
      { sessionToken },
    );

    expect(codesOf(response)).toEqual(['invalid_cursor']);
    expect(response.errors?.[0]?.message).toBe(
      'ページの位置の指定が正しくありません。',
    );
  });
});
