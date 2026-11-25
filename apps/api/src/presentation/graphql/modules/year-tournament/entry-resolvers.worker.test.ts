import { describe, expect, test } from 'vitest';

import { formatWeekPeriodLabel } from '../../../../../common-lib/tournament/week-period.ts';
import { StripeUnavailableError } from '../../../../../lib/core/payments/ports.ts';
import { purchaseIdOf } from '../../../../../lib/workers/payments/testing/payment-store-fixtures.ts';
import {
  insertLaunch,
  insertProduct,
  insertUser,
  launchIdOf,
  T0,
  userIdOf,
} from '../../../../../lib/workers/product/testing/product-fixtures.ts';
import {
  bracketIdOf,
  insertBrackets,
  insertParticipants,
} from '../../../../../lib/workers/tournament/testing/bracket-fixtures.ts';
import {
  activatedSubscriptionRow,
  insertSubscriptionRow,
} from '../../../../../lib/workers/ultras/testing/ultras-store-fixtures.ts';
import { WEEK_START } from '../../../../../lib/workers/week-tournament/testing/week-tournament-fixtures.ts';
import {
  insertYearEntries,
  insertYearTournaments,
  YEAR,
  YEAR_SCHEDULE,
  type YearEntryFixture,
  yearEntryIdOf,
  type YearTournamentFixture,
  yearTournamentIdOf,
} from '../../../../../lib/workers/year-tournament/testing/year-tournament-fixtures.ts';
import {
  YEAR_ENTRY_OFFER_REJECTION_MESSAGES,
  type YearEntryOfferRejectionCode,
} from '../../../../../lib/workers/year-tournament/year-entry-offer-policy.ts';
import {
  codesOf,
  fetchMyYearEntry,
  installYearEntryGraphQLTest,
  issueYearEntrySession,
  readPurchase,
  setYearEntryTestNow,
  type StartedSessions,
  startYearTournamentCheckout,
  useStripe,
  YEAR_ENTRY_PRICE,
  YEAR_ENTRY_TEST_NOW,
  yearEntryStartHandlers,
} from '../../../../../test/support/year-entry-graphql-operations.ts';
import { PAYMENTS_ERRORS } from '../../../../application/payments/payments-errors.ts';

installYearEntryGraphQLTest();

const OWNER = 1;

const OTHER_USER = 2;

const PRODUCT = 1;

const LAUNCH = 1;

const PAID_PURCHASE_ID = purchaseIdOf(1);

const MINUTE = 60 * 1000;

const BRACKET_PATH = `/tournaments/year/${String(YEAR)}`;

const unavailableStripe = () =>
  useStripe({
    resolvePrices: () =>
      Promise.reject(new StripeUnavailableError('Stripeに接続できません')),
  });

// 投稿者1のプロダクト1・ローンチ1と、2026-11-23にWeek優勝した参加の枠1(対象年2027)を作る
async function seedEntry(
  options: {
    readonly entry?: YearEntryFixture['columns'];
    readonly tournament?: YearTournamentFixture['columns'];
    readonly product?: Parameters<typeof insertProduct>[2];
  } = {},
): Promise<void> {
  await insertUser(OWNER, { emailVerifiedAt: T0 });
  await insertUser(OTHER_USER, { emailVerifiedAt: T0 });
  await insertProduct(PRODUCT, OWNER, options.product);
  await insertLaunch(LAUNCH, PRODUCT, {
    launchDate: '2026-11-20',
    outcome: 'won',
  });
  await insertYearTournaments([{ index: 1, columns: options.tournament }]);
  await insertYearEntries([
    {
      index: 1,
      launch: LAUNCH,
      product: PRODUCT,
      owner: OWNER,
      columns: options.entry,
    },
  ]);
}

async function grantUltras(userIndex: number): Promise<void> {
  await insertSubscriptionRow(
    activatedSubscriptionRow(1, { userId: userIdOf(userIndex) }),
  );
}

const DRAWN_ENTRY: YearEntryFixture['columns'] = {
  status: 'drawn',
  entitlementSource: 'payment',
  purchaseId: PAID_PURCHASE_ID,
  classifiedYear: YEAR,
};

// 8人のブラケットに枠1を参加者1として載せる
async function seedDrawnEntry(input: {
  readonly tournament: YearTournamentFixture['columns'];
  readonly eliminatedRound: number | null;
}): Promise<void> {
  await insertBrackets([
    {
      index: 1,
      kind: 'year',
      participantCount: 8,
      columns: { tournamentId: yearTournamentIdOf(1) },
    },
  ]);
  await seedEntry({
    entry: DRAWN_ENTRY,
    tournament: {
      bracketId: bracketIdOf(1),
      drawStartedAt: YEAR_SCHEDULE.drawAt,
      drawnAt: YEAR_SCHEDULE.drawAt,
      participantCount: 8,
      ...input.tournament,
    },
  });
  await insertParticipants([
    {
      index: 1,
      bracket: 1,
      participantNo: 1,
      entry: 1,
      launch: LAUNCH,
      product: PRODUCT,
      owner: OWNER,
      columns: {
        entryRef: yearEntryIdOf(1),
        eliminatedRound: input.eliminatedRound,
      },
    },
  ]);
}

describe('呼び出し元の確認', () => {
  test.each([
    ['myYearEntry', () => fetchMyYearEntry('product1', { caller: 'admin' })],
    [
      'startYearTournamentCheckout',
      () =>
        startYearTournamentCheckout(launchIdOf(LAUNCH), { caller: 'admin' }),
    ],
  ])(
    '管理者側の呼び出し元からの%sはforbiddenで拒否し、Stripeを呼ばない',
    async (_name, call) => {
      await seedEntry();
      const stripe = useStripe(yearEntryStartHandlers());

      const response = await call();

      expect(codesOf(response)).toEqual(['forbidden']);
      expect(stripe.calls).toEqual([]);
    },
  );
});

describe('myYearEntry', () => {
  test('ログインしていなければunauthenticatedで拒否する', async () => {
    await seedEntry();

    const response = await fetchMyYearEntry('product1');

    expect(codesOf(response)).toEqual(['unauthenticated']);
    expect(response.data?.myYearEntry).toBeNull();
  });

  test('受付期限より前の受付中の枠は、対象年・決勝日・参加費・期限を添えて本人に返す', async () => {
    await seedEntry();
    const sessionToken = await issueYearEntrySession(OWNER);
    const stripe = useStripe(yearEntryStartHandlers());

    const response = await fetchMyYearEntry('product1', { sessionToken });

    expect(response.errors).toBeUndefined();
    expect(response.data?.myYearEntry).toEqual({
      launchId: launchIdOf(LAUNCH),
      year: YEAR,
      yearLabel: `${String(YEAR)}年`,
      weekLabel: formatWeekPeriodLabel(WEEK_START),
      finalDate: YEAR_SCHEDULE.finalDate,
      status: 'AWAITING_PAYMENT',
      closeReason: null,
      refundable: false,
      exempt: false,
      acceptUntil: YEAR_SCHEDULE.acceptUntil.toISOString(),
      deadlineAt: YEAR_SCHEDULE.deadlineAt.toISOString(),
      drawAt: YEAR_SCHEDULE.drawAt.toISOString(),
      fee: { amount: YEAR_ENTRY_PRICE.unitAmount, currency: 'usd' },
      serverTime: YEAR_ENTRY_TEST_NOW.toISOString(),
      progress: null,
      bracketPath: null,
    });
    expect(stripe.callsOf('resolvePrices').map(({ args }) => args)).toEqual([
      [[YEAR_ENTRY_PRICE.lookupKey]],
    ]);
  });

  test('投稿者でない利用者・存在しないハンドル・形式の違うハンドルはnullを返す', async () => {
    await seedEntry();
    const ownerToken = await issueYearEntrySession(OWNER);
    const otherToken = await issueYearEntrySession(OTHER_USER);
    const stripe = useStripe(yearEntryStartHandlers());

    const responses = await Promise.all([
      fetchMyYearEntry('product1', { sessionToken: otherToken }),
      fetchMyYearEntry('product9', { sessionToken: ownerToken }),
      fetchMyYearEntry('-', { sessionToken: ownerToken }),
    ]);

    for (const response of responses) {
      expect(response.errors).toBeUndefined();
      expect(response.data?.myYearEntry).toBeNull();
    }
    expect(stripe.calls).toEqual([]);
  });

  test('決済サービスに到達できず保持した価格も無ければ、エラーにせず参加費を空にして状態と期限を返す', async () => {
    await seedEntry();
    const sessionToken = await issueYearEntrySession(OWNER);
    unavailableStripe();

    const response = await fetchMyYearEntry('product1', { sessionToken });

    expect(response.status).toBe(200);
    expect(response.errors).toBeUndefined();
    expect(response.data?.myYearEntry).toEqual(
      expect.objectContaining({
        status: 'AWAITING_PAYMENT',
        fee: null,
        acceptUntil: YEAR_SCHEDULE.acceptUntil.toISOString(),
      }),
    );
  });

  test('Ultrasの特典を受けている投稿者の受付中の枠は免除とし、参加費を返さない', async () => {
    await seedEntry();
    await grantUltras(OWNER);
    const sessionToken = await issueYearEntrySession(OWNER);
    const stripe = useStripe(yearEntryStartHandlers());

    const response = await fetchMyYearEntry('product1', { sessionToken });

    expect(response.data?.myYearEntry).toEqual(
      expect.objectContaining({
        status: 'AWAITING_PAYMENT',
        exempt: true,
        fee: null,
      }),
    );
    expect(stripe.calls).toEqual([]);
  });

  test('受付期限(23:00)の後の受付中の枠は、参加費を返さない', async () => {
    await seedEntry();
    setYearEntryTestNow(YEAR_SCHEDULE.acceptUntil);
    const sessionToken = await issueYearEntrySession(OWNER);
    const stripe = useStripe(yearEntryStartHandlers());

    const response = await fetchMyYearEntry('product1', { sessionToken });

    expect(response.data?.myYearEntry).toEqual(
      expect.objectContaining({ status: 'AWAITING_PAYMENT', fee: null }),
    );
    expect(stripe.calls).toEqual([]);
  });

  test.each([
    [
      'Ultrasで参加資格を得た枠',
      { status: 'entitled', entitlementSource: 'ultras' },
      {
        status: 'ENTITLED',
        closeReason: null,
        exempt: true,
        refundable: false,
      },
    ],
    [
      '決済で参加資格を得た枠',
      {
        status: 'entitled',
        entitlementSource: 'payment',
        purchaseId: PAID_PURCHASE_ID,
      },
      {
        status: 'ENTITLED',
        closeReason: null,
        exempt: false,
        refundable: false,
      },
    ],
    [
      '決済期限を過ぎた枠',
      { status: 'expired', closeReason: 'deadline' },
      {
        status: 'EXPIRED',
        closeReason: 'DEADLINE',
        exempt: false,
        refundable: false,
      },
    ],
    [
      '退会で資格を失い返金を待つ決済済みの枠',
      {
        status: 'forfeited',
        closeReason: 'withdrawn',
        entitlementSource: 'payment',
        purchaseId: PAID_PURCHASE_ID,
        refundStatus: 'pending',
      },
      {
        status: 'FORFEITED',
        closeReason: 'WITHDRAWN',
        exempt: false,
        refundable: true,
      },
    ],
    [
      '参加数の上限で除外し返金を依頼した決済済みの枠',
      {
        status: 'excluded',
        closeReason: 'over_capacity',
        entitlementSource: 'payment',
        purchaseId: PAID_PURCHASE_ID,
        classifiedYear: YEAR,
        refundStatus: 'requested',
      },
      {
        status: 'EXCLUDED',
        closeReason: 'OVER_CAPACITY',
        exempt: false,
        refundable: true,
      },
    ],
    [
      '組み合わせ決定で除外し既に返金済みだった決済済みの枠',
      {
        status: 'excluded',
        closeReason: 'hidden_or_suspended',
        entitlementSource: 'payment',
        purchaseId: PAID_PURCHASE_ID,
        classifiedYear: YEAR,
        refundStatus: 'already_refunded',
      },
      {
        status: 'EXCLUDED',
        closeReason: 'HIDDEN_OR_SUSPENDED',
        exempt: false,
        refundable: false,
      },
    ],
  ] as const)(
    '%sは状態・理由・返金の対象かを返し、参加費と進行を返さない',
    async (_name, entry, expected) => {
      await seedEntry({ entry });
      const sessionToken = await issueYearEntrySession(OWNER);
      const stripe = useStripe(yearEntryStartHandlers());

      const response = await fetchMyYearEntry('product1', { sessionToken });

      expect(response.errors).toBeUndefined();
      expect(response.data?.myYearEntry).toEqual(
        expect.objectContaining({
          ...expected,
          year: YEAR,
          fee: null,
          progress: null,
          bracketPath: null,
        }),
      );
      expect(stripe.calls).toEqual([]);
    },
  );

  test('組み合わせを書き終える前の組み合わせに入った枠は、勝ち残りとしてブラケットのページの経路を返さない', async () => {
    await seedEntry({
      entry: DRAWN_ENTRY,
      tournament: { status: 'drawing', drawStartedAt: YEAR_SCHEDULE.drawAt },
    });
    const sessionToken = await issueYearEntrySession(OWNER);

    const response = await fetchMyYearEntry('product1', { sessionToken });

    expect(response.data?.myYearEntry).toEqual(
      expect.objectContaining({
        status: 'DRAWN',
        progress: { alive: true, eliminatedRoundName: null, champion: false },
        bracketPath: null,
      }),
    );
  });

  test('1回戦で敗退した枠は敗退したラウンド名とブラケットのページの経路を返す', async () => {
    await seedDrawnEntry({
      tournament: { status: 'in_progress' },
      eliminatedRound: 1,
    });
    const sessionToken = await issueYearEntrySession(OWNER);

    const response = await fetchMyYearEntry('product1', { sessionToken });

    expect(response.data?.myYearEntry).toEqual(
      expect.objectContaining({
        status: 'DRAWN',
        refundable: false,
        progress: {
          alive: false,
          eliminatedRoundName: '準々決勝',
          champion: false,
        },
        bracketPath: BRACKET_PATH,
      }),
    );
  });

  test('受賞した枠は優勝として返す', async () => {
    await seedDrawnEntry({
      tournament: {
        status: 'finished',
        outcome: 'awarded',
        championEntryId: yearEntryIdOf(1),
        awardedAt: YEAR_SCHEDULE.acceptUntil,
      },
      eliminatedRound: null,
    });
    const sessionToken = await issueYearEntrySession(OWNER);

    const response = await fetchMyYearEntry('product1', { sessionToken });

    expect(response.data?.myYearEntry).toEqual(
      expect.objectContaining({
        progress: { alive: false, eliminatedRoundName: null, champion: true },
        bracketPath: BRACKET_PATH,
      }),
    );
  });
});

describe('startYearTournamentCheckout', () => {
  test('ログインしていなければunauthenticatedで拒否し、Stripeを呼ばない', async () => {
    await seedEntry();
    const stripe = useStripe(yearEntryStartHandlers());

    const response = await startYearTournamentCheckout(launchIdOf(LAUNCH));

    expect(codesOf(response)).toEqual(['unauthenticated']);
    expect(stripe.calls).toEqual([]);
  });

  test('ULIDの形式でないローンチのIDは存在しない枠と同じ文言のvalidation_errorで拒否する', async () => {
    await seedEntry();
    const sessionToken = await issueYearEntrySession(OWNER);
    const stripe = useStripe(yearEntryStartHandlers());

    const response = await startYearTournamentCheckout(
      launchIdOf(LAUNCH).toLowerCase(),
      { sessionToken },
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(response.errors?.[0]?.extensions?.details).toEqual([
      expect.objectContaining({
        field: 'launchId',
        message: YEAR_ENTRY_OFFER_REJECTION_MESSAGES.year_entry_not_found,
      }),
    ]);
    expect(stripe.calls).toEqual([]);
  });

  test('投稿者が受付中の枠の決済を始めると、参加費の購入を作り購入のIDを返す', async () => {
    await seedEntry();
    const sessionToken = await issueYearEntrySession(OWNER);
    const sessions: StartedSessions = { sessionIds: [], inputs: [] };
    useStripe(yearEntryStartHandlers(sessions));

    const response = await startYearTournamentCheckout(launchIdOf(LAUNCH), {
      sessionToken,
    });

    expect(response.errors).toBeUndefined();
    const purchaseId =
      response.data?.startYearTournamentCheckout?.purchaseId ?? '';
    expect(await readPurchase(purchaseId)).toEqual(
      expect.objectContaining({
        userId: userIdOf(OWNER),
        kind: 'year_tournament_entry',
        targetId: launchIdOf(LAUNCH),
        relatedId: launchIdOf(LAUNCH),
        exclusivityKey: `launch:${launchIdOf(LAUNCH)}:year`,
        status: 'open',
        priceLookupKey: YEAR_ENTRY_PRICE.lookupKey,
        amountTotal: YEAR_ENTRY_PRICE.unitAmount,
        deadlineAt: YEAR_SCHEDULE.deadlineAt,
        acceptUntil: YEAR_SCHEDULE.acceptUntil,
        fulfillableUntil: YEAR_SCHEDULE.drawAt,
        stripeCheckoutSessionId: 'cs_test_1',
      }),
    );
    expect(sessions.inputs).toEqual([
      expect.objectContaining({
        purchaseId,
        mode: 'payment',
        priceId: YEAR_ENTRY_PRICE.priceId,
        quantity: 1,
      }),
    ]);
  });

  test('同じ枠の決済をもう一度始めると新しい購入を作り、前の購入を置き換える', async () => {
    await seedEntry();
    const sessionToken = await issueYearEntrySession(OWNER);
    useStripe(yearEntryStartHandlers());

    const first = await startYearTournamentCheckout(launchIdOf(LAUNCH), {
      sessionToken,
    });
    const second = await startYearTournamentCheckout(launchIdOf(LAUNCH), {
      sessionToken,
    });

    const firstId = first.data?.startYearTournamentCheckout?.purchaseId ?? '';
    const secondId = second.data?.startYearTournamentCheckout?.purchaseId ?? '';
    expect(secondId).not.toBe(firstId);
    expect((await readPurchase(firstId))?.status).toBe('superseded');
    expect((await readPurchase(secondId))?.status).toBe('open');
  });

  test.each([
    ['year_entry_not_found', '投稿者でない利用者', { user: OTHER_USER }],
    [
      'year_entry_already_entitled',
      '参加資格を得た枠',
      {
        entry: {
          status: 'entitled',
          entitlementSource: 'payment',
          purchaseId: PAID_PURCHASE_ID,
        },
      },
    ],
    [
      'year_entry_closed',
      '決済期限を過ぎた枠',
      { entry: { status: 'expired', closeReason: 'deadline' } },
    ],
    [
      'year_entry_product_unavailable',
      '非公開化したプロダクトの枠',
      { product: { hiddenAt: T0 } },
    ],
    ['year_entry_exempt', 'Ultrasの特典を受けている投稿者', { ultras: true }],
  ] as const satisfies readonly (readonly [
    YearEntryOfferRejectionCode,
    string,
    {
      readonly user?: number;
      readonly entry?: YearEntryFixture['columns'];
      readonly product?: Parameters<typeof insertProduct>[2];
      readonly ultras?: boolean;
    },
  ])[])(
    '%s: %sの決済の開始は決済を作らずに購入の可否の口と同じ文言で理由を返す',
    async (code, _name, input) => {
      await seedEntry({
        ...('entry' in input && { entry: input.entry }),
        ...('product' in input && { product: input.product }),
      });
      if ('ultras' in input) {
        await grantUltras(OWNER);
      }
      const sessionToken = await issueYearEntrySession(
        'user' in input ? input.user : OWNER,
      );
      const stripe = useStripe(yearEntryStartHandlers());

      const response = await startYearTournamentCheckout(launchIdOf(LAUNCH), {
        sessionToken,
      });

      expect(response.status).toBe(200);
      expect(codesOf(response)).toEqual([code]);
      expect(response.errors?.[0]?.message).toBe(
        YEAR_ENTRY_OFFER_REJECTION_MESSAGES[code],
      );
      expect(stripe.calls).toEqual([]);
    },
  );

  test('受付期限の1分前(22:59)の開始は受け付ける', async () => {
    await seedEntry();
    setYearEntryTestNow(new Date(YEAR_SCHEDULE.acceptUntil.getTime() - MINUTE));
    const sessionToken = await issueYearEntrySession(OWNER);
    useStripe(yearEntryStartHandlers());

    const response = await startYearTournamentCheckout(launchIdOf(LAUNCH), {
      sessionToken,
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.startYearTournamentCheckout?.purchaseId).toEqual(
      expect.any(String),
    );
  });

  test('受付期限(23:00)の開始はcheckout_closedで拒否し、Stripeを呼ばない', async () => {
    await seedEntry();
    setYearEntryTestNow(YEAR_SCHEDULE.acceptUntil);
    const sessionToken = await issueYearEntrySession(OWNER);
    const stripe = useStripe(yearEntryStartHandlers());

    const response = await startYearTournamentCheckout(launchIdOf(LAUNCH), {
      sessionToken,
    });

    expect(response.status).toBe(200);
    expect(codesOf(response)).toEqual(['checkout_closed']);
    expect(response.errors?.[0]?.message).toBe(
      PAYMENTS_ERRORS.checkout_closed.message,
    );
    expect(stripe.calls).toEqual([]);
  });

  test('決済サービスに到達できなければ購入を作らず503のpayments_unavailableで拒否する', async () => {
    await seedEntry();
    const sessionToken = await issueYearEntrySession(OWNER);
    unavailableStripe();

    const response = await startYearTournamentCheckout(launchIdOf(LAUNCH), {
      sessionToken,
    });

    expect(response.status).toBe(503);
    expect(codesOf(response)).toEqual(['payments_unavailable']);
    expect(response.errors?.[0]?.message).toBe(
      PAYMENTS_ERRORS.payments_unavailable.message,
    );
  });
});
