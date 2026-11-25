import { describe, expect, test } from 'bun:test';

import {
  type BusinessDate,
  parseBusinessDate,
} from '../../../lib/core/time/business-time.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type { UltrasActivation } from '../../../lib/core/ultras/activation-contract.ts';
import type {
  YearCalendar,
  YearEntryRecord,
  YearEntryStore,
} from '../../../lib/core/year-tournament/ports.ts';
import {
  GRANTABLE_STATUSES,
  OPEN_ENTRY_STATUSES,
} from '../../../lib/core/year-tournament/year-entry-rules.ts';
import {
  defaultFinalDate,
  yearScheduleFor,
} from '../../../lib/core/year-tournament/year-schedule.ts';
import type { TargetYearResolution } from '../../../lib/core/year-tournament/year-target-rules.ts';
import { YearUltrasEntryExemptionHandler } from './year-ultras-entry-exemption-handler.ts';

const USER_ID = '01JD0USER00000000000000001';

const OTHER_USER_ID = '01JD0USER00000000000000002';

const OPEN_ENTRY_ID = '01JD0YENT00000000000000001';

const PAID_ENTRY_ID = '01JD0YENT00000000000000002';

const NEXT_YEAR_ENTRY_ID = '01JD0YENT00000000000000003';

const LATE_ENTRY_ID = '01JD0YENT00000000000000004';

const OTHER_USER_ENTRY_ID = '01JD0YENT00000000000000009';

const SCHEDULE_2027 = yearScheduleFor(2027, defaultFinalDate(2027));

const SCHEDULE_2028 = yearScheduleFor(2028, defaultFinalDate(2028));

const AWARDED_AT = new Date('2027-02-28T07:40:05.000Z');

const AWARDED_DATE = parseBusinessDate('2027-02-28');

// 2027年の決済期限日の後のWeek優勝は翌年が対象年になる
const NEXT_YEAR_AWARDED_AT = new Date('2027-05-30T07:40:05.000Z');

const NEXT_YEAR_AWARDED_DATE = parseBusinessDate('2027-05-30');

// 組み合わせ決定で凍結した年が対象年になる遅れの枠
const LATE_AWARDED_DATE = parseBusinessDate('2027-05-23');

// 知らせの処理は加入の有効化より後に動き、決済期限を過ぎてから届くこともある
const NOW = new Date('2027-05-24T15:10:00.000Z');

const clock: Clock = { now: () => NOW };

const RESOLUTIONS: ReadonlyMap<BusinessDate, TargetYearResolution> = new Map<
  BusinessDate,
  TargetYearResolution
>([
  [
    AWARDED_DATE,
    {
      kind: 'open',
      year: {
        year: 2027,
        schedule: SCHEDULE_2027,
        source: 'default',
        state: 'open',
      },
    },
  ],
  [
    NEXT_YEAR_AWARDED_DATE,
    {
      kind: 'open',
      year: {
        year: 2028,
        schedule: SCHEDULE_2028,
        source: 'default',
        state: 'planned',
      },
    },
  ],
  [LATE_AWARDED_DATE, { kind: 'late', year: 2027 }],
]);

function activationAt(activatedAt: Date): UltrasActivation {
  return Object.freeze({
    activationId: '01JC0ACTVTN000000000000001',
    userId: USER_ID,
    stripeSubscriptionId: 'sub_0123456789abcdef',
    activatedAt,
  });
}

function entryOf(
  entryId: string,
  columns: Partial<YearEntryRecord> = {},
): YearEntryRecord {
  return Object.freeze({
    entryId,
    weekTournamentId: `01JD0WTRN${entryId.slice(-17)}`,
    weekPeriod: '2027-W08',
    launchId: `01JD01NCH${entryId.slice(-17)}`,
    productId: `01JD0PR0D${entryId.slice(-17)}`,
    ownerUserId: USER_ID,
    launchDate: parseBusinessDate('2027-02-22'),
    qualifierUpvoteCount: 12,
    qualifierLastUpvoteElapsedMs: 3_600_000,
    awardedAt: AWARDED_AT,
    awardedDate: AWARDED_DATE,
    status: 'awaiting_payment',
    entitlementSource: null,
    purchaseId: null,
    closeReason: null,
    classifiedYear: null,
    refundStatus: 'none',
    refundNoticeStatus: 'none',
    ...columns,
  });
}

const OPEN_ENTRY = entryOf(OPEN_ENTRY_ID);

const PAID_ENTRY = entryOf(PAID_ENTRY_ID, {
  status: 'entitled',
  entitlementSource: 'payment',
  purchaseId: '01JD0PRCH00000000000000001',
});

const NEXT_YEAR_ENTRY = entryOf(NEXT_YEAR_ENTRY_ID, {
  weekPeriod: '2027-W21',
  awardedAt: NEXT_YEAR_AWARDED_AT,
  awardedDate: NEXT_YEAR_AWARDED_DATE,
});

const LATE_ENTRY = entryOf(LATE_ENTRY_ID, {
  weekPeriod: '2027-W20',
  awardedAt: new Date('2027-05-23T07:40:05.000Z'),
  awardedDate: LATE_AWARDED_DATE,
});

const OTHER_USER_ENTRY = entryOf(OTHER_USER_ENTRY_ID, {
  ownerUserId: OTHER_USER_ID,
});

function notUsed(): never {
  throw new Error('Ultrasによる参加費の免除の処理はこの操作を使わない');
}

type Call =
  | { readonly kind: 'listOpen'; readonly userId: string }
  | {
      readonly kind: 'resolveAward';
      readonly awardedDate: BusinessDate;
      readonly now: Date;
    }
  | {
      readonly kind: 'grant';
      readonly entryIds: readonly string[];
      readonly at: Date;
    };

interface HarnessOptions {
  readonly entries?: readonly YearEntryRecord[];
  readonly failure?: { readonly on: Call['kind']; readonly error: Error };
}

interface Harness {
  readonly handler: YearUltrasEntryExemptionHandler;
  readonly calls: Call[];
  readonly statuses: () => Readonly<Record<string, string>>;
}

function statusesOf(
  entries: readonly YearEntryRecord[],
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    entries.map(({ entryId, status, entitlementSource }) => [
      entryId,
      `${status}:${String(entitlementSource)}`,
    ]),
  );
}

// ストアの契約(受付中・資格を得た枠を凍結済みの年のものも含めて返し、付与は指定の枠のうち受付中のものだけを書き換える)と、
// 暦の契約(Week優勝の日から対象年を求める)を写した偽物。凍結済みの年の枠は暦が遅れを返すため、ストアの凍結の条件は写さない
function createHarness(options: HarnessOptions = {}): Harness {
  const { failure } = options;
  let entries = options.entries ?? [
    OPEN_ENTRY,
    PAID_ENTRY,
    NEXT_YEAR_ENTRY,
    LATE_ENTRY,
    OTHER_USER_ENTRY,
  ];
  const calls: Call[] = [];
  const settle = <T>(call: Call, value: () => T): Promise<T> => {
    calls.push(call);
    return failure?.on === call.kind
      ? Promise.reject(failure.error)
      : Promise.resolve(value());
  };
  const store: YearEntryStore = {
    insertFromChampion: notUsed,
    findByWeekTournaments: notUsed,
    findByLaunches: notUsed,
    findEntry: notUsed,
    listOpenByOwner: (userId) =>
      settle({ kind: 'listOpen', userId }, () =>
        entries.filter(
          (entry) =>
            entry.ownerUserId === userId &&
            OPEN_ENTRY_STATUSES.some((status) => status === entry.status),
        ),
      ),
    listLaunchIdsByProduct: notUsed,
    listCandidates: notUsed,
    listDrawn: notUsed,
    grantByUltras: (entryIds, at) =>
      settle({ kind: 'grant', entryIds, at }, () => {
        const granted = entries
          .filter(
            (entry) =>
              entryIds.includes(entry.entryId) &&
              GRANTABLE_STATUSES.some((status) => status === entry.status),
          )
          .map(({ entryId }) => entryId);
        entries = entries.map((entry) =>
          granted.includes(entry.entryId)
            ? { ...entry, status: 'entitled', entitlementSource: 'ultras' }
            : entry,
        );
        return granted;
      }),
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
    resolveAward: (awardedDate, now) =>
      settle({ kind: 'resolveAward', awardedDate, now }, () => {
        const resolution = RESOLUTIONS.get(awardedDate);
        if (resolution === undefined) {
          throw new Error(`対象年の無いWeek優勝の日です: ${awardedDate}`);
        }
        return resolution;
      }),
    upcoming: notUsed,
    ensureUpcoming: notUsed,
    openPeriodStart: notUsed,
  };
  return {
    handler: new YearUltrasEntryExemptionHandler(store, calendar, clock),
    calls,
    statuses: () => statusesOf(entries),
  };
}

function grantedIn(calls: readonly Call[]): readonly (readonly string[])[] {
  return calls.flatMap((call) =>
    call.kind === 'grant' ? [call.entryIds] : [],
  );
}

function caughtOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
}

describe('YearUltrasEntryExemptionHandler', () => {
  test('Week優勝の後で決済期限より前に有効になった加入では、知らせが期限の後に届いても加入者の受付中の枠に参加資格を与える', async () => {
    const { handler, calls, statuses } = createHarness();

    await handler.handle(activationAt(new Date('2027-05-24T14:34:59.000Z')));

    expect(calls).toEqual([
      { kind: 'listOpen', userId: USER_ID },
      { kind: 'resolveAward', awardedDate: AWARDED_DATE, now: NOW },
      { kind: 'resolveAward', awardedDate: NEXT_YEAR_AWARDED_DATE, now: NOW },
      { kind: 'resolveAward', awardedDate: LATE_AWARDED_DATE, now: NOW },
      { kind: 'grant', entryIds: [OPEN_ENTRY_ID], at: NOW },
    ]);
    expect(statuses()).toEqual({
      [OPEN_ENTRY_ID]: 'entitled:ultras',
      [PAID_ENTRY_ID]: 'entitled:payment',
      [NEXT_YEAR_ENTRY_ID]: 'awaiting_payment:null',
      [LATE_ENTRY_ID]: 'awaiting_payment:null',
      [OTHER_USER_ENTRY_ID]: 'awaiting_payment:null',
    });
  });

  test('決済期限ちょうどとWeek優勝の確定ちょうどに有効になった加入でも参加資格を与える', async () => {
    const atDeadline = createHarness({ entries: [OPEN_ENTRY] });
    const atAward = createHarness({ entries: [OPEN_ENTRY] });

    await atDeadline.handler.handle(activationAt(SCHEDULE_2027.deadlineAt));
    await atAward.handler.handle(activationAt(AWARDED_AT));

    expect(atDeadline.statuses()[OPEN_ENTRY_ID]).toBe('entitled:ultras');
    expect(atAward.statuses()[OPEN_ENTRY_ID]).toBe('entitled:ultras');
  });

  test('決済期限の後に有効になった加入では参加資格を与えない', async () => {
    const { handler, calls, statuses } = createHarness({
      entries: [OPEN_ENTRY],
    });

    await handler.handle(
      activationAt(new Date(SCHEDULE_2027.deadlineAt.getTime() + 1)),
    );

    expect(grantedIn(calls)).toEqual([]);
    expect(statuses()).toEqual({ [OPEN_ENTRY_ID]: 'awaiting_payment:null' });
  });

  test('Week優勝の確定より前に有効になった加入では参加資格を与えない', async () => {
    const { handler, calls, statuses } = createHarness({
      entries: [OPEN_ENTRY],
    });

    await handler.handle(activationAt(new Date(AWARDED_AT.getTime() - 1)));

    expect(grantedIn(calls)).toEqual([]);
    expect(statuses()).toEqual({ [OPEN_ENTRY_ID]: 'awaiting_payment:null' });
  });

  test('枠ごとに対象年の決済期限で判定し、前年の期限の後でも翌年が対象年の枠には参加資格を与える', async () => {
    const { handler, calls, statuses } = createHarness();

    await handler.handle(activationAt(new Date('2027-05-30T09:00:00.000Z')));

    expect(grantedIn(calls)).toEqual([[NEXT_YEAR_ENTRY_ID]]);
    expect(statuses()).toMatchObject({
      [OPEN_ENTRY_ID]: 'awaiting_payment:null',
      [NEXT_YEAR_ENTRY_ID]: 'entitled:ultras',
      [LATE_ENTRY_ID]: 'awaiting_payment:null',
    });
  });

  test('凍結済みの年が対象年の枠には、決済期限より前の加入でも参加資格を与えない', async () => {
    const { handler, calls, statuses } = createHarness({
      entries: [LATE_ENTRY],
    });

    await handler.handle(activationAt(new Date('2027-05-23T09:00:00.000Z')));

    expect(grantedIn(calls)).toEqual([]);
    expect(statuses()).toEqual({ [LATE_ENTRY_ID]: 'awaiting_payment:null' });
  });

  test('受付中の枠が無ければ対象年を求めず、付与も呼ばない', async () => {
    const { handler, calls } = createHarness({
      entries: [PAID_ENTRY, OTHER_USER_ENTRY],
    });

    await handler.handle(activationAt(new Date('2027-03-01T09:00:00.000Z')));

    expect(calls).toEqual([{ kind: 'listOpen', userId: USER_ID }]);
  });

  test('同じ知らせを2回処理しても結果が変わらない', async () => {
    const activation = activationAt(new Date('2027-03-01T09:00:00.000Z'));
    const { handler, calls, statuses } = createHarness();

    await handler.handle(activation);
    const afterFirst = statuses();
    await handler.handle(activation);

    expect(statuses()).toEqual(afterFirst);
    expect(afterFirst[OPEN_ENTRY_ID]).toBe('entitled:ultras');
    expect(grantedIn(calls)).toEqual([[OPEN_ENTRY_ID]]);
  });

  test.each(['listOpen', 'resolveAward', 'grant'] as const)(
    '%sの失敗はそのまま投げ、知らせ全体の再試行に任せる',
    async (on) => {
      const error = new Error('一時的な失敗');
      const { handler } = createHarness({ failure: { on, error } });

      const caught = await caughtOf(
        handler.handle(activationAt(new Date('2027-03-01T09:00:00.000Z'))),
      );

      expect(caught).toBe(error);
    },
  );
});
