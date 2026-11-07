import { env } from 'cloudflare:workers';
import {
  type GraphQLType,
  isEnumType,
  isInputObjectType,
  isObjectType,
} from 'graphql';
import { describe, expect, test } from 'vitest';

import { AUDIT_REASON_MAX } from '../../../../../common-lib/admin/admin-input-rules.ts';
import { ULTRAS_PROMOTION_UPDATE_ACTION } from '../../../../../common-lib/admin/audit-actions/ultras-subscription.ts';
import { ULTRAS_PRICE_LOOKUP_KEY } from '../../../../../common-lib/ultras/plan-status.ts';
import { StripeUnavailableError } from '../../../../../lib/core/payments/ports.ts';
import {
  activatedSubscriptionRow,
  insertSubscriptionRow,
  T0,
  ULTRAS_PROMOTION_SEED_ROW,
} from '../../../../../lib/workers/ultras/testing/ultras-store-fixtures.ts';
import { ULTRAS_OFFER_REJECTION_MESSAGES } from '../../../../../lib/workers/ultras/ultras-offer-policy.ts';
import type {
  GatewayCallOptions,
  GatewayResponse,
} from '../../../../../test/support/graphql-gateway.ts';
import {
  asUltrasAdmin,
  codesOf,
  createUltrasPortalSession,
  customerIdOf,
  detailsOf,
  enableUltrasPromotion,
  fetchUltrasOffer,
  fetchUltrasPromotionSetting,
  fetchViewerUltras,
  insertUser,
  insertVerifiedUser,
  installUltrasAdminFixtures,
  installUltrasGraphQLTest,
  issueUserSession,
  markUltrasPromotionUpdatedBy,
  readPurchase,
  readUltrasPromotionSettingRow,
  saveCustomer,
  savePriceSnapshot,
  searchUltrasAuditLogs,
  type StartedSessions,
  startUltrasCheckout,
  suspendUser,
  ULTRAS_ADMINS,
  ULTRAS_PRICE,
  ultrasStartHandlers,
  updateUltrasPromotionSetting,
  userIdOf,
  useStripe,
} from '../../../../../test/support/ultras-graphql-operations.ts';
import { ULTRAS_ERRORS } from '../../../../application/ultras/ultras-errors.ts';
import {
  adminIdOf,
  readAuditLogSummaries,
} from '../../../../infrastructure/admin/testing/admin-store-fixtures.ts';
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

const RFC3339_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const AUDIT_REASON_TOO_LONG_MESSAGE = `理由は${String(AUDIT_REASON_MAX)}文字以内で入力してください。`;

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
  if (!isObjectType(type) && !isInputObjectType(type)) {
    return undefined;
  }
  const fields: Record<string, { readonly type: GraphQLType }> =
    type.getFields();
  return Object.fromEntries(
    Object.entries(fields).map(([name, field]) => [name, String(field.type)]),
  );
}

describe('スキーマ', () => {
  test('料金の照会はログイン不要の必須、利用者の照会は未ログインでnull、加入の開始はpaymentsのCheckoutStart、Portalのセッションの作成はURL、機能フラグの照会と変更は設定を返す', () => {
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
    expect(String(query?.['ultrasPromotionSetting']?.type)).toBe(
      'UltrasPromotionSetting!',
    );
    expect(String(mutation?.['updateUltrasPromotionSetting']?.type)).toBe(
      'UltrasPromotionSetting!',
    );
    expect(fieldTypesOf(schema, 'UltrasPromotionSetting')).toEqual({
      enabled: 'Boolean!',
      version: 'Int!',
      updatedAt: 'DateTime',
      updatedByNickname: 'String',
    });
    expect(fieldTypesOf(schema, 'UpdateUltrasPromotionSettingInput')).toEqual({
      enabled: 'Boolean!',
      expectedVersion: 'Int!',
      reason: 'String',
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

describe('管理者側の操作', () => {
  installUltrasAdminFixtures();

  const { superAdmin, moderator, viewer, deleted } = ULTRAS_ADMINS;

  const SEED_UPDATED_AT = ULTRAS_PROMOTION_SEED_ROW.updatedAt.toISOString();

  const ADMIN_OPERATIONS: readonly {
    readonly name: string;
    readonly call: (options: GatewayCallOptions) => Promise<GatewayResponse>;
  }[] = [
    {
      name: 'ultrasPromotionSetting',
      call: (options) => fetchUltrasPromotionSetting(options),
    },
    {
      name: 'updateUltrasPromotionSetting',
      call: (options) =>
        updateUltrasPromotionSetting(
          { enabled: true, expectedVersion: 0 },
          options,
        ),
    },
  ];

  describe('呼び出し元とログイン', () => {
    test.each(ADMIN_OPERATIONS)(
      '$nameは、最上位管理者のセッションでも利用者側の呼び出し元からならforbiddenで拒否し、設定を変えない',
      async ({ name, call }) => {
        const response = await call({
          ...asUltrasAdmin(superAdmin),
          caller: 'client',
        });

        expect(codesOf(response)).toEqual(['forbidden']);
        expect(response.data?.[name] ?? null).toBeNull();
        await expect(readUltrasPromotionSettingRow()).resolves.toEqual(
          ULTRAS_PROMOTION_SEED_ROW,
        );
      },
    );

    test.each(ADMIN_OPERATIONS)(
      '$nameは、管理者側の呼び出し元でも未ログインならunauthenticatedで拒否し、設定を変えない',
      async ({ name, call }) => {
        const response = await call({ caller: 'admin' });

        expect(codesOf(response)).toEqual(['unauthenticated']);
        expect(response.data?.[name] ?? null).toBeNull();
        await expect(readUltrasPromotionSettingRow()).resolves.toEqual(
          ULTRAS_PROMOTION_SEED_ROW,
        );
      },
    );
  });

  describe('ultrasPromotionSetting', () => {
    test.each([
      ['閲覧のみ', viewer],
      ['モデレーター', moderator],
      ['最上位管理者', superAdmin],
    ])(
      '%sの管理者に、初期行のオフ・版0・初期行の日時を返し、最後に変更した管理者は無い',
      async (_, adminIndex) => {
        const response = await fetchUltrasPromotionSetting(
          asUltrasAdmin(adminIndex),
        );

        expect(response.errors).toBeUndefined();
        expect(response.data?.ultrasPromotionSetting).toEqual({
          enabled: false,
          version: 0,
          updatedAt: SEED_UPDATED_AT,
          updatedByNickname: null,
        });
      },
    );

    test('最上位管理者が変更した後は、新しい値・進んだ版・変更の日時と変更した管理者のニックネームを返す', async () => {
      const updated = await updateUltrasPromotionSetting(
        { enabled: true, expectedVersion: 0 },
        asUltrasAdmin(superAdmin),
      );
      expect(updated.errors).toBeUndefined();

      const response = await fetchUltrasPromotionSetting(asUltrasAdmin(viewer));

      expect(response.errors).toBeUndefined();
      expect(response.data?.ultrasPromotionSetting).toEqual({
        enabled: true,
        version: 1,
        updatedAt: expect.stringMatching(RFC3339_UTC_PATTERN) as string,
        updatedByNickname: `管理者${String(superAdmin)}`,
      });
      expect(response.data?.ultrasPromotionSetting?.updatedAt).not.toBe(
        SEED_UPDATED_AT,
      );
    });

    test('最後に変更した管理者が削除済みならニックネームをnullにする', async () => {
      await markUltrasPromotionUpdatedBy(adminIdOf(deleted), new Date());

      const response = await fetchUltrasPromotionSetting(asUltrasAdmin(viewer));

      expect(response.errors).toBeUndefined();
      expect(response.data?.ultrasPromotionSetting).toEqual({
        enabled: true,
        version: 1,
        updatedAt: expect.stringMatching(RFC3339_UTC_PATTERN) as string,
        updatedByNickname: null,
      });
    });
  });

  describe('updateUltrasPromotionSetting', () => {
    test.each([
      ['閲覧のみ', viewer],
      ['モデレーター', moderator],
    ])(
      '%sの管理者はforbiddenで拒否し、設定も監査ログも変えない',
      async (_, adminIndex) => {
        const response = await updateUltrasPromotionSetting(
          { enabled: true, expectedVersion: 0, reason: '権限の無い変更' },
          asUltrasAdmin(adminIndex),
        );

        expect(codesOf(response)).toEqual(['forbidden']);
        await expect(readUltrasPromotionSettingRow()).resolves.toEqual(
          ULTRAS_PROMOTION_SEED_ROW,
        );
        await expect(readAuditLogSummaries()).resolves.toEqual([]);
      },
    );

    test('理由が501書記素ならvalidation_errorで拒否し、設定も監査ログも変えない', async () => {
      const response = await updateUltrasPromotionSetting(
        {
          enabled: true,
          expectedVersion: 0,
          reason: 'あ'.repeat(AUDIT_REASON_MAX + 1),
        },
        asUltrasAdmin(superAdmin),
      );

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(detailsOf(response)).toEqual([
        {
          field: 'input.reason',
          code: 'custom',
          message: AUDIT_REASON_TOO_LONG_MESSAGE,
        },
      ]);
      await expect(readUltrasPromotionSettingRow()).resolves.toEqual(
        ULTRAS_PROMOTION_SEED_ROW,
      );
      await expect(readAuditLogSummaries()).resolves.toEqual([]);
    });

    test('500書記素の理由は受け付け、監査ログにそのまま残す', async () => {
      const reason = 'あ'.repeat(AUDIT_REASON_MAX);

      const response = await updateUltrasPromotionSetting(
        { enabled: true, expectedVersion: 0, reason },
        asUltrasAdmin(superAdmin),
      );

      expect(response.errors).toBeUndefined();
      const logs = await searchUltrasAuditLogs(asUltrasAdmin(viewer));
      expect(logs.data?.auditLogs?.entries).toEqual([
        expect.objectContaining({ reason }),
      ]);
    });

    test('読み取った版が最新でなければversion_conflictで拒否し、設定も監査ログも変えない', async () => {
      const first = await updateUltrasPromotionSetting(
        { enabled: true, expectedVersion: 0 },
        asUltrasAdmin(superAdmin),
      );
      expect(first.errors).toBeUndefined();
      const before = await readUltrasPromotionSettingRow();

      const response = await updateUltrasPromotionSetting(
        { enabled: false, expectedVersion: 0, reason: '表示した後の変更' },
        asUltrasAdmin(superAdmin),
      );

      expect(response.status).toBe(200);
      expect(codesOf(response)).toEqual(['version_conflict']);
      expect(response.errors?.[0]?.message).toBe(
        ULTRAS_ERRORS.version_conflict.message,
      );
      expect(response.data?.updateUltrasPromotionSetting ?? null).toBeNull();
      await expect(readUltrasPromotionSettingRow()).resolves.toEqual(before);
      await expect(readAuditLogSummaries()).resolves.toHaveLength(1);
    });

    test('最上位管理者は読み取った版と一致すれば保存し、新しい値・進んだ版・自分のニックネームを返し、監査ログの検索で変更の記録が見つかる', async () => {
      const response = await updateUltrasPromotionSetting(
        { enabled: true, expectedVersion: 0, reason: 'Stripeの準備が整った' },
        asUltrasAdmin(superAdmin),
      );

      expect(response.errors).toBeUndefined();
      const setting = response.data?.updateUltrasPromotionSetting;
      expect(setting).toEqual({
        enabled: true,
        version: 1,
        updatedAt: expect.stringMatching(RFC3339_UTC_PATTERN) as string,
        updatedByNickname: `管理者${String(superAdmin)}`,
      });
      const row = await readUltrasPromotionSettingRow();
      expect(row).toEqual({
        ...ULTRAS_PROMOTION_SEED_ROW,
        enabled: true,
        version: 1,
        updatedByAdminId: adminIdOf(superAdmin),
        updatedAt: expect.any(Date) as Date,
      });
      expect(row?.updatedAt.toISOString()).toBe(setting?.updatedAt);
      const logs = await searchUltrasAuditLogs(asUltrasAdmin(viewer), {
        action: ULTRAS_PROMOTION_UPDATE_ACTION.name,
      });
      expect(logs.errors).toBeUndefined();
      expect(logs.data?.auditLogs?.entries).toEqual([
        {
          id: expect.any(String) as string,
          occurredAt: setting?.updatedAt,
          operator: {
            id: adminIdOf(superAdmin),
            nickname: `管理者${String(superAdmin)}`,
          },
          action: ULTRAS_PROMOTION_UPDATE_ACTION.name,
          actionLabel: ULTRAS_PROMOTION_UPDATE_ACTION.label,
          targetKind: 'setting',
          targetIds: [ULTRAS_PROMOTION_SEED_ROW.id],
          reason: 'Stripeの準備が整った',
          detail: [{ key: 'enabled', value: 'true' }],
        },
      ]);
    });

    test('理由を省いても保存でき、監査ログの理由は空になる', async () => {
      const response = await updateUltrasPromotionSetting(
        { enabled: true, expectedVersion: 0 },
        asUltrasAdmin(superAdmin),
      );

      expect(response.errors).toBeUndefined();
      const logs = await searchUltrasAuditLogs(asUltrasAdmin(superAdmin));
      expect(logs.data?.auditLogs?.entries).toEqual([
        expect.objectContaining({
          reason: null,
          detail: [{ key: 'enabled', value: 'true' }],
        }),
      ]);
    });
  });
});
