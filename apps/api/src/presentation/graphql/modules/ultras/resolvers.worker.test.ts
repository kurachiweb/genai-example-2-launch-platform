import { env } from 'cloudflare:workers';
import { isEnumType, isObjectType } from 'graphql';
import { describe, expect, test } from 'vitest';

import { ULTRAS_PRICE_LOOKUP_KEY } from '../../../../../common-lib/ultras/plan-status.ts';
import { StripeUnavailableError } from '../../../../../lib/core/payments/ports.ts';
import {
  activatedSubscriptionRow,
  insertSubscriptionRow,
  T0,
} from '../../../../../lib/workers/ultras/testing/ultras-store-fixtures.ts';
import { ULTRAS_OFFER_REJECTION_MESSAGES } from '../../../../../lib/workers/ultras/ultras-offer-policy.ts';
import {
  codesOf,
  createUltrasPortalSession,
  customerIdOf,
  enableUltrasPromotion,
  fetchUltrasOffer,
  fetchViewerUltras,
  insertUser,
  insertVerifiedUser,
  installUltrasGraphQLTest,
  issueUserSession,
  readPurchase,
  saveCustomer,
  savePriceSnapshot,
  type StartedSessions,
  startUltrasCheckout,
  suspendUser,
  ULTRAS_PRICE,
  ultrasStartHandlers,
  userIdOf,
  useStripe,
} from '../../../../../test/support/ultras-graphql-operations.ts';
import { ULTRAS_ERRORS } from '../../../../application/ultras/ultras-errors.ts';
import { paymentsSchemaModule } from '../payments/index.ts';
import { composeGatewaySchema } from '../../schema-composer.ts';
import { ultrasSchemaModule } from './index.ts';

const MEMBER = 1;

const DAY_MS = 86_400_000;

const HOUR_MS = 3_600_000;

const PAYMENTS_UNAVAILABLE_MESSAGE =
  '現在、決済をご利用いただけません。決済サービスで障害が発生しています。閲覧やその他の操作は引き続きご利用いただけます。';

const PORTAL_URL = 'https://billing.stripe.example/p/session/test_portal';

const PORTAL_RETURN_URL = `${env.CLIENT_SITE_ORIGIN}/settings/plan?portal=returned`;

installUltrasGraphQLTest();

async function memberSession(): Promise<string> {
  await insertVerifiedUser(MEMBER);
  return issueUserSession(MEMBER);
}

// 加入したことがある利用者(有効化された加入とStripeのCustomerを持つ)を用意する
async function subscribedSession(
  userIndex: number,
  subscriptionIndex: number,
): Promise<string> {
  await insertVerifiedUser(userIndex);
  await insertSubscriptionRow(
    activatedSubscriptionRow(subscriptionIndex, {
      userId: userIdOf(userIndex),
      currentPeriodEnd: futureDate(20),
    }),
  );
  await saveCustomer(userIndex);
  return issueUserSession(userIndex);
}

function futureDate(days: number): Date {
  return new Date(Date.now() + days * DAY_MS);
}

function fieldTypesOf(
  schema: ReturnType<typeof composeGatewaySchema>,
  typeName: string,
) {
  const type = schema.getType(typeName);
  return isObjectType(type)
    ? Object.fromEntries(
        Object.entries(type.getFields()).map(([name, field]) => [
          name,
          String(field.type),
        ]),
      )
    : undefined;
}

describe('スキーマ', () => {
  test('料金の照会はログイン不要の必須、利用者の照会は未ログインでnull、加入の開始はpaymentsのCheckoutStart、Portalのセッションの作成はURLを返す', () => {
    const schema = composeGatewaySchema([
      paymentsSchemaModule,
      ultrasSchemaModule,
    ]);

    const query = schema.getQueryType()?.getFields();
    const mutation = schema.getMutationType()?.getFields();

    expect(String(query?.['ultrasOffer']?.type)).toBe('UltrasOffer!');
    expect(String(query?.['viewerUltras']?.type)).toBe('ViewerUltras');
    expect(String(mutation?.['startUltrasCheckout']?.type)).toBe(
      'CheckoutStart!',
    );
    expect(String(mutation?.['createUltrasPortalSession']?.type)).toBe(
      'UltrasPortalSession!',
    );
    expect(fieldTypesOf(schema, 'UltrasPortalSession')).toEqual({
      url: 'String!',
    });
    expect(fieldTypesOf(schema, 'UltrasOffer')).toEqual({
      promotionEnabled: 'Boolean!',
      price: 'Money',
      priceStale: 'Boolean!',
    });
    expect(fieldTypesOf(schema, 'ViewerUltras')).toEqual({
      plan: 'UltrasPlan',
      entitled: 'Boolean!',
      canOpenPortal: 'Boolean!',
    });
    expect(fieldTypesOf(schema, 'UltrasPlan')).toEqual({
      status: 'UltrasPlanStatus!',
      startedAt: 'DateTime!',
      currentPeriodEndsAt: 'DateTime',
      benefitEndsAt: 'DateTime',
      canceledAt: 'DateTime',
    });
  });

  test('加入状態の列挙型は共用部品の4つの状態に対応する', () => {
    const schema = composeGatewaySchema([
      paymentsSchemaModule,
      ultrasSchemaModule,
    ]);

    const status = schema.getType('UltrasPlanStatus');

    expect(
      isEnumType(status) ? status.getValues().map(({ name }) => name) : [],
    ).toEqual(['ACTIVE', 'PAST_DUE', 'CANCELED', 'ENDED']);
  });

  test('application層の拒否の文言は購入の可否の口が返す文言と一致する', () => {
    for (const code of [
      'ultras_unavailable',
      'ultras_already_subscribed',
      'ultras_resume_in_portal',
    ] as const) {
      expect(ULTRAS_ERRORS[code].message).toBe(
        ULTRAS_OFFER_REJECTION_MESSAGES[code],
      );
    }
  });
});

describe('呼び出し元の確認', () => {
  test.each([
    ['ultrasOffer', () => fetchUltrasOffer({ caller: 'admin' })],
    ['viewerUltras', () => fetchViewerUltras({ caller: 'admin' })],
    ['startUltrasCheckout', () => startUltrasCheckout({ caller: 'admin' })],
    [
      'createUltrasPortalSession',
      () => createUltrasPortalSession({ caller: 'admin' }),
    ],
  ])(
    '管理者側の呼び出し元からの%sはforbiddenで拒否し、Stripeを呼ばない',
    async (_name, call) => {
      const stripe = useStripe(ultrasStartHandlers());

      const response = await call();

      expect(codesOf(response)).toEqual(['forbidden']);
      expect(stripe.calls).toEqual([]);
    },
  );
});

describe('ultrasOffer', () => {
  test('ログインしていなくても、機能フラグの値と月額の価格を返す', async () => {
    const stripe = useStripe(ultrasStartHandlers());

    const response = await fetchUltrasOffer();

    expect(response.errors).toBeUndefined();
    expect(response.data?.ultrasOffer).toEqual({
      promotionEnabled: false,
      price: { amount: 999, currency: 'usd' },
      priceStale: false,
    });
    expect(stripe.callsOf('resolvePrices').map(({ args }) => args)).toEqual([
      [[ULTRAS_PRICE_LOOKUP_KEY]],
    ]);
  });

  test('機能フラグがオンなら新規の加入を受け付けている旨を返す', async () => {
    await enableUltrasPromotion();
    useStripe(ultrasStartHandlers());

    const response = await fetchUltrasOffer();

    expect(response.data?.ultrasOffer?.promotionEnabled).toBe(true);
  });

  test('Stripeに到達できず保存した価格も無ければ、エラーにせず価格を空にする', async () => {
    useStripe({
      resolvePrices: () =>
        Promise.reject(new StripeUnavailableError('Stripeに接続できません')),
    });

    const response = await fetchUltrasOffer();

    expect(response.errors).toBeUndefined();
    expect(response.data?.ultrasOffer).toEqual({
      promotionEnabled: false,
      price: null,
      priceStale: false,
    });
  });

  test('Stripeに到達できなくても以前に照会した価格があれば、その価格を古いものとして返す', async () => {
    await savePriceSnapshot(ULTRAS_PRICE, new Date(Date.now() - HOUR_MS));
    useStripe({
      resolvePrices: () =>
        Promise.reject(new StripeUnavailableError('Stripeに接続できません')),
    });

    const response = await fetchUltrasOffer();

    expect(response.data?.ultrasOffer).toEqual({
      promotionEnabled: false,
      price: { amount: 999, currency: 'usd' },
      priceStale: true,
    });
  });

  test('Stripeに月額の価格が無ければ、エラーにせず価格を空にする', async () => {
    useStripe({ resolvePrices: () => Promise.resolve([]) });

    const response = await fetchUltrasOffer();

    expect(response.errors).toBeUndefined();
    expect(response.data?.ultrasOffer?.price).toBeNull();
  });
});

describe('viewerUltras', () => {
  test('ログインしていなければエラーにせずnullを返す', async () => {
    const response = await fetchViewerUltras();

    expect(response.errors).toBeUndefined();
    expect(response.data?.viewerUltras).toBeNull();
  });

  test('加入したことが無い利用者は加入状態が空で、特典が無くPortalを開けない', async () => {
    const sessionToken = await memberSession();

    const response = await fetchViewerUltras({ sessionToken });

    expect(response.errors).toBeUndefined();
    expect(response.data?.viewerUltras).toEqual({
      plan: null,
      entitled: false,
      canOpenPortal: false,
    });
  });

  test('有効化された加入を持つ利用者は加入中の状態・特典あり・Portalを開けると返す', async () => {
    const sessionToken = await memberSession();
    const currentPeriodEnd = futureDate(20);
    await insertSubscriptionRow(
      activatedSubscriptionRow(1, {
        userId: userIdOf(MEMBER),
        currentPeriodEnd,
      }),
    );

    const response = await fetchViewerUltras({ sessionToken });

    expect(response.errors).toBeUndefined();
    expect(response.data?.viewerUltras).toEqual({
      plan: {
        status: 'ACTIVE',
        startedAt: T0.toISOString(),
        currentPeriodEndsAt: currentPeriodEnd.toISOString(),
        benefitEndsAt: null,
        canceledAt: null,
      },
      entitled: true,
      canOpenPortal: true,
    });
  });

  test('解約済みで継続期間内の加入は、解約済みの状態と特典の終了日時を返し、特典は続く', async () => {
    const sessionToken = await memberSession();
    const benefitEndsAt = futureDate(10);
    await insertSubscriptionRow(
      activatedSubscriptionRow(1, {
        userId: userIdOf(MEMBER),
        cancelScheduled: true,
        canceledAt: T0,
        benefitEndsAt,
      }),
    );

    const response = await fetchViewerUltras({ sessionToken });

    expect(response.data?.viewerUltras).toEqual({
      plan: expect.objectContaining({
        status: 'CANCELED',
        benefitEndsAt: benefitEndsAt.toISOString(),
        canceledAt: T0.toISOString(),
      }) as unknown,
      entitled: true,
      canOpenPortal: true,
    });
  });

  test('特典が終了した加入は、終了の状態で特典が無いがPortalは開ける', async () => {
    const sessionToken = await memberSession();
    await insertSubscriptionRow(
      activatedSubscriptionRow(1, {
        userId: userIdOf(MEMBER),
        stripeStatus: 'canceled',
        benefitEndsAt: new Date(T0.getTime() + DAY_MS),
        benefitEndFixed: true,
      }),
    );

    const response = await fetchViewerUltras({ sessionToken });

    expect(response.data?.viewerUltras).toEqual({
      plan: expect.objectContaining({ status: 'ENDED' }) as unknown,
      entitled: false,
      canOpenPortal: true,
    });
  });

  test('停止中の利用者も自分の加入状態を閲覧でき、加入中なら特典ありと返す', async () => {
    const sessionToken = await memberSession();
    await insertSubscriptionRow(
      activatedSubscriptionRow(1, {
        userId: userIdOf(MEMBER),
        currentPeriodEnd: futureDate(20),
      }),
    );
    await suspendUser(MEMBER);

    const response = await fetchViewerUltras({ sessionToken });

    expect(response.errors).toBeUndefined();
    expect(response.data?.viewerUltras).toEqual({
      plan: expect.objectContaining({ status: 'ACTIVE' }) as unknown,
      entitled: true,
      canOpenPortal: true,
    });
  });
});

describe('startUltrasCheckout', () => {
  test('ログインしていなければunauthenticatedで拒否し、Stripeを呼ばない', async () => {
    const stripe = useStripe(ultrasStartHandlers());

    const response = await startUltrasCheckout();

    expect(codesOf(response)).toEqual(['unauthenticated']);
    expect(stripe.calls).toEqual([]);
  });

  test('メールアドレスを確認していない利用者はemail_not_verifiedで拒否する', async () => {
    await insertUser(MEMBER);
    const sessionToken = await issueUserSession(MEMBER);
    await enableUltrasPromotion();
    const stripe = useStripe(ultrasStartHandlers());

    const response = await startUltrasCheckout({ sessionToken });

    expect(codesOf(response)).toEqual(['email_not_verified']);
    expect(stripe.calls).toEqual([]);
  });

  test('停止中の利用者はaccount_unavailableで拒否する', async () => {
    const sessionToken = await memberSession();
    await suspendUser(MEMBER);
    await enableUltrasPromotion();
    const stripe = useStripe(ultrasStartHandlers());

    const response = await startUltrasCheckout({ sessionToken });

    expect(codesOf(response)).toEqual(['account_unavailable']);
    expect(stripe.calls).toEqual([]);
  });

  test('機能フラグがオフならultras_unavailableで拒否し、Stripeを呼ばない', async () => {
    const sessionToken = await memberSession();
    const stripe = useStripe(ultrasStartHandlers());

    const response = await startUltrasCheckout({ sessionToken });

    expect(response.status).toBe(200);
    expect(codesOf(response)).toEqual(['ultras_unavailable']);
    expect(response.errors?.[0]?.message).toBe(
      ULTRAS_ERRORS.ultras_unavailable.message,
    );
    expect(stripe.calls).toEqual([]);
  });

  test.each([
    ['active', 'ultras_already_subscribed'],
    ['past_due', 'ultras_already_subscribed'],
  ] as const)(
    'Stripe側の状態が%sの加入中の利用者は%sで拒否する',
    async (stripeStatus, code) => {
      const sessionToken = await memberSession();
      await enableUltrasPromotion();
      await insertSubscriptionRow(
        activatedSubscriptionRow(1, { userId: userIdOf(MEMBER), stripeStatus }),
      );
      const stripe = useStripe(ultrasStartHandlers());

      const response = await startUltrasCheckout({ sessionToken });

      expect(codesOf(response)).toEqual([code]);
      expect(response.errors?.[0]?.message).toBe(ULTRAS_ERRORS[code].message);
      expect(stripe.calls).toEqual([]);
    },
  );

  test('解約済みで継続期間内の利用者はultras_resume_in_portalで拒否する', async () => {
    const sessionToken = await memberSession();
    await enableUltrasPromotion();
    await insertSubscriptionRow(
      activatedSubscriptionRow(1, {
        userId: userIdOf(MEMBER),
        cancelScheduled: true,
        canceledAt: T0,
        benefitEndsAt: futureDate(10),
      }),
    );
    const stripe = useStripe(ultrasStartHandlers());

    const response = await startUltrasCheckout({ sessionToken });

    expect(codesOf(response)).toEqual(['ultras_resume_in_portal']);
    expect(response.errors?.[0]?.message).toBe(
      ULTRAS_ERRORS.ultras_resume_in_portal.message,
    );
    expect(stripe.calls).toEqual([]);
  });

  test('機能フラグがオンで加入していない確認済みの利用者は、定期課金の決済を始めて購入のIDを返す', async () => {
    const sessionToken = await memberSession();
    await enableUltrasPromotion();
    const sessions: StartedSessions = { sessionIds: [], inputs: [] };
    useStripe(ultrasStartHandlers(sessions));

    const response = await startUltrasCheckout({ sessionToken });

    expect(response.errors).toBeUndefined();
    const purchaseId = response.data?.startUltrasCheckout?.purchaseId ?? '';
    expect(await readPurchase(purchaseId)).toEqual(
      expect.objectContaining({
        userId: userIdOf(MEMBER),
        kind: 'ultras',
        targetId: null,
        status: 'open',
        priceLookupKey: ULTRAS_PRICE_LOOKUP_KEY,
        amountTotal: 999,
        stripeCheckoutSessionId: 'cs_test_1',
      }),
    );
    expect(sessions.inputs).toEqual([
      expect.objectContaining({
        purchaseId,
        mode: 'subscription',
        priceId: ULTRAS_PRICE.priceId,
        quantity: 1,
        metadata: expect.objectContaining({
          purchase_id: purchaseId,
          purchase_kind: 'ultras',
        }) as unknown,
      }),
    ]);
  });

  test('特典が終了した加入を持つ利用者は、新しい加入の決済を始められる', async () => {
    const sessionToken = await memberSession();
    await enableUltrasPromotion();
    await insertSubscriptionRow(
      activatedSubscriptionRow(1, {
        userId: userIdOf(MEMBER),
        stripeStatus: 'canceled',
        benefitEndsAt: new Date(T0.getTime() + DAY_MS),
        benefitEndFixed: true,
      }),
    );
    useStripe(ultrasStartHandlers());

    const response = await startUltrasCheckout({ sessionToken });

    expect(response.errors).toBeUndefined();
    expect(response.data?.startUltrasCheckout?.purchaseId).toEqual(
      expect.any(String),
    );
  });

  test('Stripeに到達できなければ503のpayments_unavailableで拒否する', async () => {
    const sessionToken = await memberSession();
    await enableUltrasPromotion();
    useStripe({
      resolvePrices: () =>
        Promise.reject(new StripeUnavailableError('Stripeに接続できません')),
    });

    const response = await startUltrasCheckout({ sessionToken });

    expect(response.status).toBe(503);
    expect(codesOf(response)).toEqual(['payments_unavailable']);
    expect(response.errors?.[0]?.message).toBe(PAYMENTS_UNAVAILABLE_MESSAGE);
  });

  // 回数制限の記録はテストの間で消さないため、他のテストで決済を始めていない利用者を使う
  test('決済の開始の回数制限は拒否でも1回分を数え、同じ利用者の21回目は429のrate_limit_exceededで拒否する', async () => {
    const userIndex = 9;
    await insertVerifiedUser(userIndex);
    const sessionToken = await issueUserSession(userIndex);
    const stripe = useStripe(ultrasStartHandlers());
    for (let count = 0; count < 20; count += 1) {
      const rejected = await startUltrasCheckout({ sessionToken });
      expect(codesOf(rejected)).toEqual(['ultras_unavailable']);
    }

    const response = await startUltrasCheckout({ sessionToken });

    expect(response.status).toBe(429);
    expect(codesOf(response)).toEqual(['rate_limit_exceeded']);
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(stripe.calls).toEqual([]);
  });
});

describe('createUltrasPortalSession', () => {
  test('ログインしていなければunauthenticatedで拒否し、Stripeを呼ばない', async () => {
    const stripe = useStripe({
      createPortalSession: () => Promise.resolve({ url: PORTAL_URL }),
    });

    const response = await createUltrasPortalSession();

    expect(codesOf(response)).toEqual(['unauthenticated']);
    expect(stripe.calls).toEqual([]);
  });

  test('停止中の利用者は加入とCustomerがあってもaccount_unavailableで拒否し、Stripeを呼ばない', async () => {
    const sessionToken = await subscribedSession(MEMBER, 1);
    await suspendUser(MEMBER);
    const stripe = useStripe({
      createPortalSession: () => Promise.resolve({ url: PORTAL_URL }),
    });

    const response = await createUltrasPortalSession({ sessionToken });

    expect(codesOf(response)).toEqual(['account_unavailable']);
    expect(stripe.calls).toEqual([]);
  });

  test('加入したことが無い利用者はultras_portal_unavailableで拒否し、Stripeを呼ばない', async () => {
    const sessionToken = await memberSession();
    const stripe = useStripe({
      createPortalSession: () => Promise.resolve({ url: PORTAL_URL }),
    });

    const response = await createUltrasPortalSession({ sessionToken });

    expect(response.status).toBe(200);
    expect(codesOf(response)).toEqual(['ultras_portal_unavailable']);
    expect(response.errors?.[0]?.message).toBe(
      ULTRAS_ERRORS.ultras_portal_unavailable.message,
    );
    expect(stripe.calls).toEqual([]);
  });

  test('Customerはあるが有効化された加入が無い利用者はultras_portal_unavailableで拒否する', async () => {
    const sessionToken = await memberSession();
    await saveCustomer(MEMBER);
    const stripe = useStripe({
      createPortalSession: () => Promise.resolve({ url: PORTAL_URL }),
    });

    const response = await createUltrasPortalSession({ sessionToken });

    expect(codesOf(response)).toEqual(['ultras_portal_unavailable']);
    expect(stripe.calls).toEqual([]);
  });

  test('加入はあるがCustomerが無い利用者はultras_portal_unavailableで拒否する', async () => {
    const sessionToken = await memberSession();
    await insertSubscriptionRow(
      activatedSubscriptionRow(1, { userId: userIdOf(MEMBER) }),
    );
    const stripe = useStripe({
      createPortalSession: () => Promise.resolve({ url: PORTAL_URL }),
    });

    const response = await createUltrasPortalSession({ sessionToken });

    expect(codesOf(response)).toEqual(['ultras_portal_unavailable']);
    expect(stripe.calls).toEqual([]);
  });

  test('加入とCustomerを持つ利用者には、本人のCustomerにプラン管理画面を戻り先としたセッションを作り、URLを返す', async () => {
    const other = 2;
    await insertVerifiedUser(other);
    await saveCustomer(other);
    const sessionToken = await subscribedSession(MEMBER, 1);
    const stripe = useStripe({
      createPortalSession: () => Promise.resolve({ url: PORTAL_URL }),
    });

    const response = await createUltrasPortalSession({ sessionToken });

    expect(response.errors).toBeUndefined();
    expect(response.data?.createUltrasPortalSession).toEqual({
      url: PORTAL_URL,
    });
    expect(stripe.calls.map(({ method, args }) => [method, args])).toEqual([
      [
        'createPortalSession',
        [{ customerId: customerIdOf(MEMBER), returnUrl: PORTAL_RETURN_URL }],
      ],
    ]);
  });

  test('特典が終了した加入を持つ利用者も、Customer Portalを開ける', async () => {
    const sessionToken = await memberSession();
    await insertSubscriptionRow(
      activatedSubscriptionRow(1, {
        userId: userIdOf(MEMBER),
        stripeStatus: 'canceled',
        benefitEndsAt: new Date(T0.getTime() + DAY_MS),
        benefitEndFixed: true,
      }),
    );
    await saveCustomer(MEMBER);
    useStripe({
      createPortalSession: () => Promise.resolve({ url: PORTAL_URL }),
    });

    const response = await createUltrasPortalSession({ sessionToken });

    expect(response.errors).toBeUndefined();
    expect(response.data?.createUltrasPortalSession?.url).toBe(PORTAL_URL);
  });

  test('Stripeに到達できなければ503のpayments_unavailableで拒否する', async () => {
    const sessionToken = await subscribedSession(MEMBER, 1);
    useStripe({
      createPortalSession: () =>
        Promise.reject(new StripeUnavailableError('Stripeに接続できません')),
    });

    const response = await createUltrasPortalSession({ sessionToken });

    expect(response.status).toBe(503);
    expect(codesOf(response)).toEqual(['payments_unavailable']);
    expect(response.errors?.[0]?.message).toBe(PAYMENTS_UNAVAILABLE_MESSAGE);
  });

  // 回数制限の記録はテストの間で消さないため、他のテストでPortalを開いていない利用者を使う
  test('同じ利用者の21回目は、429のrate_limit_exceededと再送までの秒数で拒否し、セッションを作らない', async () => {
    const userIndex = 7;
    const sessionToken = await subscribedSession(userIndex, 7);
    const stripe = useStripe({
      createPortalSession: () => Promise.resolve({ url: PORTAL_URL }),
    });
    for (let count = 0; count < 20; count += 1) {
      const created = await createUltrasPortalSession({ sessionToken });
      expect(created.errors).toBeUndefined();
    }

    const response = await createUltrasPortalSession({ sessionToken });

    expect(response.status).toBe(429);
    expect(codesOf(response)).toEqual(['rate_limit_exceeded']);
    expect(response.errors?.[0]?.message).toBe(
      '操作が集中しています。しばらく待ってから再度お試しください。',
    );
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(stripe.callsOf('createPortalSession')).toHaveLength(20);
  });
});
