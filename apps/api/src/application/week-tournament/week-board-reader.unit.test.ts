import { describe, expect, test } from 'bun:test';

import type {
  MatchDirectory,
  MatchRecord,
} from '../../../lib/core/match/ports.ts';
import {
  type BusinessDate,
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../../lib/core/time/business-time.ts';
import { bracketShape } from '../../../lib/core/tournament/bracket-shape.ts';
import type {
  BracketMatchRecord,
  BracketOfMatch,
  BracketRecord,
  BracketStore,
} from '../../../lib/core/tournament/ports.ts';
import type {
  WeekTournamentRecord,
  WeekTournamentStore,
} from '../../../lib/core/week-tournament/ports.ts';
import { entryWindowFor } from '../../../lib/core/week-tournament/week-schedule.ts';
import {
  createWeekDecisionFakes,
  tournamentOf,
} from './testing/week-decision-fakes.ts';
import { weekMatchIdOf, weekMatchOf } from './testing/week-summary-fakes.ts';
import { DirectoryWeekBoardReader } from './week-board-reader.ts';

const date = (value: string): BusinessDate => parseBusinessDate(value);

const noonOf = (value: BusinessDate): Date =>
  fromBusinessDateTime(value, { hour: 12, minute: 0 });

// 2027-03-01の週は参加200(8ラウンド)で3/9〜3/16、2027-03-08の週は参加20(5ラウンド)で3/16に始まる
const EARLIER_WEEK = tournamentOf({
  tournamentId: '01JF0WTRNM0000000000000001',
  status: 'in_progress',
  bracketId: '01JF0WBRKT0000000000000001',
});

const LATER_WEEK = tournamentOf({
  tournamentId: '01JF0WTRNM0000000000000002',
  window: entryWindowFor(date('2027-03-08')),
  status: 'in_progress',
  bracketId: '01JF0WBRKT0000000000000002',
});

interface BracketFixture {
  readonly tournament: WeekTournamentRecord;
  readonly participantCount: number;
  readonly firstRoundDate: BusinessDate;
  readonly matches: readonly Pick<
    BracketMatchRecord,
    'matchId' | 'round' | 'position' | 'matchDate'
  >[];
}

function bracketOf(fixture: BracketFixture): BracketRecord {
  const bracketId = fixture.tournament.bracketId;
  if (bracketId === null) {
    throw new Error('ブラケットのIDが無い週は使わない');
  }
  return {
    bracketId,
    kind: 'week',
    tournamentId: fixture.tournament.tournamentId,
    shape: bracketShape(fixture.participantCount),
    firstRoundDate: fixture.firstRoundDate,
    status: 'active',
    outcome: null,
    championRef: null,
    participants: [],
    matches: fixture.matches.map((match) => ({
      ...match,
      participantNos: [1, 2],
      status: 'scheduled',
      winnerNo: null,
    })),
  };
}

function weekMatch(index: number, round: number, on: BusinessDate) {
  return weekMatchOf({
    index,
    launch: index,
    round,
    date: on,
    now: noonOf(on),
  });
}

interface BoardScenario {
  readonly matches: readonly MatchRecord[];
  readonly brackets: readonly BracketRecord[];
  readonly tournaments: readonly WeekTournamentRecord[];
  // 省略したマッチは、そのIDを含むブラケットへ引き当てる
  readonly ofMatch?: ReadonlyMap<string, BracketOfMatch>;
}

function ofMatchFrom(
  brackets: readonly BracketRecord[],
): ReadonlyMap<string, BracketOfMatch> {
  return new Map(
    brackets.flatMap(({ bracketId, kind, tournamentId, matches }) =>
      matches.map(({ matchId }) => [
        matchId,
        { bracketId, kind, tournamentId },
      ]),
    ),
  );
}

const unused = (name: string) => (): never => {
  throw new Error(`照会は${name}を呼ばない`);
};

function createBoardFakes(scenario: BoardScenario) {
  const reads = {
    dateReads: [] as Parameters<MatchDirectory['listForDate']>[0][],
    matchBracketReads: [] as (readonly string[])[],
    bracketReads: [] as string[],
    tournamentReads: [] as string[],
  };
  const ofMatch = scenario.ofMatch ?? ofMatchFrom(scenario.brackets);
  const matches: MatchDirectory = {
    listForDate(input) {
      reads.dateReads.push(input);
      return Promise.resolve(scenario.matches);
    },
    findMatches: unused('findMatches'),
    listByLaunches: unused('listByLaunches'),
    findQualifierResults: unused('findQualifierResults'),
    summarizeDaily: unused('summarizeDaily'),
  };
  const brackets: BracketStore = {
    ...createWeekDecisionFakes().brackets,
    findByMatchIds(matchIds) {
      reads.matchBracketReads.push(matchIds);
      return Promise.resolve(
        new Map([...ofMatch].filter(([matchId]) => matchIds.includes(matchId))),
      );
    },
    findById(bracketId) {
      reads.bracketReads.push(bracketId);
      return Promise.resolve(
        scenario.brackets.find((bracket) => bracket.bracketId === bracketId),
      );
    },
  };
  const store: WeekTournamentStore = {
    ...createWeekDecisionFakes().store,
    findTournament(tournamentId) {
      reads.tournamentReads.push(tournamentId);
      return Promise.resolve(
        scenario.tournaments.find(
          (tournament) => tournament.tournamentId === tournamentId,
        ),
      );
    },
  };
  return {
    reader: new DirectoryWeekBoardReader(matches, brackets, store),
    reads,
  };
}

describe('DirectoryWeekBoardReader.read', () => {
  const OVERLAP_DAY = date('2027-03-16');

  // 後に始まった週のマッチのIDを小さくし、IDの順ではなく1回戦の日の順で並ぶことを確かめる
  const overlapScenario = (): BoardScenario => {
    const earlier = bracketOf({
      tournament: EARLIER_WEEK,
      participantCount: 200,
      firstRoundDate: date('2027-03-09'),
      matches: [
        {
          matchId: weekMatchIdOf(9),
          round: 7,
          position: 1,
          matchDate: date('2027-03-15'),
        },
        {
          matchId: weekMatchIdOf(3),
          round: 8,
          position: 1,
          matchDate: OVERLAP_DAY,
        },
      ],
    });
    const later = bracketOf({
      tournament: LATER_WEEK,
      participantCount: 20,
      firstRoundDate: OVERLAP_DAY,
      matches: [
        {
          matchId: weekMatchIdOf(2),
          round: 1,
          position: 1,
          matchDate: OVERLAP_DAY,
        },
        {
          matchId: weekMatchIdOf(1),
          round: 1,
          position: 2,
          matchDate: OVERLAP_DAY,
        },
      ],
    });
    return {
      matches: [
        weekMatch(1, 1, OVERLAP_DAY),
        weekMatch(2, 1, OVERLAP_DAY),
        weekMatch(3, 8, OVERLAP_DAY),
      ],
      brackets: [earlier, later],
      tournaments: [EARLIER_WEEK, LATER_WEEK],
    };
  };

  test('重なる2つのトーナメントを1回戦の日の昇順で1行ずつ返し、ラウンド名・決勝日・決勝の判定・ブラケットへのパスを添える', async () => {
    const { reader } = createBoardFakes(overlapScenario());

    const rounds = await reader.read(OVERLAP_DAY, noonOf(OVERLAP_DAY));

    expect(rounds).toStrictEqual([
      {
        tournament: EARLIER_WEEK,
        firstRoundDate: date('2027-03-09'),
        round: 8,
        roundName: '決勝',
        finalDate: OVERLAP_DAY,
        isFinal: true,
        matchIds: [weekMatchIdOf(3)],
        bracketPath: '/tournaments/week/2027-W09',
      },
      {
        tournament: LATER_WEEK,
        firstRoundDate: OVERLAP_DAY,
        round: 1,
        roundName: '1回戦',
        finalDate: date('2027-03-20'),
        isFinal: false,
        matchIds: [weekMatchIdOf(2), weekMatchIdOf(1)],
        bracketPath: '/tournaments/week/2027-W10',
      },
    ]);
  });

  test('マッチの日付の照会とマッチからのブラケットの引き当てを1回ずつ行い、ブラケットと週の行はトーナメントごとに1回だけ読む', async () => {
    const { reader, reads } = createBoardFakes(overlapScenario());
    const now = noonOf(OVERLAP_DAY);

    await reader.read(OVERLAP_DAY, now);

    expect(reads.dateReads).toStrictEqual([
      { date: OVERLAP_DAY, kinds: ['week'], now },
    ]);
    expect(reads.matchBracketReads).toStrictEqual([
      [weekMatchIdOf(1), weekMatchIdOf(2), weekMatchIdOf(3)],
    ]);
    expect(reads.bracketReads.toSorted()).toStrictEqual([
      '01JF0WBRKT0000000000000001',
      '01JF0WBRKT0000000000000002',
    ]);
    expect(reads.tournamentReads.toSorted()).toStrictEqual([
      '01JF0WTRNM0000000000000001',
      '01JF0WTRNM0000000000000002',
    ]);
  });

  test('準々決勝・準決勝はラウンド名を段階の名前にし、遅れたラウンドの後の決勝日は記録された実施日から翌日ずつ求める', async () => {
    const today = date('2027-03-19');
    const bracket = bracketOf({
      tournament: LATER_WEEK,
      participantCount: 20,
      firstRoundDate: date('2027-03-16'),
      matches: [
        {
          matchId: weekMatchIdOf(1),
          round: 1,
          position: 1,
          matchDate: date('2027-03-16'),
        },
        {
          matchId: weekMatchIdOf(2),
          round: 2,
          position: 1,
          matchDate: date('2027-03-17'),
        },
        {
          matchId: weekMatchIdOf(3),
          round: 3,
          position: 1,
          matchDate: today,
        },
      ],
    });
    const { reader } = createBoardFakes({
      matches: [weekMatch(3, 3, today)],
      brackets: [bracket],
      tournaments: [LATER_WEEK],
    });

    const rounds = await reader.read(today, noonOf(today));

    expect(
      rounds.map(({ round, roundName, finalDate, isFinal }) => ({
        round,
        roundName,
        finalDate,
        isFinal,
      })),
    ).toStrictEqual([
      {
        round: 3,
        roundName: '準々決勝',
        finalDate: date('2027-03-21'),
        isFinal: false,
      },
    ]);
  });

  test('決勝の予定が記録済みなら、その実施日を決勝日にする', async () => {
    const today = date('2027-03-19');
    const bracket = bracketOf({
      tournament: LATER_WEEK,
      participantCount: 20,
      firstRoundDate: date('2027-03-16'),
      matches: [
        { matchId: weekMatchIdOf(4), round: 4, position: 1, matchDate: today },
        {
          matchId: weekMatchIdOf(5),
          round: 5,
          position: 1,
          matchDate: date('2027-03-22'),
        },
      ],
    });
    const { reader } = createBoardFakes({
      matches: [weekMatch(4, 4, today)],
      brackets: [bracket],
      tournaments: [LATER_WEEK],
    });

    const rounds = await reader.read(today, noonOf(today));

    expect(
      rounds.map(({ roundName, finalDate }) => ({ roundName, finalDate })),
    ).toStrictEqual([{ roundName: '準決勝', finalDate: date('2027-03-22') }]);
  });

  test('その日にWeekのマッチが無ければ空の一覧を返し、ブラケットを引き当てない', async () => {
    const { reader, reads } = createBoardFakes({
      matches: [],
      brackets: [],
      tournaments: [],
    });

    const rounds = await reader.read(OVERLAP_DAY, noonOf(OVERLAP_DAY));

    expect(rounds).toStrictEqual([]);
    expect(reads.dateReads).toHaveLength(1);
    expect(reads.matchBracketReads).toStrictEqual([]);
  });

  test('ブラケットに引き当たらないマッチと、ブラケット・週の行を読めないトーナメントは除き、他のトーナメントの行を返す', async () => {
    const scenario = overlapScenario();
    const orphan = weekMatch(7, 1, OVERLAP_DAY);
    const { reader } = createBoardFakes({
      ...scenario,
      matches: [...scenario.matches, orphan],
      tournaments: [LATER_WEEK],
    });

    const rounds = await reader.read(OVERLAP_DAY, noonOf(OVERLAP_DAY));

    expect(
      rounds.map(({ tournament, matchIds }) => ({
        tournamentId: tournament.tournamentId,
        matchIds,
      })),
    ).toStrictEqual([
      {
        tournamentId: LATER_WEEK.tournamentId,
        matchIds: [weekMatchIdOf(2), weekMatchIdOf(1)],
      },
    ]);

    const missingBracket = createBoardFakes({
      ...scenario,
      brackets: scenario.brackets.slice(0, 1),
      ofMatch: ofMatchFrom(scenario.brackets),
    });
    const withoutBracket = await missingBracket.reader.read(
      OVERLAP_DAY,
      noonOf(OVERLAP_DAY),
    );
    expect(withoutBracket.map(({ round }) => round)).toStrictEqual([8]);
  });

  test('マッチのラウンドがブラケットの形の範囲外なら、そのトーナメントの行を作らない', async () => {
    const today = date('2027-03-19');
    const bracket = bracketOf({
      tournament: LATER_WEEK,
      participantCount: 20,
      firstRoundDate: date('2027-03-16'),
      matches: [
        { matchId: weekMatchIdOf(6), round: 6, position: 1, matchDate: today },
      ],
    });
    const { reader } = createBoardFakes({
      matches: [weekMatch(6, 6, today)],
      brackets: [bracket],
      tournaments: [LATER_WEEK],
    });

    expect(await reader.read(today, noonOf(today))).toStrictEqual([]);
  });
});
