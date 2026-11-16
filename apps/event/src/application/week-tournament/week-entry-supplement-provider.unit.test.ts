import { describe, expect, test } from 'bun:test';

import { countGraphemes } from '../../../common-lib/text/graphemes.ts';
import type { EntryResult } from '../../../lib/core/match/match-model.ts';
import {
  RESULT_NOTICE_SUPPLEMENT_LIMITS,
  type ResultNoticeSupplement,
  type ResultNoticeSupplementInput,
  resultNoticeSupplementSchema,
} from '../../../lib/core/notifications/result-notice-supplements.ts';
import type {
  ProductDirectory,
  ProductLookupScope,
  ProductSummaryRecord,
} from '../../../lib/core/product/ports.ts';
import { parseBusinessDate } from '../../../lib/core/time/business-time.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type {
  WeekEntryRecord,
  WeekTournamentRecord,
  WeekTournamentStore,
} from '../../../lib/core/week-tournament/ports.ts';
import type {
  WeekEntitlementSource,
  WeekEntryStatus,
} from '../../../lib/core/week-tournament/week-entry-rules.ts';
import { WeekEntrySupplementProvider } from './week-entry-supplement-provider.ts';

const CLIENT_SITE_ORIGIN = 'https://launch-stadium.example';

const MATCH_ID = '01JD0MTCH00000000000000001';

const TOURNAMENT_ID = '01JD0WTRN00000000000000001';

const ENTRY_ID = '01JD0WENT00000000000000001';

const LAUNCH_ID = '01JD01NCH00000000000000001';

const PRODUCT_ID = '01JD0PR0D00000000000000001';

const OWNER_USER_ID = '01JD0USER00000000000000001';

const WEEK_START = parseBusinessDate('2026-11-16');

const WEDNESDAY = parseBusinessDate('2026-11-18');

const SUNDAY = parseBusinessDate('2026-11-22');

const DECIDED_AT = new Date('2026-11-19T07:40:05.000Z');

// 保存した列は作成時の計算から書き換えられ得るため、計算の値(11月24日07:00・07:35・07:45)と違う時刻にして保存した列を読むことを確かめる
const STORED_WINDOW = Object.freeze({
  weekStart: WEEK_START,
  acceptUntil: new Date('2026-11-24T06:00:00.000Z'),
  deadlineAt: new Date('2026-11-24T06:35:00.000Z'),
  drawAt: new Date('2026-11-24T06:45:00.000Z'),
});

const BEFORE_ACCEPT_UNTIL = new Date('2026-11-24T05:59:59.999Z');

const SENT_AT = new Date('2026-11-19T07:55:00.000Z');

const ULTRAS_SUPPLEMENT: ResultNoticeSupplement = Object.freeze({
  title: 'Weekトーナメントの参加資格を得ました',
  lines: [
    'Ultrasの特典により参加費は免除されます。参加のための操作は不要です。',
    '組み合わせは11月24日06:45(UTC)に決定します。',
  ],
  emphasized: false,
});

function paymentSupplementOf(
  acceptUntilText: string,
  options: {
    readonly emphasized?: boolean;
    readonly actionUrl?: string | null;
  } = {},
): ResultNoticeSupplement {
  const actionUrl =
    options.actionUrl === undefined
      ? `${CLIENT_SITE_ORIGIN}/p/week-product`
      : options.actionUrl;
  return {
    title: 'Weekトーナメントに参加できます',
    lines: [
      `参加費の決済期限: ${acceptUntilText}`,
      '期限までに決済すると、Product of the Weekを決めるトーナメントに参加できます。',
    ],
    ...(actionUrl === null
      ? {}
      : { action: { label: '参加費を支払う', url: actionUrl } }),
    emphasized: options.emphasized ?? false,
  };
}

function inputOf(
  columns: Partial<ResultNoticeSupplementInput> = {},
): ResultNoticeSupplementInput {
  return {
    matchId: MATCH_ID,
    kind: 'qualifier',
    round: null,
    stage: null,
    matchDate: WEDNESDAY,
    entryId: '01JD0ENTR00000000000000001',
    launchId: LAUNCH_ID,
    productId: PRODUCT_ID,
    ownerUserId: OWNER_USER_ID,
    result: 'won',
    decidedAt: DECIDED_AT,
    ...columns,
  };
}

function entryOf(
  status: WeekEntryStatus,
  entitlementSource: WeekEntitlementSource | null = null,
): WeekEntryRecord {
  return {
    entryId: ENTRY_ID,
    tournamentId: TOURNAMENT_ID,
    launchId: LAUNCH_ID,
    productId: PRODUCT_ID,
    ownerUserId: OWNER_USER_ID,
    launchDate: WEDNESDAY,
    qualifierUpvoteCount: 12,
    qualifierLastUpvoteElapsedMs: 3_600_000,
    wonAt: DECIDED_AT,
    status,
    entitlementSource,
    purchaseId: null,
    closeReason: null,
    refundStatus: 'none',
    refundNoticeStatus: 'none',
  };
}

function tournamentOf(): WeekTournamentRecord {
  return {
    tournamentId: TOURNAMENT_ID,
    window: STORED_WINDOW,
    status: 'open',
    drawStartedAt: null,
    bracketId: null,
    outcome: null,
    championEntryId: null,
    awardedAt: null,
  };
}

function productOf(handle = 'week-product'): ProductSummaryRecord {
  return {
    productId: PRODUCT_ID,
    ownerUserId: OWNER_USER_ID,
    handle,
    name: 'Week Product',
    tagline: '週のトーナメントに挑むプロダクト',
    category: {
      id: '01JD0CTGR00000000000000001',
      name: '開発ツール',
      handle: 'developer-tools',
    },
    websiteUrl: 'https://week-product.example',
    logoFileId: '01JD0F1LE00000000000000001',
    hidden: false,
    visible: true,
    listed: true,
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
  };
}

function notUsed(): never {
  throw new Error('結果通知の追記はこの操作を使わない');
}

interface Scenario {
  readonly entry?: WeekEntryRecord;
  readonly tournament?: WeekTournamentRecord;
  readonly product?: ProductSummaryRecord;
  readonly now?: Date;
  readonly failure?: Error;
}

interface Calls {
  readonly entryLookups: (readonly string[])[];
  readonly tournamentLookups: string[];
  readonly weekLookups: string[];
  readonly productLookups: {
    readonly productIds: readonly string[];
    readonly scope: ProductLookupScope;
  }[];
}

interface Harness {
  readonly provider: WeekEntrySupplementProvider;
  readonly calls: Calls;
}

function createHarness(scenario: Scenario = {}): Harness {
  const calls: Calls = {
    entryLookups: [],
    tournamentLookups: [],
    weekLookups: [],
    productLookups: [],
  };
  const respond = <T>(value: T): Promise<T> =>
    scenario.failure === undefined
      ? Promise.resolve(value)
      : Promise.reject(scenario.failure);
  const store: WeekTournamentStore = {
    ensureTournament: notUsed,
    findTournament: (tournamentId) => {
      calls.tournamentLookups.push(tournamentId);
      return respond(
        scenario.tournament?.tournamentId === tournamentId
          ? scenario.tournament
          : undefined,
      );
    },
    findTournamentByWeek: (weekStart) => {
      calls.weekLookups.push(weekStart);
      return respond(
        scenario.tournament?.window.weekStart === weekStart
          ? scenario.tournament
          : undefined,
      );
    },
    listDue: notUsed,
    listInProgress: notUsed,
    findEntriesByLaunch: (launchIds) => {
      calls.entryLookups.push(launchIds);
      const entry = scenario.entry;
      return respond(
        new Map(
          entry?.launchId != null && launchIds.includes(entry.launchId)
            ? [[entry.launchId, entry]]
            : [],
        ),
      );
    },
    findEntry: notUsed,
    listLaunchIdsByProduct: notUsed,
    listEntriesForClassification: notUsed,
    listDrawnEntries: notUsed,
    insertEntry: notUsed,
    grantByUltras: notUsed,
    forfeitByProduct: notUsed,
    forfeitByOwner: notUsed,
    freeze: notUsed,
    classify: notUsed,
    markDrawn: notUsed,
    recordFinish: notUsed,
    listAwardedBetween: notUsed,
    listPendingFollowUps: notUsed,
    listPendingFollowUpsOf: notUsed,
    markRefundRequested: notUsed,
    markRefundClosed: notUsed,
    markNotice: notUsed,
    unlinkOrDeleteByProduct: notUsed,
  };
  const products: ProductDirectory = {
    findSummaries: (productIds, scope) => {
      calls.productLookups.push({ productIds, scope });
      const product = scenario.product;
      return respond(
        new Map(
          product !== undefined && productIds.includes(product.productId)
            ? [[product.productId, product]]
            : [],
        ),
      );
    },
    resolveHandle: notUsed,
    findDetail: notUsed,
    listLaunches: notUsed,
  };
  const now = scenario.now ?? SENT_AT;
  const clock: Clock = { now: () => now };
  return {
    provider: new WeekEntrySupplementProvider({
      store,
      products,
      clock,
      clientSiteOrigin: CLIENT_SITE_ORIGIN,
    }),
    calls,
  };
}

describe('WeekEntrySupplementProvider', () => {
  describe('Ultrasの特典で参加資格を得た枠', () => {
    test('免除の旨と保存した組み合わせ決定の日時を追記し、強調も導線も付けない', async () => {
      const { provider, calls } = createHarness({
        entry: entryOf('entitled', 'ultras'),
        tournament: tournamentOf(),
        product: productOf(),
      });

      const supplement = await provider.supplementFor(inputOf());

      expect(supplement).toEqual(ULTRAS_SUPPLEMENT);
      expect(calls.entryLookups).toEqual([[LAUNCH_ID]]);
      expect(calls.tournamentLookups).toEqual([TOURNAMENT_ID]);
      expect(calls.productLookups).toEqual([]);
    });

    test('日曜日のローンチでも強調しない', async () => {
      const { provider } = createHarness({
        entry: entryOf('entitled', 'ultras'),
        tournament: tournamentOf(),
      });

      const supplement = await provider.supplementFor(
        inputOf({ matchDate: SUNDAY }),
      );

      expect(supplement).toEqual(ULTRAS_SUPPLEMENT);
    });
  });

  describe('受付中の枠', () => {
    test('保存した受付期限をUTCで表記した決済期限と、プロダクト詳細への参加の導線を追記する', async () => {
      const { provider, calls } = createHarness({
        entry: entryOf('awaiting_payment'),
        tournament: tournamentOf(),
        product: productOf(),
      });

      const supplement = await provider.supplementFor(inputOf());

      expect(supplement).toEqual(paymentSupplementOf('11月24日06:00(UTC)'));
      expect(calls.tournamentLookups).toEqual([TOURNAMENT_ID]);
      expect(calls.productLookups).toEqual([
        { productIds: [PRODUCT_ID], scope: 'visible' },
      ]);
    });

    test('日曜日のローンチでは期限を強調する', async () => {
      const { provider } = createHarness({
        entry: { ...entryOf('awaiting_payment'), launchDate: SUNDAY },
        tournament: tournamentOf(),
        product: productOf(),
      });

      const supplement = await provider.supplementFor(
        inputOf({ matchDate: SUNDAY }),
      );

      expect(supplement).toEqual(
        paymentSupplementOf('11月24日06:00(UTC)', { emphasized: true }),
      );
    });

    test('プロダクトを表示できなければ参加の導線を省く', async () => {
      const { provider, calls } = createHarness({
        entry: entryOf('awaiting_payment'),
        tournament: tournamentOf(),
      });

      const supplement = await provider.supplementFor(inputOf());

      expect(supplement).toEqual(
        paymentSupplementOf('11月24日06:00(UTC)', { actionUrl: null }),
      );
      expect(calls.productLookups).toEqual([
        { productIds: [PRODUCT_ID], scope: 'visible' },
      ]);
    });

    test('導線のハンドルはURLのパスとして符号化する', async () => {
      const { provider } = createHarness({
        entry: entryOf('awaiting_payment'),
        tournament: tournamentOf(),
        product: productOf('week product'),
      });

      const supplement = await provider.supplementFor(inputOf());

      expect(supplement?.action?.url).toBe(
        `${CLIENT_SITE_ORIGIN}/p/week%20product`,
      );
    });

    test('受付期限の直前まで追記し、受付期限ちょうどとその後は追記しない', async () => {
      const before = createHarness({
        entry: entryOf('awaiting_payment'),
        tournament: tournamentOf(),
        product: productOf(),
        now: BEFORE_ACCEPT_UNTIL,
      });
      const atDeadline = createHarness({
        entry: entryOf('awaiting_payment'),
        tournament: tournamentOf(),
        product: productOf(),
        now: STORED_WINDOW.acceptUntil,
      });
      const after = createHarness({
        entry: entryOf('awaiting_payment'),
        tournament: tournamentOf(),
        product: productOf(),
        now: new Date('2026-11-24T06:10:00.000Z'),
      });

      const supplements = await Promise.all([
        before.provider.supplementFor(inputOf()),
        atDeadline.provider.supplementFor(inputOf()),
        after.provider.supplementFor(inputOf()),
      ]);

      expect(supplements).toEqual([
        paymentSupplementOf('11月24日06:00(UTC)'),
        undefined,
        undefined,
      ]);
      expect(atDeadline.calls.productLookups).toEqual([]);
      expect(after.calls.productLookups).toEqual([]);
    });
  });

  describe('枠の作成前', () => {
    test('予選の週の保存した受付期限で、受付中と同じ追記をする', async () => {
      const { provider, calls } = createHarness({
        tournament: tournamentOf(),
        product: productOf(),
      });

      const supplement = await provider.supplementFor(inputOf());

      expect(supplement).toEqual(paymentSupplementOf('11月24日06:00(UTC)'));
      expect(calls.weekLookups).toEqual([WEEK_START]);
      expect(calls.tournamentLookups).toEqual([]);
    });

    test('週の記録も無ければ、その週の規則の受付期限を使う', async () => {
      const { provider } = createHarness({ product: productOf() });

      const supplement = await provider.supplementFor(
        inputOf({ matchDate: SUNDAY }),
      );

      expect(supplement).toEqual(
        paymentSupplementOf('11月24日07:00(UTC)', { emphasized: true }),
      );
    });

    test('規則の受付期限を過ぎていれば追記しない', async () => {
      const { provider } = createHarness({
        product: productOf(),
        now: new Date('2026-11-24T07:00:00.000Z'),
      });

      const supplement = await provider.supplementFor(inputOf());

      expect(supplement).toBeUndefined();
    });
  });

  describe('追記しない場合', () => {
    test.each<EntryResult>(['lost'])(
      '結果が%sなら照会せずに追記しない',
      async (result) => {
        const { provider, calls } = createHarness({
          entry: entryOf('awaiting_payment'),
          tournament: tournamentOf(),
          product: productOf(),
        });

        const supplement = await provider.supplementFor(inputOf({ result }));

        expect(supplement).toBeUndefined();
        expect(calls.entryLookups).toEqual([]);
      },
    );

    test.each<EntryResult>(['bye', 'walkover'])(
      '結果が%sの勝利なら追記する',
      async (result) => {
        const { provider } = createHarness({
          entry: entryOf('awaiting_payment'),
          tournament: tournamentOf(),
          product: productOf(),
        });

        const supplement = await provider.supplementFor(inputOf({ result }));

        expect(supplement).toEqual(paymentSupplementOf('11月24日06:00(UTC)'));
      },
    );

    test('ローンチの無い勝利は照会せずに追記しない', async () => {
      const { provider, calls } = createHarness({
        entry: entryOf('awaiting_payment'),
        tournament: tournamentOf(),
        product: productOf(),
      });

      const supplement = await provider.supplementFor(
        inputOf({ launchId: null }),
      );

      expect(supplement).toBeUndefined();
      expect(calls.entryLookups).toEqual([]);
    });

    test('予選でないマッチは照会せずに追記しない', async () => {
      const { provider, calls } = createHarness({
        entry: entryOf('awaiting_payment'),
        tournament: tournamentOf(),
        product: productOf(),
      });

      const supplement = await provider.supplementFor(
        inputOf({ kind: 'week', round: 1, stage: null }),
      );

      expect(supplement).toBeUndefined();
      expect(calls.entryLookups).toEqual([]);
    });

    test.each<[string, WeekEntryStatus, WeekEntitlementSource | null]>([
      ['決済で参加資格を得た枠', 'entitled', 'payment'],
      ['組み合わせ決定の後に勝利した期限切れの枠', 'expired', null],
      ['参加資格を失った枠', 'forfeited', null],
      ['組み合わせ決定で除外した枠', 'excluded', null],
      ['組み合わせに入った枠', 'drawn', 'ultras'],
    ])('%sには追記しない', async (_label, status, entitlementSource) => {
      const { provider, calls } = createHarness({
        entry: entryOf(status, entitlementSource),
        tournament: tournamentOf(),
        product: productOf(),
      });

      const supplement = await provider.supplementFor(inputOf());

      expect(supplement).toBeUndefined();
      expect(calls.tournamentLookups).toEqual([]);
      expect(calls.productLookups).toEqual([]);
    });
  });

  test('照会の失敗は捕まえずに投げ、送り出しの段の再試行に任せる', async () => {
    const failure = new Error('D1の読み取りに失敗しました');
    const { provider } = createHarness({ failure });

    const caught = await provider
      .supplementFor(inputOf())
      .catch((thrown: unknown) => thrown);

    expect(caught).toBe(failure);
  });

  describe('追記の長さの上限', () => {
    test.each<[string, Scenario, Partial<ResultNoticeSupplementInput>]>([
      [
        'Ultrasの免除',
        { entry: entryOf('entitled', 'ultras'), tournament: tournamentOf() },
        {},
      ],
      [
        '受付中で導線あり',
        {
          entry: entryOf('awaiting_payment'),
          tournament: tournamentOf(),
          product: productOf(),
        },
        { matchDate: SUNDAY },
      ],
      [
        '受付中で導線なし',
        { entry: entryOf('awaiting_payment'), tournament: tournamentOf() },
        {},
      ],
    ])(
      '%sの追記が見出し・行数・各行・ボタンの上限に収まり、形式の検証を通る',
      async (_label, scenario, columns) => {
        const { provider } = createHarness(scenario);

        const supplement = await provider.supplementFor(inputOf(columns));

        if (supplement === undefined) {
          throw new Error('追記が返されなかった');
        }
        const limits = RESULT_NOTICE_SUPPLEMENT_LIMITS;
        expect(countGraphemes(supplement.title)).toBeLessThanOrEqual(
          limits.titleGraphemes,
        );
        expect(supplement.lines.length).toBeGreaterThanOrEqual(limits.minLines);
        expect(supplement.lines.length).toBeLessThanOrEqual(limits.maxLines);
        for (const line of supplement.lines) {
          expect(countGraphemes(line)).toBeLessThanOrEqual(
            limits.lineGraphemes,
          );
        }
        if (supplement.action !== undefined) {
          expect(countGraphemes(supplement.action.label)).toBeLessThanOrEqual(
            limits.actionLabelGraphemes,
          );
        }
        expect(resultNoticeSupplementSchema.parse(supplement)).toEqual(
          supplement,
        );
      },
    );
  });
});
