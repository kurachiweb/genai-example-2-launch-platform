import { describe, expect, test } from 'vitest';

import { formatWeekPeriodLabel } from '../../../../../common-lib/tournament/week-period.ts';
import { StripeUnavailableError } from '../../../../../lib/core/payments/ports.ts';
import {
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../../../../lib/core/time/business-time.ts';
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
import {
  insertWeekEntries,
  insertWeekTournaments,
  type WeekEntryFixture,
  type WeekTournamentFixture,
  weekEntryIdOf,
  WEEK_START,
  WEEK_WINDOW,
} from '../../../../../lib/workers/week-tournament/testing/week-tournament-fixtures.ts';
import {
  WEEK_ENTRY_OFFER_REJECTION_MESSAGES,
  type WeekEntryOfferRejectionCode,
} from '../../../../../lib/workers/week-tournament/week-entry-offer-policy.ts';
import {
  codesOf,
  fetchMyWeekEntry,
  installWeekEntryGraphQLTest,
  issueWeekEntrySession,
  readPurchase,
  setWeekEntryTestNow,
  type StartedSessions,
  startWeekTournamentCheckout,
  useStripe,
  WEEK_ENTRY_PRICE,
  WEEK_ENTRY_TEST_NOW,
  weekEntryStartHandlers,
} from '../../../../../test/support/week-entry-graphql-operations.ts';
import { PAYMENTS_ERRORS } from '../../../../application/payments/payments-errors.ts';

installWeekEntryGraphQLTest();

const OWNER = 1;

const OTHER_USER = 2;

const PRODUCT = 1;

const LAUNCH = 1;

const WEEK = '2026-W47';

const PAID_PURCHASE_ID = purchaseIdOf(1);

const ACCEPT_UNTIL_DATE = parseBusinessDate('2026-11-23');

const unavailableStripe = () =>
  useStripe({
    resolvePrices: () =>
      Promise.reject(new StripeUnavailableError('Stripeに接続できません')),
  });

// 投稿者1のプロダクト1・ローンチ1と、2026-11-16の週の参加の枠1を作る
async function seedEntry(
  options: {
    readonly entry?: WeekEntryFixture['columns'];
    readonly tournament?: WeekTournamentFixture['columns'];
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
  await insertWeekTournaments([{ index: 1, columns: options.tournament }]);
  await insertWeekEntries([
    {
      index: 1,
      tournament: 1,
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

// 8人のブラケットに枠1を参加者1として載せる
async function seedDrawnEntry(input: {
  readonly tournament: WeekTournamentFixture['columns'];
  readonly eliminatedRound: number | null;
}): Promise<void> {
  await insertBrackets([{ index: 1, tournament: 1, participantCount: 8 }]);
  await seedEntry({
    entry: {
      status: 'drawn',
      entitlementSource: 'payment',
      purchaseId: PAID_PURCHASE_ID,
    },
    tournament: { bracketId: bracketIdOf(1), ...input.tournament },
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
      columns: { eliminatedRound: input.eliminatedRound },
    },
  ]);
}

describe('呼び出し元の確認', () => {
  test.each([
    ['myWeekEntry', () => fetchMyWeekEntry('product1', { caller: 'admin' })],
    [
      'startWeekTournamentCheckout',
      () =>
        startWeekTournamentCheckout(launchIdOf(LAUNCH), { caller: 'admin' }),
    ],
  ])(
    '管理者側の呼び出し元からの%sはforbiddenで拒否し、Stripeを呼ばない',
    async (_name, call) => {
      await seedEntry();
      const stripe = useStripe(weekEntryStartHandlers());

      const response = await call();

      expect(codesOf(response)).toEqual(['forbidden']);
      expect(stripe.calls).toEqual([]);
    },
  );
});

describe('myWeekEntry', () => {
  test('ログインしていなければunauthenticatedで拒否する', async () => {
    await seedEntry();

    const response = await fetchMyWeekEntry('product1');

    expect(codesOf(response)).toEqual(['unauthenticated']);
    expect(response.data?.myWeekEntry).toBeNull();
  });

  test('受付期限より前の受付中の枠は、参加費・期限・Ultrasの案内を添えて本人に返す', async () => {
    await seedEntry();
    const sessionToken = await issueWeekEntrySession(OWNER);
    const stripe = useStripe(weekEntryStartHandlers());

    const response = await fetchMyWeekEntry('product1', { sessionToken });

    expect(response.errors).toBeUndefined();
    expect(response.data?.myWeekEntry).toEqual({
      launchId: launchIdOf(LAUNCH),
      week: WEEK,
      weekLabel: formatWeekPeriodLabel(WEEK_START),
      status: 'AWAITING_PAYMENT',
      closeReason: null,
      exempt: false,
      acceptUntil: WEEK_WINDOW.acceptUntil.toISOString(),
      deadlineAt: WEEK_WINDOW.deadlineAt.toISOString(),
      drawAt: WEEK_WINDOW.drawAt.toISOString(),
      fee: { amount: WEEK_ENTRY_PRICE.unitAmount, currency: 'usd' },
      ultrasGuide: true,
      checkoutBlock: null,
      serverTime: WEEK_ENTRY_TEST_NOW.toISOString(),
      progress: null,
      bracketPath: null,
    });
    expect(stripe.callsOf('resolvePrices').map(({ args }) => args)).toEqual([
      [[WEEK_ENTRY_PRICE.lookupKey]],
    ]);
  });

  test('非公開化したプロダクトの受付中の枠は、参加費と期限を返したまま決済の開始と同じ理由の文言で決済を始められないことを示す', async () => {
    await seedEntry({ product: { hiddenAt: T0 } });
    const sessionToken = await issueWeekEntrySession(OWNER);
    useStripe(weekEntryStartHandlers());

    const response = await fetchMyWeekEntry('product1', { sessionToken });

    expect(response.errors).toBeUndefined();
    expect(response.data?.myWeekEntry).toEqual(
      expect.objectContaining({
        status: 'AWAITING_PAYMENT',
        exempt: false,
        fee: { amount: WEEK_ENTRY_PRICE.unitAmount, currency: 'usd' },
        acceptUntil: WEEK_WINDOW.acceptUntil.toISOString(),
        checkoutBlock: {
          code: 'week_entry_product_unavailable',
          message:
            WEEK_ENTRY_OFFER_REJECTION_MESSAGES.week_entry_product_unavailable,
        },
      }),
    );
  });

  test('投稿者でない利用者・存在しないハンドル・形式の違うハンドルはnullを返す', async () => {
    await seedEntry();
    const ownerToken = await issueWeekEntrySession(OWNER);
    const otherToken = await issueWeekEntrySession(OTHER_USER);
    const stripe = useStripe(weekEntryStartHandlers());

    const responses = await Promise.all([
      fetchMyWeekEntry('product1', { sessionToken: otherToken }),
      fetchMyWeekEntry('product9', { sessionToken: ownerToken }),
      fetchMyWeekEntry('-', { sessionToken: ownerToken }),
    ]);

    for (const response of responses) {
      expect(response.errors).toBeUndefined();
      expect(response.data?.myWeekEntry).toBeNull();
    }
    expect(stripe.calls).toEqual([]);
  });

  test('決済サービスに到達できず保持した価格も無ければ、参加費を空にして状態と期限を返す', async () => {
    await seedEntry();
    const sessionToken = await issueWeekEntrySession(OWNER);
    unavailableStripe();

    const response = await fetchMyWeekEntry('product1', { sessionToken });

    expect(response.errors).toBeUndefined();
    expect(response.data?.myWeekEntry).toEqual(
      expect.objectContaining({
        status: 'AWAITING_PAYMENT',
        fee: null,
        ultrasGuide: true,
        acceptUntil: WEEK_WINDOW.acceptUntil.toISOString(),
      }),
    );
  });

  test('Ultrasの特典を受けている投稿者の受付中の枠は免除とし、参加費とUltrasの案内を返さない', async () => {
    await seedEntry();
    await grantUltras(OWNER);
    const sessionToken = await issueWeekEntrySession(OWNER);
    const stripe = useStripe(weekEntryStartHandlers());

    const response = await fetchMyWeekEntry('product1', { sessionToken });

    expect(response.data?.myWeekEntry).toEqual(
      expect.objectContaining({
        status: 'AWAITING_PAYMENT',
        exempt: true,
        fee: null,
        ultrasGuide: false,
      }),
    );
    expect(stripe.calls).toEqual([]);
  });

  test('受付期限の後の受付中の枠は、参加費とUltrasの案内を返さない', async () => {
    await seedEntry();
    setWeekEntryTestNow(
      fromBusinessDateTime(ACCEPT_UNTIL_DATE, { hour: 23, minute: 0 }),
    );
    const sessionToken = await issueWeekEntrySession(OWNER);
    const stripe = useStripe(weekEntryStartHandlers());

    const response = await fetchMyWeekEntry('product1', { sessionToken });

    expect(response.data?.myWeekEntry).toEqual(
      expect.objectContaining({
        status: 'AWAITING_PAYMENT',
        fee: null,
        ultrasGuide: false,
      }),
    );
    expect(stripe.calls).toEqual([]);
  });

  test.each([
    [
      'Ultrasで参加資格を得た枠',
      { status: 'entitled', entitlementSource: 'ultras' },
      { status: 'ENTITLED', closeReason: null, exempt: true },
    ],
    [
      '決済で参加資格を得た枠',
      {
        status: 'entitled',
        entitlementSource: 'payment',
        purchaseId: PAID_PURCHASE_ID,
      },
      { status: 'ENTITLED', closeReason: null, exempt: false },
    ],
    [
      '決済期限を過ぎた枠',
      { status: 'expired', closeReason: 'deadline' },
      { status: 'EXPIRED', closeReason: 'DEADLINE', exempt: false },
    ],
    [
      '退会で資格を失った枠',
      { status: 'forfeited', closeReason: 'withdrawn' },
      { status: 'FORFEITED', closeReason: 'WITHDRAWN', exempt: false },
    ],
    [
      '組み合わせ決定で除外した枠',
      { status: 'excluded', closeReason: 'hidden_or_suspended' },
      {
        status: 'EXCLUDED',
        closeReason: 'HIDDEN_OR_SUSPENDED',
        exempt: false,
      },
    ],
  ] as const)(
    '%sは状態と理由を返し、参加費と進行を返さない',
    async (_name, entry, expected) => {
      await seedEntry({ entry });
      const sessionToken = await issueWeekEntrySession(OWNER);
      const stripe = useStripe(weekEntryStartHandlers());

      const response = await fetchMyWeekEntry('product1', { sessionToken });

      expect(response.data?.myWeekEntry).toEqual(
        expect.objectContaining({
          ...expected,
          fee: null,
          ultrasGuide: false,
          progress: null,
          bracketPath: null,
        }),
      );
      expect(stripe.calls).toEqual([]);
    },
  );

  test('組み合わせを書き終える前の組み合わせに入った枠は、勝ち残りとしてブラケットのページの経路を返さない', async () => {
    await seedEntry({
      entry: {
        status: 'drawn',
        entitlementSource: 'payment',
        purchaseId: PAID_PURCHASE_ID,
      },
      tournament: { status: 'drawing', drawStartedAt: WEEK_WINDOW.drawAt },
    });
    const sessionToken = await issueWeekEntrySession(OWNER);

    const response = await fetchMyWeekEntry('product1', { sessionToken });

    expect(response.data?.myWeekEntry).toEqual(
      expect.objectContaining({
        status: 'DRAWN',
        progress: { alive: true, eliminatedRoundName: null, champion: false },
        bracketPath: null,
      }),
    );
  });

  test('1回戦で敗退した枠は敗退したラウンド名とブラケットのページの経路を返す', async () => {
    await seedDrawnEntry({
      tournament: { status: 'in_progress', drawStartedAt: WEEK_WINDOW.drawAt },
      eliminatedRound: 1,
    });
    const sessionToken = await issueWeekEntrySession(OWNER);

    const response = await fetchMyWeekEntry('product1', { sessionToken });

    expect(response.data?.myWeekEntry).toEqual(
      expect.objectContaining({
        status: 'DRAWN',
        progress: {
          alive: false,
          eliminatedRoundName: '準々決勝',
          champion: false,
        },
        bracketPath: `/tournaments/week/${WEEK}`,
      }),
    );
  });

  test('受賞した枠は優勝として返す', async () => {
    await seedDrawnEntry({
      tournament: {
        status: 'finished',
        drawStartedAt: WEEK_WINDOW.drawAt,
        outcome: 'awarded',
        championEntryId: weekEntryIdOf(1),
        awardedAt: new Date('2026-11-27T07:40:00.000Z'),
      },
      eliminatedRound: null,
    });
    const sessionToken = await issueWeekEntrySession(OWNER);

    const response = await fetchMyWeekEntry('product1', { sessionToken });

    expect(response.data?.myWeekEntry?.progress).toEqual({
      alive: false,
      eliminatedRoundName: null,
      champion: true,
    });
  });
});

describe('startWeekTournamentCheckout', () => {
  test('ログインしていなければunauthenticatedで拒否し、Stripeを呼ばない', async () => {
    await seedEntry();
    const stripe = useStripe(weekEntryStartHandlers());

    const response = await startWeekTournamentCheckout(launchIdOf(LAUNCH));

    expect(codesOf(response)).toEqual(['unauthenticated']);
    expect(stripe.calls).toEqual([]);
  });

  test('ULIDの形式でないローンチのIDは存在しない枠と同じ文言のvalidation_errorで拒否する', async () => {
    await seedEntry();
    const sessionToken = await issueWeekEntrySession(OWNER);
    const stripe = useStripe(weekEntryStartHandlers());

    const response = await startWeekTournamentCheckout(
      launchIdOf(LAUNCH).toLowerCase(),
      { sessionToken },
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(response.errors?.[0]?.extensions?.details).toEqual([
      expect.objectContaining({
        field: 'launchId',
        message: WEEK_ENTRY_OFFER_REJECTION_MESSAGES.week_entry_not_found,
      }),
    ]);
    expect(stripe.calls).toEqual([]);
  });

  test('投稿者が受付中の枠の決済を始めると、参加費の購入を作り購入のIDを返す', async () => {
    await seedEntry();
    const sessionToken = await issueWeekEntrySession(OWNER);
    const sessions: StartedSessions = { sessionIds: [], inputs: [] };
    useStripe(weekEntryStartHandlers(sessions));

    const response = await startWeekTournamentCheckout(launchIdOf(LAUNCH), {
      sessionToken,
    });

    expect(response.errors).toBeUndefined();
    const purchaseId =
      response.data?.startWeekTournamentCheckout?.purchaseId ?? '';
    expect(await readPurchase(purchaseId)).toEqual(
      expect.objectContaining({
        userId: userIdOf(OWNER),
        kind: 'week_tournament_entry',
        targetId: launchIdOf(LAUNCH),
        relatedId: launchIdOf(LAUNCH),
        exclusivityKey: `launch:${launchIdOf(LAUNCH)}:week`,
        status: 'open',
        priceLookupKey: WEEK_ENTRY_PRICE.lookupKey,
        amountTotal: WEEK_ENTRY_PRICE.unitAmount,
        deadlineAt: WEEK_WINDOW.deadlineAt,
        acceptUntil: WEEK_WINDOW.acceptUntil,
        fulfillableUntil: WEEK_WINDOW.drawAt,
        stripeCheckoutSessionId: 'cs_test_1',
      }),
    );
    expect(sessions.inputs).toEqual([
      expect.objectContaining({
        purchaseId,
        mode: 'payment',
        priceId: WEEK_ENTRY_PRICE.priceId,
        quantity: 1,
      }),
    ]);
  });

  test('同じ枠の決済をもう一度始めると新しい購入を作り、前の購入を置き換える', async () => {
    await seedEntry();
    const sessionToken = await issueWeekEntrySession(OWNER);
    useStripe(weekEntryStartHandlers());

    const first = await startWeekTournamentCheckout(launchIdOf(LAUNCH), {
      sessionToken,
    });
    const second = await startWeekTournamentCheckout(launchIdOf(LAUNCH), {
      sessionToken,
    });

    const firstId = first.data?.startWeekTournamentCheckout?.purchaseId ?? '';
    const secondId = second.data?.startWeekTournamentCheckout?.purchaseId ?? '';
    expect(secondId).not.toBe(firstId);
    expect((await readPurchase(firstId))?.status).toBe('superseded');
    expect((await readPurchase(secondId))?.status).toBe('open');
  });

  test.each([
    ['week_entry_not_found', '投稿者でない利用者', { user: OTHER_USER }],
    [
      'week_entry_already_entitled',
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
      'week_entry_closed',
      '決済期限を過ぎた枠',
      { entry: { status: 'expired', closeReason: 'deadline' } },
    ],
    [
      'week_entry_product_unavailable',
      '非公開化したプロダクトの枠',
      { product: { hiddenAt: T0 } },
    ],
    ['week_entry_exempt', 'Ultrasの特典を受けている投稿者', { ultras: true }],
  ] as const satisfies readonly (readonly [
    WeekEntryOfferRejectionCode,
    string,
    {
      readonly user?: number;
      readonly entry?: WeekEntryFixture['columns'];
      readonly product?: Parameters<typeof insertProduct>[2];
      readonly ultras?: boolean;
    },
  ])[])(
    '%s: %sの決済の開始は決済を作らずに理由を返す',
    async (code, _name, input) => {
      await seedEntry({
        ...('entry' in input && { entry: input.entry }),
        ...('product' in input && { product: input.product }),
      });
      if ('ultras' in input) {
        await grantUltras(OWNER);
      }
      const sessionToken = await issueWeekEntrySession(
        'user' in input ? input.user : OWNER,
      );
      const stripe = useStripe(weekEntryStartHandlers());

      const response = await startWeekTournamentCheckout(launchIdOf(LAUNCH), {
        sessionToken,
      });

      expect(response.status).toBe(200);
      expect(codesOf(response)).toEqual([code]);
      expect(response.errors?.[0]?.message).toBe(
        WEEK_ENTRY_OFFER_REJECTION_MESSAGES[code],
      );
      expect(stripe.calls).toEqual([]);
    },
  );

  test('受付期限の1分前(22:59)の開始は受け付ける', async () => {
    await seedEntry();
    setWeekEntryTestNow(
      fromBusinessDateTime(ACCEPT_UNTIL_DATE, { hour: 22, minute: 59 }),
    );
    const sessionToken = await issueWeekEntrySession(OWNER);
    useStripe(weekEntryStartHandlers());

    const response = await startWeekTournamentCheckout(launchIdOf(LAUNCH), {
      sessionToken,
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.startWeekTournamentCheckout?.purchaseId).toEqual(
      expect.any(String),
    );
  });

  test('受付期限(23:00)の開始はcheckout_closedで拒否し、Stripeを呼ばない', async () => {
    await seedEntry();
    setWeekEntryTestNow(
      fromBusinessDateTime(ACCEPT_UNTIL_DATE, { hour: 23, minute: 0 }),
    );
    const sessionToken = await issueWeekEntrySession(OWNER);
    const stripe = useStripe(weekEntryStartHandlers());

    const response = await startWeekTournamentCheckout(launchIdOf(LAUNCH), {
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
    const sessionToken = await issueWeekEntrySession(OWNER);
    unavailableStripe();

    const response = await startWeekTournamentCheckout(launchIdOf(LAUNCH), {
      sessionToken,
    });

    expect(response.status).toBe(503);
    expect(codesOf(response)).toEqual(['payments_unavailable']);
    expect(response.errors?.[0]?.message).toBe(
      PAYMENTS_ERRORS.payments_unavailable.message,
    );
  });
});
