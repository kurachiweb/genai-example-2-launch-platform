import { describe, expect, test } from 'bun:test';

import { countGraphemes } from '../../../common-lib/text/graphemes.ts';
import type {
  EntryResult,
  MatchKind,
} from '../../../lib/core/match/match-model.ts';
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
import {
  type BusinessDate,
  parseBusinessDate,
} from '../../../lib/core/time/business-time.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type {
  YearCalendar,
  YearEntryRecord,
  YearEntryStore,
} from '../../../lib/core/year-tournament/ports.ts';
import type {
  YearEntitlementSource,
  YearEntryStatus,
} from '../../../lib/core/year-tournament/year-entry-rules.ts';
import { yearScheduleFor } from '../../../lib/core/year-tournament/year-schedule.ts';
import type { TargetYearResolution } from '../../../lib/core/year-tournament/year-target-rules.ts';
import { YearEntrySupplementProvider } from './year-entry-supplement-provider.ts';

const CLIENT_SITE_ORIGIN = 'https://launch-stadium.example';

const MATCH_ID = '01JD0MTCH00000000000000001';

const ENTRY_ID = '01JD0YENT00000000000000001';

const LAUNCH_ID = '01JD01NCH00000000000000001';

const PRODUCT_ID = '01JD0PR0D00000000000000001';

const OWNER_USER_ID = '01JD0USER00000000000000001';

const WEEK_FINAL_DATE = parseBusinessDate('2027-02-28');

const AWARDED_AT = new Date('2027-03-01T07:40:05.000Z');

// 既定の日(5月30日)と違う決勝日にして、暦が返した対象年の期限を読むことを確かめる
const SCHEDULE = yearScheduleFor(2027, parseBusinessDate('2027-05-16'));

const OPEN_RESOLUTION: TargetYearResolution = Object.freeze({
  kind: 'open',
  year: Object.freeze({
    year: 2027,
    schedule: SCHEDULE,
    source: 'explicit',
    state: 'open',
  }),
});

const LATE_RESOLUTION: TargetYearResolution = Object.freeze({
  kind: 'late',
  year: 2027,
});

// 結果通知の送り出しはWeek決勝の夜の23:45の後に始まる
const SENT_AT = new Date('2027-03-01T07:55:00.000Z');

const ULTRAS_SUPPLEMENT: ResultNoticeSupplement = Object.freeze({
  title: 'Yearトーナメントの参加資格を得ました',
  lines: [
    'Ultrasの特典により参加費は免除されます。参加のための操作は不要です。',
    '組み合わせは5月11日07:45(UTC)に決定します。',
  ],
  emphasized: false,
});

function paymentSupplementOf(
  options: { readonly actionUrl?: string | null } = {},
): ResultNoticeSupplement {
  const actionUrl =
    options.actionUrl === undefined
      ? `${CLIENT_SITE_ORIGIN}/p/year-product`
      : options.actionUrl;
  return {
    title: 'Yearトーナメントに参加できます',
    lines: [
      '参加費の決済期限: 5月11日07:00(UTC)',
      '期限までに決済すると、2027年のProduct of the Yearを決めるトーナメントに参加できます。決勝は2027年5月16日(日)です。',
    ],
    ...(actionUrl === null
      ? {}
      : { action: { label: '参加費を支払う', url: actionUrl } }),
    emphasized: false,
  };
}

function inputOf(
  columns: Partial<ResultNoticeSupplementInput> = {},
): ResultNoticeSupplementInput {
  return {
    matchId: MATCH_ID,
    kind: 'week',
    round: 3,
    stage: 'final',
    matchDate: WEEK_FINAL_DATE,
    entryId: '01JD0ENTR00000000000000001',
    launchId: LAUNCH_ID,
    productId: PRODUCT_ID,
    ownerUserId: OWNER_USER_ID,
    result: 'won',
    decidedAt: AWARDED_AT,
    ...columns,
  };
}

function entryOf(
  status: YearEntryStatus,
  entitlementSource: YearEntitlementSource | null = null,
): YearEntryRecord {
  return {
    entryId: ENTRY_ID,
    weekTournamentId: '01JD0WTRN00000000000000001',
    weekPeriod: '2027-W08',
    launchId: LAUNCH_ID,
    productId: PRODUCT_ID,
    ownerUserId: OWNER_USER_ID,
    launchDate: parseBusinessDate('2027-02-22'),
    qualifierUpvoteCount: 12,
    qualifierLastUpvoteElapsedMs: 3_600_000,
    awardedAt: AWARDED_AT,
    awardedDate: WEEK_FINAL_DATE,
    status,
    entitlementSource,
    purchaseId:
      entitlementSource === 'payment' ? '01JD0PRCH00000000000000001' : null,
    closeReason: null,
    classifiedYear: null,
    refundStatus: 'none',
    refundNoticeStatus: 'none',
  };
}

function productOf(handle = 'year-product'): ProductSummaryRecord {
  return {
    productId: PRODUCT_ID,
    ownerUserId: OWNER_USER_ID,
    handle,
    name: 'Year Product',
    tagline: '年のトーナメントに挑むプロダクト',
    category: {
      id: '01JD0CTGR00000000000000001',
      name: '開発ツール',
      handle: 'developer-tools',
    },
    websiteUrl: 'https://year-product.example',
    logoFileId: '01JD0F1LE00000000000000001',
    hidden: false,
    visible: true,
    listed: true,
    createdAt: new Date('2027-01-01T00:00:00.000Z'),
  };
}

function notUsed(): never {
  throw new Error('Yearトーナメントの結果通知の追記はこの操作を使わない');
}

interface Scenario {
  readonly entry?: YearEntryRecord;
  readonly resolution?: TargetYearResolution;
  readonly product?: ProductSummaryRecord;
  readonly now?: Date;
  readonly failure?: Error;
}

interface Calls {
  readonly entryLookups: (readonly string[])[];
  readonly awardResolutions: {
    readonly awardedDate: BusinessDate;
    readonly now: Date;
  }[];
  readonly productLookups: {
    readonly productIds: readonly string[];
    readonly scope: ProductLookupScope;
  }[];
}

interface Harness {
  readonly provider: YearEntrySupplementProvider;
  readonly calls: Calls;
}

function createHarness(scenario: Scenario = {}): Harness {
  const calls: Calls = {
    entryLookups: [],
    awardResolutions: [],
    productLookups: [],
  };
  const respond = <T>(value: T): Promise<T> =>
    scenario.failure === undefined
      ? Promise.resolve(value)
      : Promise.reject(scenario.failure);
  const store: YearEntryStore = {
    insertFromChampion: notUsed,
    findByWeekTournaments: notUsed,
    findByLaunches: (launchIds) => {
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
    listOpenByOwner: notUsed,
    listLaunchIdsByProduct: notUsed,
    listCandidates: notUsed,
    listDrawn: notUsed,
    grantByUltras: notUsed,
    forfeitByProduct: notUsed,
    forfeitByOwner: notUsed,
    classify: notUsed,
    excludeOverCapacity: notUsed,
    listPendingFollowUps: notUsed,
    markRefundRequested: notUsed,
    markRefundClosed: notUsed,
    markNotice: notUsed,
    unlinkOrDeleteByProduct: notUsed,
  };
  const calendar: YearCalendar = {
    describe: notUsed,
    resolveAward: (awardedDate, now) => {
      calls.awardResolutions.push({ awardedDate, now });
      return respond(scenario.resolution ?? OPEN_RESOLUTION);
    },
    upcoming: notUsed,
    ensureUpcoming: notUsed,
    openPeriodStart: notUsed,
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
    provider: new YearEntrySupplementProvider({
      store,
      calendar,
      products,
      clock,
      clientSiteOrigin: CLIENT_SITE_ORIGIN,
    }),
    calls,
  };
}

describe('YearEntrySupplementProvider', () => {
  describe('Ultrasの特典で参加資格を得た枠', () => {
    test('免除の旨と対象年の組み合わせ決定の日時を追記し、強調も導線も付けない', async () => {
      const { provider, calls } = createHarness({
        entry: entryOf('entitled', 'ultras'),
        product: productOf(),
      });

      const supplement = await provider.supplementFor(inputOf());

      expect(supplement).toEqual(ULTRAS_SUPPLEMENT);
      expect(calls.entryLookups).toEqual([[LAUNCH_ID]]);
      expect(calls.awardResolutions).toEqual([
        { awardedDate: WEEK_FINAL_DATE, now: SENT_AT },
      ]);
      expect(calls.productLookups).toEqual([]);
    });

    test('対象年が凍結済みなら追記しない', async () => {
      const { provider } = createHarness({
        entry: entryOf('entitled', 'ultras'),
        resolution: LATE_RESOLUTION,
      });

      const supplement = await provider.supplementFor(inputOf());

      expect(supplement).toBeUndefined();
    });
  });

  describe('受付中の枠', () => {
    test('受付期限をUTCで表記した決済期限と、対象年・決勝日・プロダクト詳細への参加の導線を追記し、強調しない', async () => {
      const { provider, calls } = createHarness({
        entry: entryOf('awaiting_payment'),
        product: productOf(),
      });

      const supplement = await provider.supplementFor(inputOf());

      expect(supplement).toEqual(paymentSupplementOf());
      expect(calls.awardResolutions).toEqual([
        { awardedDate: WEEK_FINAL_DATE, now: SENT_AT },
      ]);
      expect(calls.productLookups).toEqual([
        { productIds: [PRODUCT_ID], scope: 'visible' },
      ]);
    });

    test('プロダクトを表示できなければ参加の導線を省く', async () => {
      const { provider, calls } = createHarness({
        entry: entryOf('awaiting_payment'),
      });

      const supplement = await provider.supplementFor(inputOf());

      expect(supplement).toEqual(paymentSupplementOf({ actionUrl: null }));
      expect(calls.productLookups).toEqual([
        { productIds: [PRODUCT_ID], scope: 'visible' },
      ]);
    });

    test('導線のハンドルはURLのパスとして符号化する', async () => {
      const { provider } = createHarness({
        entry: entryOf('awaiting_payment'),
        product: productOf('year product'),
      });

      const supplement = await provider.supplementFor(inputOf());

      expect(supplement?.action?.url).toBe(
        `${CLIENT_SITE_ORIGIN}/p/year%20product`,
      );
    });

    test('受付期限の直前まで追記し、受付期限ちょうどとその後は追記しない', async () => {
      const scenarioAt = (now: Date): Scenario => ({
        entry: entryOf('awaiting_payment'),
        product: productOf(),
        now,
      });
      const before = createHarness(
        scenarioAt(new Date(SCHEDULE.acceptUntil.getTime() - 1)),
      );
      const atDeadline = createHarness(scenarioAt(SCHEDULE.acceptUntil));
      const after = createHarness(scenarioAt(SCHEDULE.deadlineAt));

      const supplements = await Promise.all([
        before.provider.supplementFor(inputOf()),
        atDeadline.provider.supplementFor(inputOf()),
        after.provider.supplementFor(inputOf()),
      ]);

      expect(supplements).toEqual([
        paymentSupplementOf(),
        undefined,
        undefined,
      ]);
      expect(atDeadline.calls.productLookups).toEqual([]);
      expect(after.calls.productLookups).toEqual([]);
    });

    test('対象年が凍結済みなら追記しない', async () => {
      const { provider, calls } = createHarness({
        entry: entryOf('awaiting_payment'),
        resolution: LATE_RESOLUTION,
        product: productOf(),
      });

      const supplement = await provider.supplementFor(inputOf());

      expect(supplement).toBeUndefined();
      expect(calls.productLookups).toEqual([]);
    });
  });

  describe('勝ち残りが1件になって優勝が決まった準決勝の勝利', () => {
    test.each<[string, YearEntryRecord, ResultNoticeSupplement]>([
      [
        'Ultrasの特典で参加資格を得た枠',
        entryOf('entitled', 'ultras'),
        ULTRAS_SUPPLEMENT,
      ],
      ['受付中の枠', entryOf('awaiting_payment'), paymentSupplementOf()],
    ])('%sがあれば追記する', async (_label, entry, expected) => {
      const { provider, calls } = createHarness({
        entry,
        product: productOf(),
      });

      const supplement = await provider.supplementFor(
        inputOf({ round: 2, stage: 'semifinal' }),
      );

      expect(supplement).toEqual(expected);
      expect(calls.entryLookups).toEqual([[LAUNCH_ID]]);
    });
  });

  describe('追記しない場合', () => {
    test('結果が敗北なら照会せずに追記しない', async () => {
      const { provider, calls } = createHarness({
        entry: entryOf('awaiting_payment'),
        product: productOf(),
      });

      const supplement = await provider.supplementFor(
        inputOf({ result: 'lost' }),
      );

      expect(supplement).toBeUndefined();
      expect(calls.entryLookups).toEqual([]);
    });

    test.each<EntryResult>(['bye', 'walkover'])(
      '決勝の結果が%sの勝利なら追記する',
      async (result) => {
        const { provider } = createHarness({
          entry: entryOf('awaiting_payment'),
          product: productOf(),
        });

        const supplement = await provider.supplementFor(inputOf({ result }));

        expect(supplement).toEqual(paymentSupplementOf());
      },
    );

    test.each<MatchKind>(['qualifier', 'year'])(
      '%sのマッチは照会せずに追記しない',
      async (kind) => {
        const { provider, calls } = createHarness({
          entry: entryOf('awaiting_payment'),
          product: productOf(),
        });

        const supplement = await provider.supplementFor(
          inputOf(
            kind === 'qualifier'
              ? { kind, round: null, stage: null }
              : { kind, stage: 'final' },
          ),
        );

        expect(supplement).toBeUndefined();
        expect(calls.entryLookups).toEqual([]);
      },
    );

    test('ローンチの無い勝利は照会せずに追記しない', async () => {
      const { provider, calls } = createHarness({
        entry: entryOf('awaiting_payment'),
        product: productOf(),
      });

      const supplement = await provider.supplementFor(
        inputOf({ launchId: null }),
      );

      expect(supplement).toBeUndefined();
      expect(calls.entryLookups).toEqual([]);
    });

    test('Week優勝の枠がまだ無ければ追記しない', async () => {
      const { provider, calls } = createHarness({ product: productOf() });

      const supplement = await provider.supplementFor(inputOf());

      expect(supplement).toBeUndefined();
      expect(calls.entryLookups).toEqual([[LAUNCH_ID]]);
      expect(calls.awardResolutions).toEqual([]);
      expect(calls.productLookups).toEqual([]);
    });

    test.each<[string, YearEntryStatus, YearEntitlementSource | null]>([
      ['決済で参加資格を得た枠', 'entitled', 'payment'],
      ['組み合わせに入った枠', 'drawn', 'ultras'],
      ['期限切れの枠', 'expired', null],
      ['参加資格を失った枠', 'forfeited', null],
      ['組み合わせ決定で除外した枠', 'excluded', null],
    ])('%sには追記しない', async (_label, status, entitlementSource) => {
      const { provider, calls } = createHarness({
        entry: entryOf(status, entitlementSource),
        product: productOf(),
      });

      const supplement = await provider.supplementFor(inputOf());

      expect(supplement).toBeUndefined();
      expect(calls.awardResolutions).toEqual([]);
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
    test.each<[string, Scenario]>([
      ['Ultrasの免除', { entry: entryOf('entitled', 'ultras') }],
      [
        '受付中で導線あり',
        { entry: entryOf('awaiting_payment'), product: productOf() },
      ],
      ['受付中で導線なし', { entry: entryOf('awaiting_payment') }],
    ])(
      '%sの追記が見出し・行数・各行・ボタンの上限に収まり、形式の検証を通る',
      async (_label, scenario) => {
        const { provider } = createHarness(scenario);

        const supplement = await provider.supplementFor(inputOf());

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
