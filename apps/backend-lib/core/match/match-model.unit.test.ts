import { describe, expect, test } from 'bun:test';

import { parseBusinessDate } from '../time/business-time.ts';
import {
  deriveMatchPhase,
  ENTRY_RESULTS,
  type EntryResult,
  isWinningResult,
  MATCH_DECISIONS,
  MATCH_KINDS,
  MATCH_PHASES,
  MATCH_STAGES,
  type MatchTimes,
  QUALIFIER_SCHEDULE,
  qualifierWindow,
} from './match-model.ts';

const MATCH_DATE = parseBusinessDate('2026-09-07');

// 業務時刻はUTC−8のため、業務日付09-07の0:00はUTCの09-07 8:00、23:40はUTCの09-08 7:40になる
const KICKOFF = new Date('2026-09-07T08:00:00.000Z');
const FULL_TIME = new Date('2026-09-08T07:40:00.000Z');

function match(overrides: Partial<MatchTimes> = {}): MatchTimes {
  return {
    startsAt: KICKOFF,
    endsAt: FULL_TIME,
    startedAt: null,
    decidedAt: null,
    ...overrides,
  };
}

describe('マッチの値の一覧', () => {
  test('種別は予選・Week・Yearの3つで、変更できない', () => {
    expect([...MATCH_KINDS]).toEqual(['qualifier', 'week', 'year']);
    expect(Object.isFrozen(MATCH_KINDS)).toBe(true);
  });

  test('段階は準々決勝・準決勝・決勝の3つで、変更できない', () => {
    expect([...MATCH_STAGES]).toEqual(['quarterfinal', 'semifinal', 'final']);
    expect(Object.isFrozen(MATCH_STAGES)).toBe(true);
  });

  test('側の結果は勝利・敗北・不戦勝・相手の退会等による勝利の4つで、変更できない', () => {
    expect([...ENTRY_RESULTS]).toEqual(['won', 'lost', 'bye', 'walkover']);
    expect(Object.isFrozen(ENTRY_RESULTS)).toBe(true);
  });

  test('決着は6つで、変更できない', () => {
    expect([...MATCH_DECISIONS]).toEqual([
      'votes',
      'last_upvote',
      'no_votes',
      'bye',
      'walkover',
      'both_forfeited',
    ]);
    expect(Object.isFrozen(MATCH_DECISIONS)).toBe(true);
  });

  test('状態は予定・マッチ中・集計中・終了の4つで、変更できない', () => {
    expect([...MATCH_PHASES]).toEqual([
      'scheduled',
      'live',
      'tallying',
      'finished',
    ]);
    expect(Object.isFrozen(MATCH_PHASES)).toBe(true);
  });
});

describe('QUALIFIER_SCHEDULE', () => {
  test('開始は0:00、終了は23:40、ペアリングは23:45で、変更できない', () => {
    expect(QUALIFIER_SCHEDULE).toEqual({
      kickoff: { hour: 0, minute: 0 },
      fullTime: { hour: 23, minute: 40 },
      pairing: { hour: 23, minute: 45 },
    });
    expect(Object.isFrozen(QUALIFIER_SCHEDULE)).toBe(true);
    expect(Object.isFrozen(QUALIFIER_SCHEDULE.kickoff)).toBe(true);
    expect(Object.isFrozen(QUALIFIER_SCHEDULE.fullTime)).toBe(true);
    expect(Object.isFrozen(QUALIFIER_SCHEDULE.pairing)).toBe(true);
  });
});

describe('qualifierWindow', () => {
  test('実施日の業務時刻の0:00(UTCの8:00)に始まり、23:40(UTCの翌日7:40)に終わる', () => {
    expect(qualifierWindow(MATCH_DATE)).toEqual({
      startsAt: KICKOFF,
      endsAt: FULL_TIME,
    });
  });

  test('年をまたぐ実施日でも業務時刻の0:00から23:40までになる', () => {
    expect(qualifierWindow(parseBusinessDate('2026-12-31'))).toEqual({
      startsAt: new Date('2026-12-31T08:00:00.000Z'),
      endsAt: new Date('2027-01-01T07:40:00.000Z'),
    });
  });
});

describe('deriveMatchPhase', () => {
  test('開始の記録が無ければ、開始の日時の前は予定になる', () => {
    expect(
      deriveMatchPhase(match(), new Date('2026-09-07T07:59:59.999Z')),
    ).toBe('scheduled');
  });

  test('開始の記録が無ければ、開始の日時を過ぎても予定のままになる', () => {
    expect(deriveMatchPhase(match(), KICKOFF)).toBe('scheduled');
    expect(
      deriveMatchPhase(match(), new Date('2026-09-07T12:00:00.000Z')),
    ).toBe('scheduled');
  });

  test('開始の記録があれば、開始の日時の0:00からマッチ中になる', () => {
    expect(deriveMatchPhase(match({ startedAt: KICKOFF }), KICKOFF)).toBe(
      'live',
    );
  });

  test('終了の日時の直前の23:39:59まではマッチ中になる', () => {
    expect(
      deriveMatchPhase(
        match({ startedAt: KICKOFF }),
        new Date('2026-09-08T07:39:59.999Z'),
      ),
    ).toBe('live');
  });

  test('終了の日時の23:40ちょうどから、確定するまでは集計中になる', () => {
    expect(deriveMatchPhase(match({ startedAt: KICKOFF }), FULL_TIME)).toBe(
      'tallying',
    );
    expect(
      deriveMatchPhase(
        match({ startedAt: KICKOFF }),
        new Date('2026-09-08T07:44:59.999Z'),
      ),
    ).toBe('tallying');
  });

  test('確定の記録があれば、終了の日時を過ぎていれば終了になる', () => {
    expect(
      deriveMatchPhase(
        match({
          startedAt: KICKOFF,
          decidedAt: new Date('2026-09-08T07:40:05.000Z'),
        }),
        new Date('2026-09-08T07:41:00.000Z'),
      ),
    ).toBe('finished');
  });

  test('即時の終了で確定したマッチは、終了の日時より前でも終了になる', () => {
    expect(
      deriveMatchPhase(
        match({
          startedAt: KICKOFF,
          decidedAt: new Date('2026-09-07T15:00:00.000Z'),
        }),
        new Date('2026-09-07T15:00:01.000Z'),
      ),
    ).toBe('finished');
  });

  test('開始時点で決着したマッチは、開始の記録と確定の記録があり終了になる', () => {
    expect(
      deriveMatchPhase(
        match({ startedAt: KICKOFF, decidedAt: KICKOFF }),
        KICKOFF,
      ),
    ).toBe('finished');
  });

  test('確定の記録は開始の記録の有無より優先する', () => {
    expect(
      deriveMatchPhase(
        match({ decidedAt: new Date('2026-09-07T07:00:00.000Z') }),
        new Date('2026-09-07T07:30:00.000Z'),
      ),
    ).toBe('finished');
  });
});

describe('isWinningResult', () => {
  test.each<[EntryResult, boolean]>([
    ['won', true],
    ['bye', true],
    ['walkover', true],
    ['lost', false],
  ])('%sは勝利の扱いが%pになる', (result, expected) => {
    expect(isWinningResult(result)).toBe(expected);
  });
});
