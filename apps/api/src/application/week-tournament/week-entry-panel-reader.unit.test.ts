import { describe, expect, test } from 'bun:test';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import type {
  PriceCatalog,
  PriceCatalogResult,
  StripePrice,
} from '../../../lib/core/payments/ports.ts';
import type {
  LaunchRecord,
  ProductDirectory,
  ProductHandleResolution,
} from '../../../lib/core/product/ports.ts';
import type { BracketParticipantStanding } from '../../../lib/core/tournament/ports.ts';
import type { UltrasEntitlements } from '../../../lib/core/ultras/ports.ts';
import type {
  WeekEntryRecord,
  WeekTournamentRecord,
  WeekTournamentStore,
} from '../../../lib/core/week-tournament/ports.ts';
import { WEEK_ENTRY_PRICE_LOOKUP_KEY } from '../../../lib/core/week-tournament/week-schedule.ts';
import type { MatchRecord } from '../../../lib/core/match/ports.ts';
import {
  launchRecordOf,
  productSummaryOf,
} from '../match/testing/kickoff-fakes.ts';
import {
  entryIdOf,
  entryOf,
  LAUNCH_DATE,
  launchIdOf,
  productIdOf,
  RULE_WINDOW,
  STORED_DEADLINE_AT,
  TOURNAMENT_ID,
  tournamentOf,
  WON_AT,
} from './testing/week-decision-fakes.ts';
import {
  createWeekSummaryFakes,
  standingOf,
  weekMatchOf,
} from './testing/week-summary-fakes.ts';
import { DirectoryWeekEntryPanelReader } from './week-entry-panel-reader.ts';

const OWNER_USER_ID = '01JF0WACCT0000000000000001';
const OTHER_USER_ID = '01JF0WACCT0000000000000002';
const HANDLE = 'week-entry-product';

// 受付期限(2027-03-09T07:00Z)より前
const NOW = new Date('2027-03-05T12:00:00.000Z');
const AFTER_ACCEPT_UNTIL = new Date(RULE_WINDOW.acceptUntil.getTime() + 1);
const AFTER_DEADLINE = new Date(STORED_DEADLINE_AT.getTime() + 60_000);

const VIEWER: CurrentUser = {
  principal: {
    kind: 'authenticated',
    subjectKind: 'user',
    subjectId: OWNER_USER_ID,
    sessionId: '01JF0WSESS0000000000000001',
  },
  user: {
    id: OWNER_USER_ID,
    pseudonymousId: '01JF0WPSEU0000000000000001',
    status: 'active',
    emailVerifiedAt: new Date('2027-01-01T00:00:00.000Z'),
    deletedAt: null,
    email: 'owner@mail.example',
    nickname: '投稿者',
    handle: 'owner',
  },
};

const ENTRY_PRICE: StripePrice = Object.freeze({
  lookupKey: WEEK_ENTRY_PRICE_LOOKUP_KEY,
  priceId: 'price_week_entry',
  unitAmount: 500,
  currency: 'usd',
  recurringInterval: null,
});

const PAYMENTS_UNAVAILABLE = new AppError({
  kind: 'unavailable',
  code: 'payments_unavailable',
  message: '現在、決済をご利用いただけません。',
});

const PRODUCT = productSummaryOf(productIdOf(1), {
  ownerUserId: OWNER_USER_ID,
  handle: HANDLE,
});

const WON_LAUNCH = launchRecordOf(launchIdOf(1), productIdOf(1), {
  launchDate: LAUNCH_DATE,
  status: 'finished',
  outcome: 'won',
  decidedAt: WON_AT,
});

interface PanelScenario {
  readonly resolution?: ProductHandleResolution;
  readonly launches?: readonly LaunchRecord[];
  readonly entries?: readonly WeekEntryRecord[];
  readonly tournament?: WeekTournamentRecord | null;
  readonly standings?: ReadonlyMap<string, BracketParticipantStanding>;
  readonly matches?: ReadonlyMap<string, readonly MatchRecord[]>;
  readonly entitledDuring?: boolean;
  readonly prices?: PriceCatalogResult | Error;
}

const unused = (name: string) => (): never => {
  throw new Error(`照会は${name}を呼ばない`);
};

function createPanelFakes(scenario: PanelScenario = {}) {
  const summary = createWeekSummaryFakes({
    entries: scenario.entries ?? [],
    standings: scenario.standings,
    matches: scenario.matches,
  });
  const reads = {
    ...summary.reads,
    handleReads: [] as string[],
    launchReads: [] as { productIds: readonly string[]; now: Date }[],
    tournamentReads: [] as string[],
    entitlementReads: [] as { userId: string; from: Date; to: Date }[],
    priceReads: [] as (readonly string[])[],
  };
  const tournament =
    scenario.tournament === undefined ? tournamentOf() : scenario.tournament;
  const store: WeekTournamentStore = {
    ...summary.store,
    findTournament(tournamentId) {
      reads.tournamentReads.push(tournamentId);
      return Promise.resolve(
        tournament?.tournamentId === tournamentId ? tournament : undefined,
      );
    },
  };
  const products: ProductDirectory = {
    resolveHandle(handle) {
      reads.handleReads.push(handle);
      return Promise.resolve(
        scenario.resolution ?? { kind: 'current', product: PRODUCT },
      );
    },
    listLaunches(productIds, now) {
      reads.launchReads.push({ productIds, now });
      return Promise.resolve(
        new Map([[PRODUCT.productId, scenario.launches ?? [WON_LAUNCH]]]),
      );
    },
    findSummaries: unused('findSummaries'),
    findDetail: unused('findDetail'),
  };
  const entitlements: UltrasEntitlements = {
    wasEntitledDuring(userId, from, to) {
      reads.entitlementReads.push({ userId, from, to });
      return Promise.resolve(scenario.entitledDuring ?? false);
    },
    isEntitledAt: unused('isEntitledAt'),
    entitledUsersAt: unused('entitledUsersAt'),
    entitledUsersDuring: unused('entitledUsersDuring'),
    currentPlan: unused('currentPlan'),
  };
  const prices: PriceCatalog = {
    getPrices(lookupKeys) {
      reads.priceReads.push(lookupKeys);
      const result = scenario.prices ?? { prices: [ENTRY_PRICE], stale: false };
      return result instanceof Error
        ? Promise.reject(result)
        : Promise.resolve(result);
    },
  };
  const reader = new DirectoryWeekEntryPanelReader(
    products,
    store,
    summary.brackets,
    summary.matches,
    entitlements,
    prices,
  );
  return { reader, reads, tournament };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('拒否される想定です');
}

describe('DirectoryWeekEntryPanelReader 対象の枠', () => {
  test('形式に合わないハンドルは照会をせずにnullを返す', async () => {
    const { reader, reads } = createPanelFakes();

    expect(await reader.readForOwner(VIEWER, 'Not A Handle!', NOW)).toBeNull();
    expect(reads.handleReads).toEqual([]);
  });

  test('存在しないプロダクトはnullを返す', async () => {
    const { reader, reads } = createPanelFakes({
      resolution: { kind: 'none' },
    });

    expect(await reader.readForOwner(VIEWER, HANDLE, NOW)).toBeNull();
    expect(reads.launchReads).toEqual([]);
  });

  test('本人でないプロダクトはローンチも枠も読まずにnullを返す', async () => {
    const { reader, reads } = createPanelFakes({
      resolution: {
        kind: 'current',
        product: { ...PRODUCT, ownerUserId: OTHER_USER_ID },
      },
      entries: [entryOf(1, 'awaiting_payment')],
    });

    expect(await reader.readForOwner(VIEWER, HANDLE, NOW)).toBeNull();
    expect(reads.launchReads).toEqual([]);
    expect(reads.entryReads).toEqual([]);
  });

  test('旧ハンドルは本人のプロダクトでもnullを返す', async () => {
    const { reader } = createPanelFakes({
      resolution: { kind: 'previous', product: PRODUCT },
      entries: [entryOf(1, 'awaiting_payment')],
    });

    expect(await reader.readForOwner(VIEWER, HANDLE, NOW)).toBeNull();
  });

  test('枠の無いプロダクトはnullを返す', async () => {
    const { reader, reads } = createPanelFakes({ entries: [] });

    expect(await reader.readForOwner(VIEWER, HANDLE, NOW)).toBeNull();
    expect(reads.entryReads).toEqual([[launchIdOf(1)]]);
  });

  test('ローンチの無いプロダクトは枠を読まずにnullを返す', async () => {
    const { reader, reads } = createPanelFakes({ launches: [] });

    expect(await reader.readForOwner(VIEWER, HANDLE, NOW)).toBeNull();
    expect(reads.entryReads).toEqual([]);
  });

  test('取消を除いた直近のローンチの枠を返し、古いローンチの枠は返さない', async () => {
    const canceled = launchRecordOf(launchIdOf(3), productIdOf(1), {
      number: 0,
      launchDate: '2027-03-20' as LaunchRecord['launchDate'],
      status: 'canceled',
    });
    const latest = launchRecordOf(launchIdOf(2), productIdOf(1), {
      launchDate: '2027-03-17' as LaunchRecord['launchDate'],
      status: 'scheduled',
    });
    const { reader, reads } = createPanelFakes({
      launches: [canceled, latest, WON_LAUNCH],
      entries: [entryOf(1, 'awaiting_payment')],
    });

    expect(await reader.readForOwner(VIEWER, HANDLE, NOW)).toBeNull();
    expect(reads.launchReads).toEqual([
      { productIds: [productIdOf(1)], now: NOW },
    ]);
    expect(reads.entryReads).toEqual([[launchIdOf(2)]]);
  });

  test('直近のローンチの枠と週の行を返す', async () => {
    const entry = entryOf(1, 'awaiting_payment');
    const { reader, reads, tournament } = createPanelFakes({
      launches: [
        launchRecordOf(launchIdOf(9), productIdOf(1), { status: 'canceled' }),
        WON_LAUNCH,
      ],
      entries: [entry],
    });

    const panel = await reader.readForOwner(VIEWER, HANDLE, NOW);

    expect(panel?.entry).toEqual(entry);
    expect(panel?.tournament).toEqual(tournament ?? undefined);
    expect(reads.handleReads).toEqual([HANDLE]);
    expect(reads.tournamentReads).toEqual([TOURNAMENT_ID]);
  });

  test('枠の週の行が無ければ例外を投げる', async () => {
    const { reader } = createPanelFakes({
      entries: [entryOf(1, 'awaiting_payment')],
      tournament: null,
    });

    expect(await rejectionOf(reader.readForOwner(VIEWER, HANDLE, NOW))).toEqual(
      expect.any(Error),
    );
  });
});

describe('DirectoryWeekEntryPanelReader 免除と参加費', () => {
  test('受付中で特典の期間外なら免除せず、参加費とUltrasの案内を返す', async () => {
    const { reader, reads } = createPanelFakes({
      entries: [entryOf(1, 'awaiting_payment')],
    });

    const panel = await reader.readForOwner(VIEWER, HANDLE, NOW);

    expect(panel).toMatchObject({
      exempt: false,
      fee: { amount: 500, currency: 'usd' },
      ultrasGuide: true,
      progress: null,
    });
    expect(reads.entitlementReads).toEqual([
      { userId: OWNER_USER_ID, from: WON_AT, to: NOW },
    ]);
    expect(reads.priceReads).toEqual([[WEEK_ENTRY_PRICE_LOOKUP_KEY]]);
  });

  test('受付中で勝利の確定から現在までに特典を受けていれば免除し、参加費を読まない', async () => {
    const { reader, reads } = createPanelFakes({
      entries: [entryOf(1, 'awaiting_payment')],
      entitledDuring: true,
    });

    const panel = await reader.readForOwner(VIEWER, HANDLE, NOW);

    expect(panel).toMatchObject({
      exempt: true,
      fee: null,
      ultrasGuide: false,
    });
    expect(reads.priceReads).toEqual([]);
  });

  test('決済期限の後は特典の期間を保存した決済期限までで判定する', async () => {
    const { reader, reads } = createPanelFakes({
      entries: [entryOf(1, 'awaiting_payment')],
    });

    const panel = await reader.readForOwner(VIEWER, HANDLE, AFTER_DEADLINE);

    expect(reads.entitlementReads).toEqual([
      { userId: OWNER_USER_ID, from: WON_AT, to: STORED_DEADLINE_AT },
    ]);
    expect(panel).toMatchObject({
      exempt: false,
      fee: null,
      ultrasGuide: false,
    });
    expect(reads.priceReads).toEqual([]);
  });

  test('受付期限の後は決済を始められないため参加費を読まず、Ultrasの案内も出さない', async () => {
    const { reader, reads } = createPanelFakes({
      entries: [entryOf(1, 'awaiting_payment')],
    });

    const panel = await reader.readForOwner(VIEWER, HANDLE, AFTER_ACCEPT_UNTIL);

    expect(panel).toMatchObject({
      exempt: false,
      fee: null,
      ultrasGuide: false,
    });
    expect(reads.priceReads).toEqual([]);
  });

  test('決済期限の後に確定した勝利の受付中の枠は特典を問い合わせずに免除しない', async () => {
    const lateWonAt = new Date(STORED_DEADLINE_AT.getTime() + 1);
    const { reader, reads } = createPanelFakes({
      entries: [entryOf(1, 'awaiting_payment', { wonAt: lateWonAt })],
    });

    const panel = await reader.readForOwner(
      VIEWER,
      HANDLE,
      new Date(lateWonAt.getTime() + 60_000),
    );

    expect(panel?.exempt).toBe(false);
    expect(reads.entitlementReads).toEqual([]);
  });

  test('Ultrasの出どころで資格を得た枠は特典を問い合わせずに免除とする', async () => {
    const { reader, reads } = createPanelFakes({
      entries: [entryOf(1, 'entitled', { entitlementSource: 'ultras' })],
    });

    const panel = await reader.readForOwner(VIEWER, HANDLE, NOW);

    expect(panel).toMatchObject({
      exempt: true,
      fee: null,
      ultrasGuide: false,
    });
    expect(reads.entitlementReads).toEqual([]);
    expect(reads.priceReads).toEqual([]);
  });

  test('組み合わせに入ったUltrasの出どころの枠も免除とする', async () => {
    const { reader } = createPanelFakes({
      entries: [entryOf(1, 'drawn', { entitlementSource: 'ultras' })],
      tournament: tournamentOf({ status: 'drawing' }),
    });

    expect((await reader.readForOwner(VIEWER, HANDLE, NOW))?.exempt).toBe(true);
  });

  test('決済で資格を得た枠は免除とせず、特典も参加費も読まない', async () => {
    const { reader, reads } = createPanelFakes({
      entries: [entryOf(1, 'entitled', { entitlementSource: 'payment' })],
    });

    const panel = await reader.readForOwner(VIEWER, HANDLE, NOW);

    expect(panel).toMatchObject({ exempt: false, fee: null, progress: null });
    expect(reads.entitlementReads).toEqual([]);
    expect(reads.priceReads).toEqual([]);
  });

  test.each(['expired', 'forfeited', 'excluded'] as const)(
    '%sの枠は免除とせず、参加費も進行も返さない',
    async (status) => {
      const { reader, reads } = createPanelFakes({
        entries: [entryOf(1, status)],
      });

      const panel = await reader.readForOwner(VIEWER, HANDLE, NOW);

      expect(panel).toMatchObject({
        exempt: false,
        fee: null,
        ultrasGuide: false,
        progress: null,
      });
      expect(reads.entitlementReads).toEqual([]);
    },
  );

  test('決済サービスに到達できず保持した価格も無ければ、参加費をnullにして縮退する', async () => {
    const { reader } = createPanelFakes({
      entries: [entryOf(1, 'awaiting_payment')],
      prices: PAYMENTS_UNAVAILABLE,
    });

    const panel = await reader.readForOwner(VIEWER, HANDLE, NOW);

    expect(panel).toMatchObject({
      exempt: false,
      fee: null,
      ultrasGuide: true,
    });
  });

  test('照会の結果に参加費の価格が無ければ参加費をnullにする', async () => {
    const { reader } = createPanelFakes({
      entries: [entryOf(1, 'awaiting_payment')],
      prices: {
        prices: [{ ...ENTRY_PRICE, lookupKey: 'ultras_monthly' }],
        stale: false,
      },
    });

    expect((await reader.readForOwner(VIEWER, HANDLE, NOW))?.fee).toBeNull();
  });

  test('以前に照会した価格でも参加費として返す', async () => {
    const { reader } = createPanelFakes({
      entries: [entryOf(1, 'awaiting_payment')],
      prices: { prices: [ENTRY_PRICE], stale: true },
    });

    expect((await reader.readForOwner(VIEWER, HANDLE, NOW))?.fee).toEqual({
      amount: 500,
      currency: 'usd',
    });
  });

  test('決済サービスの到達の失敗以外の価格の照会の失敗はそのまま投げる', async () => {
    const failure = new Error('想定外の失敗');
    const { reader } = createPanelFakes({
      entries: [entryOf(1, 'awaiting_payment')],
      prices: failure,
    });

    expect(await rejectionOf(reader.readForOwner(VIEWER, HANDLE, NOW))).toBe(
      failure,
    );
  });
});

describe('DirectoryWeekEntryPanelReader 進行', () => {
  const IN_PROGRESS = tournamentOf({
    status: 'in_progress',
    drawStartedAt: new Date('2027-03-09T07:45:00.000Z'),
    bracketId: '01JF0WBRKT0000000000000001',
  });
  const FIRST_ROUND_DATE = '2027-03-09' as LaunchRecord['launchDate'];
  const DURING_FIRST_ROUND = new Date('2027-03-10T03:00:00.000Z');

  test('勝ち残りの枠は勝ち残りの進行を返す', async () => {
    const { reader, reads } = createPanelFakes({
      entries: [entryOf(1, 'drawn', { entitlementSource: 'payment' })],
      tournament: IN_PROGRESS,
      standings: new Map([[entryIdOf(1), standingOf(8, { participantNo: 3 })]]),
    });

    const panel = await reader.readForOwner(VIEWER, HANDLE, DURING_FIRST_ROUND);

    expect(panel?.progress).toEqual({
      alive: true,
      eliminatedRound: null,
      eliminatedRoundName: null,
      champion: false,
    });
    expect(reads.standingReads).toEqual([
      { kind: 'week', refs: [entryIdOf(1)] },
    ]);
    expect(reads.matchReads).toEqual([
      { launchIds: [launchIdOf(1)], now: DURING_FIRST_ROUND },
    ]);
  });

  test('ブラケットに敗退が記録された枠は敗退のラウンドとラウンド名を返す', async () => {
    const { reader, reads } = createPanelFakes({
      entries: [entryOf(1, 'drawn', { entitlementSource: 'payment' })],
      tournament: IN_PROGRESS,
      standings: new Map([
        [entryIdOf(1), standingOf(13, { eliminatedRound: 2 })],
      ]),
    });

    const panel = await reader.readForOwner(VIEWER, HANDLE, NOW);

    expect(panel?.progress).toEqual({
      alive: false,
      eliminatedRound: 2,
      eliminatedRoundName: '準々決勝',
      champion: false,
    });
    expect(reads.matchReads).toEqual([]);
  });

  test('ブラケットへの記録の前でも、直近のWeekのマッチで負けが確定していれば敗退とする', async () => {
    const at = new Date('2027-03-10T12:00:00.000Z');
    const { reader } = createPanelFakes({
      entries: [entryOf(1, 'drawn', { entitlementSource: 'payment' })],
      tournament: IN_PROGRESS,
      standings: new Map([[entryIdOf(1), standingOf(8, { participantNo: 3 })]]),
      matches: new Map([
        [
          launchIdOf(1),
          [
            weekMatchOf({
              index: 1,
              launch: 1,
              round: 1,
              date: FIRST_ROUND_DATE,
              now: at,
              result: 'lost',
            }),
          ],
        ],
      ]),
    });

    const panel = await reader.readForOwner(VIEWER, HANDLE, at);

    expect(panel?.progress).toEqual({
      alive: false,
      eliminatedRound: 1,
      eliminatedRoundName: '準々決勝',
      champion: false,
    });
  });

  test('直近のWeekのマッチで勝ちが確定していれば勝ち残りとする', async () => {
    const at = new Date('2027-03-10T12:00:00.000Z');
    const { reader } = createPanelFakes({
      entries: [entryOf(1, 'drawn', { entitlementSource: 'payment' })],
      tournament: IN_PROGRESS,
      standings: new Map([[entryIdOf(1), standingOf(8, { participantNo: 3 })]]),
      matches: new Map([
        [
          launchIdOf(1),
          [
            weekMatchOf({
              index: 1,
              launch: 1,
              round: 1,
              date: FIRST_ROUND_DATE,
              now: at,
              result: 'won',
            }),
          ],
        ],
      ]),
    });

    expect((await reader.readForOwner(VIEWER, HANDLE, at))?.progress).toEqual({
      alive: true,
      eliminatedRound: null,
      eliminatedRoundName: null,
      champion: false,
    });
  });

  test('受賞が記録された週の優勝の枠は優勝の進行を返す', async () => {
    const { reader, reads } = createPanelFakes({
      entries: [entryOf(1, 'drawn', { entitlementSource: 'payment' })],
      tournament: tournamentOf({
        ...IN_PROGRESS,
        status: 'finished',
        outcome: 'awarded',
        championEntryId: entryIdOf(1),
        awardedAt: new Date('2027-03-12T07:45:00.000Z'),
      }),
      standings: new Map([
        [entryIdOf(1), standingOf(8, { status: 'finished', champion: true })],
      ]),
    });

    const panel = await reader.readForOwner(VIEWER, HANDLE, NOW);

    expect(panel?.progress).toEqual({
      alive: false,
      eliminatedRound: null,
      eliminatedRoundName: null,
      champion: true,
    });
    expect(reads.standingReads).toEqual([]);
  });

  test('決勝で勝っても週の受賞の記録の前は優勝とせず、勝ち残りにもしない', async () => {
    const { reader, reads } = createPanelFakes({
      entries: [entryOf(1, 'drawn', { entitlementSource: 'payment' })],
      tournament: IN_PROGRESS,
      standings: new Map([
        [entryIdOf(1), standingOf(8, { status: 'finished', champion: true })],
      ]),
    });

    const panel = await reader.readForOwner(VIEWER, HANDLE, NOW);

    expect(panel?.progress).toEqual({
      alive: false,
      eliminatedRound: null,
      eliminatedRoundName: null,
      champion: false,
    });
    expect(reads.matchReads).toEqual([]);
  });

  test('組み合わせを書き終える前の組み合わせ決定中の週は勝ち残りとする', async () => {
    const { reader } = createPanelFakes({
      entries: [entryOf(1, 'drawn', { entitlementSource: 'payment' })],
      tournament: tournamentOf({
        status: 'drawing',
        drawStartedAt: new Date('2027-03-09T07:45:00.000Z'),
      }),
    });

    expect((await reader.readForOwner(VIEWER, HANDLE, NOW))?.progress).toEqual({
      alive: true,
      eliminatedRound: null,
      eliminatedRoundName: null,
      champion: false,
    });
  });
});
