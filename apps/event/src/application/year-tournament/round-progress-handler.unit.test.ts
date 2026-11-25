import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';

import type {
  MatchEvent,
  MatchEventType,
} from '../../../lib/core/match/match-events.ts';
import type { MatchKind } from '../../../lib/core/match/match-model.ts';
import { parseBusinessDate } from '../../../lib/core/time/business-time.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type {
  AdvanceResult,
  BracketOfMatch,
  BracketStore,
} from '../../../lib/core/tournament/ports.ts';
import type {
  YearProgressionService,
  YearTournamentRecord,
  YearTournamentStore,
} from '../../../lib/core/year-tournament/ports.ts';
import {
  defaultFinalDate,
  yearScheduleFor,
} from '../../../lib/core/year-tournament/year-schedule.ts';
import { RoundProgressHandler } from './round-progress-handler.ts';

const NOW = new Date('2027-05-25T07:41:30.000Z');

const DECIDED_AT = new Date('2027-05-25T07:40:05.000Z');

const MATCH_ID = '01JD0MTCH00000000000000001';

const NEXT_MATCH_ID = '01JD0MTCH00000000000000009';

const EVENT_ID = '01JD0MEVT00000000000000010';

const BRACKET_ID = '01JD0BRKT00000000000000001';

const YEAR_TOURNAMENT_ID = '01JD0YTRN00000000000000001';

const CHAMPION_ENTRY_ID = '01JD0YENT00000000000000001';

const YEAR = 2027;

const clock: Clock = { now: () => NOW };

const TOURNAMENT: YearTournamentRecord = Object.freeze({
  yearTournamentId: YEAR_TOURNAMENT_ID,
  year: YEAR,
  schedule: yearScheduleFor(YEAR, defaultFinalDate(YEAR)),
  source: 'default',
  version: 0,
  updatedAt: null,
  updatedByAdminId: null,
  status: 'in_progress',
  drawStartedAt: new Date('2027-05-15T14:45:00.000Z'),
  bracketId: BRACKET_ID,
  firstRoundDate: parseBusinessDate('2027-05-24'),
  participantCount: 32,
  outcome: null,
  championEntryId: null,
  awardedAt: null,
});

const YEAR_BRACKET: BracketOfMatch = Object.freeze({
  bracketId: BRACKET_ID,
  kind: 'year',
  tournamentId: YEAR_TOURNAMENT_ID,
});

const SCHEDULED: AdvanceResult = Object.freeze({
  kind: 'scheduled',
  bracketId: BRACKET_ID,
  round: 2,
  late: false,
  decidedMatchIds: [MATCH_ID],
  previewMatchIds: [NEXT_MATCH_ID],
});

function eventOf(
  type: MatchEventType = 'decided',
  kind: MatchKind = 'year',
): MatchEvent {
  return Object.freeze({
    id: EVENT_ID,
    matchId: MATCH_ID,
    kind,
    type,
    occurredAt: DECIDED_AT,
  });
}

function notUsed(): never {
  throw new Error('Yearのラウンドの進行の処理はこの操作を使わない');
}

type Call =
  | { readonly kind: 'findBrackets'; readonly matchIds: readonly string[] }
  | { readonly kind: 'findYear'; readonly yearTournamentId: string }
  | {
      readonly kind: 'advance';
      readonly yearTournamentId: string;
      readonly now: Date;
    }
  | {
      readonly kind: 'applyResult';
      readonly tournament: YearTournamentRecord;
      readonly result: AdvanceResult;
      readonly now: Date;
    };

interface HarnessOptions {
  readonly bracket?: BracketOfMatch | undefined;
  readonly tournament?: YearTournamentRecord | undefined;
  readonly result?: AdvanceResult | undefined;
  readonly failure?: { readonly on: Call['kind']; readonly error: Error };
}

interface Harness {
  readonly handler: RoundProgressHandler;
  readonly calls: Call[];
}

// undefinedを照会の結果として渡せるよう、既定値は指定の有無で選ぶ
function createHarness(options: HarnessOptions = {}): Harness {
  const bracket = 'bracket' in options ? options.bracket : YEAR_BRACKET;
  const tournament = 'tournament' in options ? options.tournament : TOURNAMENT;
  const result = 'result' in options ? options.result : SCHEDULED;
  const { failure } = options;
  const calls: Call[] = [];
  const settle = <T>(call: Call, value: T): Promise<T> => {
    calls.push(call);
    return failure?.on === call.kind
      ? Promise.reject(failure.error)
      : Promise.resolve(value);
  };
  const brackets: BracketStore = {
    findByTournament: notUsed,
    findById: notUsed,
    findByMatchIds: (matchIds) =>
      settle(
        { kind: 'findBrackets', matchIds },
        new Map(bracket === undefined ? [] : [[MATCH_ID, bracket]]),
      ),
    findAliveRefs: notUsed,
    findParticipantStandings: notUsed,
    unlinkProduct: notUsed,
  };
  const store: YearTournamentStore = {
    ensureYear: notUsed,
    findByYears: notUsed,
    findById: (yearTournamentId) =>
      settle({ kind: 'findYear', yearTournamentId }, tournament),
    listDue: notUsed,
    listInProgress: notUsed,
    latestFrozenDeadlineDate: notUsed,
    freeze: notUsed,
    markDrawn: notUsed,
    recordFinish: notUsed,
    listAwardedBetween: notUsed,
    listAwardsByProducts: notUsed,
  };
  const progression: YearProgressionService = {
    advance: (yearTournamentId, now) =>
      settle({ kind: 'advance', yearTournamentId, now }, result),
    advanceAll: notUsed,
    applyResult: (applied, advanced, now) =>
      settle(
        { kind: 'applyResult', tournament: applied, result: advanced, now },
        undefined,
      ),
  };
  return {
    handler: new RoundProgressHandler(brackets, store, progression, clock),
    calls,
  };
}

const records: LogRecord[] = [];

beforeAll(() => {
  configureSync({
    reset: true,
    sinks: { capture: (record) => records.push(record) },
    loggers: [
      { category: ['event'], sinks: ['capture'], lowestLevel: 'debug' },
      { category: ['logtape', 'meta'], sinks: [], lowestLevel: 'warning' },
    ],
  });
});

afterAll(() => {
  resetSync();
});

beforeEach(() => {
  records.length = 0;
});

function warnings(): LogRecord[] {
  return records.filter(
    (record) =>
      record.category.join('.') === 'event.application.year-tournament' &&
      record.level === 'warning',
  );
}

const PROGRESSED_CALLS = (result: AdvanceResult): Call[] => [
  { kind: 'findBrackets', matchIds: [MATCH_ID] },
  { kind: 'findYear', yearTournamentId: YEAR_TOURNAMENT_ID },
  { kind: 'advance', yearTournamentId: YEAR_TOURNAMENT_ID, now: NOW },
  { kind: 'applyResult', tournament: TOURNAMENT, result, now: NOW },
];

describe('Yearのマッチの確定によるラウンドの進行の処理', () => {
  test('マッチのブラケットからYearの年を引き、処理の時刻で進めてから結果を反映して完了する', async () => {
    const harness = createHarness();

    const outcome = await harness.handler.handle(eventOf());

    expect(outcome).toStrictEqual({ kind: 'done' });
    expect(harness.calls).toStrictEqual(PROGRESSED_CALLS(SCHEDULED));
    expect(warnings()).toStrictEqual([]);
  });

  test.each([
    [
      '次ラウンドの待ち',
      {
        kind: 'waiting',
        bracketId: BRACKET_ID,
        decidedMatchIds: [MATCH_ID],
        previewMatchIds: [],
      },
    ],
    [
      '決勝の確定による優勝',
      {
        kind: 'finished',
        bracketId: BRACKET_ID,
        championRef: CHAMPION_ENTRY_ID,
        newlyFinished: true,
        decidedMatchIds: [MATCH_ID],
      },
    ],
    [
      '優勝者の無い終了',
      {
        kind: 'finished',
        bracketId: BRACKET_ID,
        championRef: null,
        newlyFinished: true,
        decidedMatchIds: [MATCH_ID],
      },
    ],
    [
      '確定済みの終了の再処理',
      {
        kind: 'finished',
        bracketId: BRACKET_ID,
        championRef: CHAMPION_ENTRY_ID,
        newlyFinished: false,
        decidedMatchIds: [MATCH_ID],
      },
    ],
  ] as const satisfies readonly (readonly [string, AdvanceResult])[])(
    '%sの結果もそのまま結果の反映(発行と終了の記録)へ渡す',
    async (_, result) => {
      const harness = createHarness({ result });

      expect(await harness.handler.handle(eventOf())).toStrictEqual({
        kind: 'done',
      });
      expect(harness.calls).toStrictEqual(PROGRESSED_CALLS(result));
    },
  );

  test('進行中でない年は進めた結果が無いため、結果を反映せずに完了する', async () => {
    const harness = createHarness({ result: undefined });

    expect(await harness.handler.handle(eventOf())).toStrictEqual({
      kind: 'done',
    });
    expect(harness.calls.map(({ kind }) => kind)).toStrictEqual([
      'findBrackets',
      'findYear',
      'advance',
    ]);
  });

  test.each([
    ['予定', 'scheduled', 'year'],
    ['開始', 'started', 'year'],
    ['予選の確定', 'decided', 'qualifier'],
    ['Weekのトーナメントの確定', 'decided', 'week'],
  ] as const)(
    '%sのイベントではブラケットを照会せずに完了する',
    async (_, type, kind) => {
      const harness = createHarness();

      expect(await harness.handler.handle(eventOf(type, kind))).toStrictEqual({
        kind: 'done',
      });
      expect(harness.calls).toStrictEqual([]);
    },
  );

  test.each([
    ['どのブラケットにも無い', undefined],
    ['Year以外のブラケットのもの', { ...YEAR_BRACKET, kind: 'week' }],
  ] as const satisfies readonly (readonly [
    string,
    BracketOfMatch | undefined,
  ])[])('マッチが%sときは年を読まず進めずに完了する', async (_, bracket) => {
    const harness = createHarness({ bracket });

    expect(await harness.handler.handle(eventOf())).toStrictEqual({
      kind: 'done',
    });
    expect(harness.calls).toStrictEqual([
      { kind: 'findBrackets', matchIds: [MATCH_ID] },
    ]);
    expect(warnings()).toStrictEqual([]);
  });

  test('ブラケットの年が本specの年に無いときは、識別子だけの警告のログを出して進めずに完了する', async () => {
    const harness = createHarness({ tournament: undefined });

    expect(await harness.handler.handle(eventOf())).toStrictEqual({
      kind: 'done',
    });
    expect(harness.calls.map(({ kind }) => kind)).toStrictEqual([
      'findBrackets',
      'findYear',
    ]);
    expect(warnings().map((record) => record.properties)).toStrictEqual([
      {
        eventId: EVENT_ID,
        matchId: MATCH_ID,
        bracketId: BRACKET_ID,
        yearTournamentId: YEAR_TOURNAMENT_ID,
        outcome: 'tournament-not-found',
      },
    ]);
  });

  test.each(['findBrackets', 'findYear', 'advance', 'applyResult'] as const)(
    '%sの失敗は捕まえずに投げ、後の処理をせずにメッセージの再試行に任せる',
    async (on) => {
      const error = new Error('D1 unavailable');
      const harness = createHarness({ failure: { on, error } });

      const caught = await harness.handler
        .handle(eventOf())
        .catch((thrown: unknown) => thrown);

      expect(caught).toBe(error);
      expect(harness.calls.at(-1)?.kind).toBe(on);
    },
  );
});
