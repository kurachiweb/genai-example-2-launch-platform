import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';

import { users } from '../../../../../db/schema/identity/users.ts';
import { SPONSORSHIP_PRICE_LOOKUP_KEYS } from '../../../../../common-lib/sponsorship/sponsorship-tiers.ts';
import { StripeUnavailableError } from '../../../../../lib/core/payments/ports.ts';
import { SPONSORSHIP_OFFER_REJECTION_MESSAGES } from '../../../../../lib/core/sponsorship/offer-rejection.ts';
import {
  db,
  insertSponsorProduct,
  insertSponsorships,
  insertSponsorUser,
  paidColumnsOf,
  productIdOf,
  readSponsorshipIds,
  readSponsorshipRow,
  sponsorshipIdOf,
  T0,
  userIdOf,
} from '../../../../../lib/workers/sponsorship/testing/sponsorship-fixtures.ts';
import {
  BOT_REJECTED_TOKEN,
  botTokenFor,
  stubExternalServices,
} from '../../../../../test/support/graphql-gateway.ts';
import {
  type ApplyFields,
  applySponsorship,
  codesOf,
  detailsOf,
  installSponsorshipGraphQLTest,
  issueSponsorshipSession,
  readPurchase,
  resumeSponsorshipCheckout,
  SPONSORSHIP_APPLY_BOT_ACTION,
  sponsorshipStartHandlers,
  type StartedSessions,
  updateSponsorProduct,
  useStripe,
} from '../../../../../test/support/sponsorship-graphql-operations.ts';

installSponsorshipGraphQLTest();

const OWNER = 1;

const OTHER_USER = 2;

const PRODUCT = 1;

const OTHER_PRODUCT = 2;

const BOT_TOKEN = botTokenFor(SPONSORSHIP_APPLY_BOT_ACTION);

const VALID_INPUT: ApplyFields = Object.freeze({
  productId: productIdOf(PRODUCT),
  tier: 'GOLD',
  startsOn: '2026-12-01',
  endsOn: '2026-12-07',
});

const START_OUT_OF_RANGE_MESSAGE =
  '開始日は今日から1年以内の日付を選んでください。';

const END_OUT_OF_RANGE_MESSAGE =
  '終了日は開始日から366日以内の、開始日以降の日付を選んでください。';

async function setUserColumns(
  index: number,
  columns: Partial<typeof users.$inferInsert>,
): Promise<void> {
  await db
    .update(users)
    .set(columns)
    .where(eq(users.id, userIdOf(index)));
}

// メールアドレスを確認済みの投稿者1の申込の対象のプロダクト1と、利用者2のプロダクト2を作る
async function seed(): Promise<void> {
  await insertSponsorUser(OWNER);
  await insertSponsorUser(OTHER_USER);
  await setUserColumns(OWNER, { emailVerifiedAt: T0 });
  await setUserColumns(OTHER_USER, { emailVerifiedAt: T0 });
  await insertSponsorProduct({ index: PRODUCT, owner: OWNER });
  await insertSponsorProduct({ index: OTHER_PRODUCT, owner: OTHER_USER });
}

function apply(
  sessionToken: string | undefined,
  input: Partial<ApplyFields> = {},
  botToken: string = BOT_TOKEN,
) {
  return applySponsorship(
    { ...VALID_INPUT, ...input },
    {
      botToken,
      ...(sessionToken !== undefined && { sessionToken }),
    },
  );
}

function resume(
  sessionToken: string,
  id: string,
  botToken: string = BOT_TOKEN,
) {
  return resumeSponsorshipCheckout(id, { sessionToken, botToken });
}

describe('呼び出し元の確認', () => {
  test.each([
    [
      'applySponsorship',
      (sessionToken: string) =>
        applySponsorship(VALID_INPUT, {
          sessionToken,
          botToken: BOT_TOKEN,
          caller: 'admin',
        }),
    ],
    [
      'resumeSponsorshipCheckout',
      (sessionToken: string) =>
        resumeSponsorshipCheckout(sponsorshipIdOf(1), {
          sessionToken,
          botToken: BOT_TOKEN,
          caller: 'admin',
        }),
    ],
  ])(
    '管理者側の呼び出し元からの%sはforbiddenで拒否し、bot判定もStripeも呼ばない',
    async (_name, call) => {
      const calls = stubExternalServices();
      await seed();
      await insertSponsorships([{ index: 1, owner: OWNER, product: PRODUCT }]);
      const stripe = useStripe(sponsorshipStartHandlers());
      const sessionToken = await issueSponsorshipSession(OWNER);

      const response = await call(sessionToken);

      expect(codesOf(response)).toEqual(['forbidden']);
      expect(calls.siteverifyTokens).toEqual([]);
      expect(stripe.calls).toEqual([]);
    },
  );
});

describe('applySponsorship', () => {
  test('bot判定に通れば申込を未決済で記録し、日数を数量とする決済を始めて購入のIDを返す', async () => {
    const calls = stubExternalServices();
    await seed();
    const sessions: StartedSessions = { sessionIds: [], inputs: [] };
    useStripe(sponsorshipStartHandlers(sessions));
    const sessionToken = await issueSponsorshipSession(OWNER);

    const response = await apply(sessionToken);

    expect(response.errors).toBeUndefined();
    const purchaseId = response.data?.applySponsorship?.purchaseId ?? '';
    const purchase = await readPurchase(purchaseId);
    const [sponsorshipId] = await readSponsorshipIds();
    expect(calls.siteverifyTokens).toEqual([BOT_TOKEN]);
    expect(purchase).toMatchObject({
      kind: 'sponsorship',
      targetId: sponsorshipId,
      priceLookupKey: SPONSORSHIP_PRICE_LOOKUP_KEYS.gold,
      quantity: 7,
    });
    expect(sessions.sessionIds).toHaveLength(1);
  });

  test('bot判定に失敗すれば申込を記録せずbot_verification_failedを返す', async () => {
    stubExternalServices();
    await seed();
    const stripe = useStripe(sponsorshipStartHandlers());
    const sessionToken = await issueSponsorshipSession(OWNER);

    const response = await apply(sessionToken, {}, BOT_REJECTED_TOKEN);

    expect(codesOf(response)).toEqual(['bot_verification_failed']);
    expect(await readSponsorshipIds()).toEqual([]);
    expect(stripe.calls).toEqual([]);
  });

  test('期間の違反は、項目ごとの詳細を入力の経路で返すvalidation_errorで拒否し、申込を記録しない', async () => {
    stubExternalServices();
    await seed();
    useStripe(sponsorshipStartHandlers());
    const sessionToken = await issueSponsorshipSession(OWNER);

    const response = await apply(sessionToken, {
      startsOn: '2026-11-24',
      endsOn: '2026-11-23',
    });

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      {
        field: 'input.startsOn',
        code: 'past',
        message: START_OUT_OF_RANGE_MESSAGE,
      },
      {
        field: 'input.endsOn',
        code: 'before_start',
        message: END_OUT_OF_RANGE_MESSAGE,
      },
    ]);
    expect(await readSponsorshipIds()).toEqual([]);
  });

  test('形式の違うプロダクトのIDは、対象外と同じ文言のvalidation_errorで拒否し、bot判定を呼ばない', async () => {
    const calls = stubExternalServices();
    await seed();
    const sessionToken = await issueSponsorshipSession(OWNER);

    const response = await apply(sessionToken, { productId: 'product-1' });

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      {
        field: 'input.productId',
        code: expect.any(String) as string,
        message:
          SPONSORSHIP_OFFER_REJECTION_MESSAGES.sponsorship_product_ineligible,
      },
    ]);
    expect(calls.siteverifyTokens).toEqual([]);
  });

  test('他人のプロダクトはsponsorship_product_ineligibleで拒否する', async () => {
    stubExternalServices();
    await seed();
    useStripe(sponsorshipStartHandlers());
    const sessionToken = await issueSponsorshipSession(OWNER);

    const response = await apply(sessionToken, {
      productId: productIdOf(OTHER_PRODUCT),
    });

    expect(codesOf(response)).toEqual(['sponsorship_product_ineligible']);
    expect(response.errors?.[0]?.message).toBe(
      SPONSORSHIP_OFFER_REJECTION_MESSAGES.sponsorship_product_ineligible,
    );
    expect(await readSponsorshipIds()).toEqual([]);
  });

  test('同じティアの決済済みの期間と重なればsponsorship_overlapで拒否する', async () => {
    stubExternalServices();
    await seed();
    await insertSponsorships([
      { index: 1, owner: OWNER, product: PRODUCT, columns: paidColumnsOf(1) },
    ]);
    useStripe(sponsorshipStartHandlers());
    const sessionToken = await issueSponsorshipSession(OWNER);

    const response = await apply(sessionToken, {
      startsOn: '2026-12-07',
      endsOn: '2026-12-08',
    });

    expect(codesOf(response)).toEqual(['sponsorship_overlap']);
    expect(response.errors?.[0]?.message).toBe(
      SPONSORSHIP_OFFER_REJECTION_MESSAGES.sponsorship_overlap,
    );
    expect(await readSponsorshipIds()).toEqual([sponsorshipIdOf(1)]);
  });

  test('決済サービスに到達できなければpayments_unavailableを返し、記録した申込を残さない', async () => {
    stubExternalServices();
    await seed();
    useStripe({
      ...sponsorshipStartHandlers(),
      resolvePrices: () =>
        Promise.reject(new StripeUnavailableError('Stripeに接続できません')),
    });
    const sessionToken = await issueSponsorshipSession(OWNER);

    const response = await apply(sessionToken);

    expect(codesOf(response)).toEqual(['payments_unavailable']);
    expect(await readSponsorshipIds()).toEqual([]);
  });

  test('メールアドレスが未確認ならemail_not_verifiedで拒否し、bot判定を呼ばない', async () => {
    const calls = stubExternalServices();
    await seed();
    await setUserColumns(OWNER, { emailVerifiedAt: null });
    const sessionToken = await issueSponsorshipSession(OWNER);

    const response = await apply(sessionToken);

    expect(codesOf(response)).toEqual(['email_not_verified']);
    expect(calls.siteverifyTokens).toEqual([]);
  });

  test('停止中ならaccount_unavailableで拒否する', async () => {
    stubExternalServices();
    await seed();
    const sessionToken = await issueSponsorshipSession(OWNER);
    await setUserColumns(OWNER, { status: 'suspended', suspendedAt: T0 });

    const response = await apply(sessionToken);

    expect(codesOf(response)).toEqual(['account_unavailable']);
  });

  test('ログインしていなければunauthenticatedで拒否する', async () => {
    stubExternalServices();
    await seed();

    const response = await apply(undefined);

    expect(codesOf(response)).toEqual(['unauthenticated']);
  });
});

describe('resumeSponsorshipCheckout', () => {
  test('本人の開始日前の未決済の申込は、新しい決済を始めて購入のIDを返す', async () => {
    const calls = stubExternalServices();
    await seed();
    await insertSponsorships([{ index: 1, owner: OWNER, product: PRODUCT }]);
    useStripe(sponsorshipStartHandlers());
    const sessionToken = await issueSponsorshipSession(OWNER);

    const response = await resume(sessionToken, sponsorshipIdOf(1));

    expect(response.errors).toBeUndefined();
    const purchase = await readPurchase(
      response.data?.resumeSponsorshipCheckout?.purchaseId ?? '',
    );
    expect(purchase).toMatchObject({
      kind: 'sponsorship',
      targetId: sponsorshipIdOf(1),
    });
    expect(calls.siteverifyTokens).toEqual([BOT_TOKEN]);
  });

  test.each([
    ['他人の申込', sponsorshipIdOf(2)],
    ['存在しない申込', sponsorshipIdOf(99)],
  ])('%sはsponsorship_not_foundで拒否する', async (_name, id) => {
    stubExternalServices();
    await seed();
    await insertSponsorships([
      { index: 1, owner: OWNER, product: PRODUCT },
      { index: 2, owner: OTHER_USER, product: OTHER_PRODUCT },
    ]);
    useStripe(sponsorshipStartHandlers());
    const sessionToken = await issueSponsorshipSession(OWNER);

    const response = await resume(sessionToken, id);

    expect(codesOf(response)).toEqual(['sponsorship_not_found']);
    expect(response.errors?.[0]?.message).toBe(
      'この申込は見つかりませんでした。',
    );
  });

  test('形式の違う申込のIDは、見つからないと同じ文言のvalidation_errorで拒否する', async () => {
    const calls = stubExternalServices();
    await seed();
    const sessionToken = await issueSponsorshipSession(OWNER);

    const response = await resume(sessionToken, 'sponsorship-1');

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      {
        field: 'id',
        code: expect.any(String) as string,
        message: 'この申込は見つかりませんでした。',
      },
    ]);
    expect(calls.siteverifyTokens).toEqual([]);
  });

  test.each([
    ['決済済みの申込', paidColumnsOf(1)],
    [
      '開始日を過ぎた未決済の申込',
      { startsOn: '2026-11-24', endsOn: '2026-11-30', days: 7 },
    ],
  ])('%sはsponsorship_not_payableで拒否する', async (_name, columns) => {
    stubExternalServices();
    await seed();
    await insertSponsorships([
      { index: 1, owner: OWNER, product: PRODUCT, columns },
    ]);
    const stripe = useStripe(sponsorshipStartHandlers());
    const sessionToken = await issueSponsorshipSession(OWNER);

    const response = await resume(sessionToken, sponsorshipIdOf(1));

    expect(codesOf(response)).toEqual(['sponsorship_not_payable']);
    expect(response.errors?.[0]?.message).toBe(
      SPONSORSHIP_OFFER_REJECTION_MESSAGES.sponsorship_not_payable,
    );
    expect(stripe.calls).toEqual([]);
  });

  test('決済の開始の時点で対象外になったプロダクトは、購入の可否の口の文言で拒否する', async () => {
    stubExternalServices();
    await seed();
    await insertSponsorships([{ index: 1, owner: OWNER, product: PRODUCT }]);
    await updateSponsorProduct(PRODUCT, { hiddenAt: T0 });
    useStripe(sponsorshipStartHandlers());
    const sessionToken = await issueSponsorshipSession(OWNER);

    const response = await resume(sessionToken, sponsorshipIdOf(1));

    expect(codesOf(response)).toEqual(['sponsorship_product_ineligible']);
    expect(response.errors?.[0]?.message).toBe(
      SPONSORSHIP_OFFER_REJECTION_MESSAGES.sponsorship_product_ineligible,
    );
    expect((await readSponsorshipRow(1))?.state).toBe('pending_payment');
  });

  test('決済の開始の時点で決済済みの期間と重なれば、購入の可否の口の文言で拒否する', async () => {
    stubExternalServices();
    await seed();
    await insertSponsorships([
      { index: 1, owner: OWNER, product: PRODUCT },
      { index: 2, owner: OWNER, product: PRODUCT, columns: paidColumnsOf(2) },
    ]);
    useStripe(sponsorshipStartHandlers());
    const sessionToken = await issueSponsorshipSession(OWNER);

    const response = await resume(sessionToken, sponsorshipIdOf(1));

    expect(codesOf(response)).toEqual(['sponsorship_overlap']);
    expect(response.errors?.[0]?.message).toBe(
      SPONSORSHIP_OFFER_REJECTION_MESSAGES.sponsorship_overlap,
    );
  });

  test('bot判定に失敗すればbot_verification_failedで拒否し、決済を始めない', async () => {
    stubExternalServices();
    await seed();
    await insertSponsorships([{ index: 1, owner: OWNER, product: PRODUCT }]);
    const stripe = useStripe(sponsorshipStartHandlers());
    const sessionToken = await issueSponsorshipSession(OWNER);

    const response = await resume(
      sessionToken,
      sponsorshipIdOf(1),
      BOT_REJECTED_TOKEN,
    );

    expect(codesOf(response)).toEqual(['bot_verification_failed']);
    expect(stripe.calls).toEqual([]);
  });
});
