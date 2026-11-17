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
  YearTournamentRecord,
  YearTournamentStore,
} from '../../../lib/core/year-tournament/ports.ts';
import {
  defaultFinalDate,
  yearScheduleFor,
} from '../../../lib/core/year-tournament/year-schedule.ts';
import { YEAR, yearRowOf } from './testing/year-decision-fakes.ts';
import { yearMatchIdOf, yearMatchOf } from './testing/year-summary-fakes.ts';
import { DirectoryYearBoardReader } from './year-board-reader.ts';

const date = (value: string): BusinessDate => parseBusinessDate(value);

const noonOf = (value: BusinessDate): Date =>
  fromBusinessDateTime(value, { hour: 12, minute: 0 });

// 2027年は決勝日2027-06-13・参加20(5ラウンド)で、1回戦は2027-06-09
const FIRST_ROUND_DATE = date('2027-06-09');

const YEAR_ROW = yearRowOf({
  status: 'in_progress',
  drawStartedAt: new Date('2027-06-08T07:35:00Z'),
  bracketId: '01JF0YBRKT0000000000000001',
  firstRoundDate: FIRST_ROUND_DATE,
  participantCount: 20,
});

// 遅れの回復で前の年の進行が重なった日を作るため、2026年の行を並べる
const PREVIOUS_YEAR_ROW = yearRowOf({
  yearTournamentId: '01JF0YTRNM0000000000000002',
  year: YEAR - 1,
  schedule: yearScheduleFor(YEAR - 1, defaultFinalDate(YEAR - 1)),
  status: 'in_progress',
  bracketId: '01JF0YBRKT0000000000000002',
  firstRoundDate: date('2027-06-08'),
  participantCount: 4,
});

type BracketMatchFixture = Pick<
  BracketMatchRecord,
  'matchId' | 'round' | 'position' | 'matchDate'
>;

function bracketOf(
  tournament: YearTournamentRecord,
  matches: readonly BracketMatchFixture[],
): BracketRecord {
  const { bracketId, participantCount } = tournament;
  if (bracketId === null || participantCount === null) {
    throw new Error('組み合わせを決めていない年は使わない');
  }
  return {
    bracketId,
    kind: 'year',
    tournamentId: tournament.yearTournamentId,
    shape: bracketShape(participantCount),
    firstRoundDate: tournament.firstRoundDate,
    status: 'active',
    outcome: null,
    championRef: null,
    participants: [],
    matches: matches.map((match) => ({
      ...match,
      participantNos: [1, 2],
      status: 'scheduled',
      winnerNo: null,
    })),
  };
}

function yearMatch(index: number, round: number, on: BusinessDate) {
  return yearMatchOf({
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
  readonly years: readonly YearTournamentRecord[];
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

function createBoardFakes(scenario: BoardScenario) {
  const reads = {
    dateReads: [] as Parameters<MatchDirectory['listForDate']>[0][],
    matchBracketReads: [] as (readonly string[])[],
    bracketReads: [] as string[],
    yearReads: [] as string[],
  };
  const ofMatch = scenario.ofMatch ?? ofMatchFrom(scenario.brackets);
  const matches: Pick<MatchDirectory, 'listForDate'> = {
    listForDate(input) {
      reads.dateReads.push(input);
      return Promise.resolve(scenario.matches);
    },
  };
  const brackets: Pick<BracketStore, 'findByMatchIds' | 'findById'> = {
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
  const store: Pick<YearTournamentStore, 'findById'> = {
    findById(yearTournamentId) {
      reads.yearReads.push(yearTournamentId);
      return Promise.resolve(
        scenario.years.find((row) => row.yearTournamentId === yearTournamentId),
      );
    },
  };
  return {
    reader: new DirectoryYearBoardReader(matches, brackets, store),
    reads,
  };
}

describe('DirectoryYearBoardReader.read', () => {
  test('その日のYearのマッチを年ごとの1行にまとめ、ブラケットの位置の順のマッチ・ラウンド名・決勝日・決勝の判定・ブラケットへのパスを添える', async () => {
    const bracket = bracketOf(YEAR_ROW, [
      {
        matchId: yearMatchIdOf(2),
        round: 1,
        position: 1,
        matchDate: FIRST_ROUND_DATE,
      },
      {
        matchId: yearMatchIdOf(1),
        round: 1,
        position: 2,
        matchDate: FIRST_ROUND_DATE,
      },
    ]);
    const { reader } = createBoardFakes({
      matches: [
        yearMatch(1, 1, FIRST_ROUND_DATE),
        yearMatch(2, 1, FIRST_ROUND_DATE),
      ],
      brackets: [bracket],
      years: [YEAR_ROW],
    });

    const rounds = await reader.read(
      FIRST_ROUND_DATE,
      noonOf(FIRST_ROUND_DATE),
    );

    expect(rounds).toStrictEqual([
      {
        tournament: YEAR_ROW,
        round: 1,
        roundName: '1回戦',
        finalDate: date('2027-06-13'),
        isFinal: false,
        matchIds: [yearMatchIdOf(2), yearMatchIdOf(1)],
        bracketPath: '/tournaments/year/2027',
      },
    ]);
  });

  test('2つの年のマッチが重なる日は、年の昇順に1行ずつ返す', async () => {
    const today = date('2027-06-09');
    const current = bracketOf(YEAR_ROW, [
      { matchId: yearMatchIdOf(1), round: 1, position: 1, matchDate: today },
    ]);
    const previous = bracketOf(PREVIOUS_YEAR_ROW, [
      {
        matchId: yearMatchIdOf(8),
        round: 1,
        position: 1,
        matchDate: date('2027-06-08'),
      },
      { matchId: yearMatchIdOf(9), round: 2, position: 1, matchDate: today },
    ]);
    const { reader } = createBoardFakes({
      matches: [yearMatch(1, 1, today), yearMatch(9, 2, today)],
      brackets: [current, previous],
      years: [YEAR_ROW, PREVIOUS_YEAR_ROW],
    });

    const rounds = await reader.read(today, noonOf(today));

    expect(
      rounds.map(({ tournament, roundName, isFinal, bracketPath }) => ({
        year: tournament.year,
        roundName,
        isFinal,
        bracketPath,
      })),
    ).toStrictEqual([
      {
        year: YEAR - 1,
        roundName: '決勝',
        isFinal: true,
        bracketPath: '/tournaments/year/2026',
      },
      {
        year: YEAR,
        roundName: '1回戦',
        isFinal: false,
        bracketPath: '/tournaments/year/2027',
      },
    ]);
  });

  test('遅れたラウンドの後の決勝日は、記録された実際の実施日から翌日ずつ求める', async () => {
    const today = date('2027-06-12');
    const bracket = bracketOf(YEAR_ROW, [
      {
        matchId: yearMatchIdOf(1),
        round: 1,
        position: 1,
        matchDate: FIRST_ROUND_DATE,
      },
      {
        matchId: yearMatchIdOf(2),
        round: 2,
        position: 1,
        matchDate: date('2027-06-10'),
      },
      { matchId: yearMatchIdOf(3), round: 3, position: 1, matchDate: today },
    ]);
    const { reader } = createBoardFakes({
      matches: [yearMatch(3, 3, today)],
      brackets: [bracket],
      years: [YEAR_ROW],
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
        finalDate: date('2027-06-14'),
        isFinal: false,
      },
    ]);
  });

  test('決勝の予定が記録済みなら、その実施日を決勝日にする', async () => {
    const today = date('2027-06-12');
    const bracket = bracketOf(YEAR_ROW, [
      { matchId: yearMatchIdOf(4), round: 4, position: 1, matchDate: today },
      {
        matchId: yearMatchIdOf(5),
        round: 5,
        position: 1,
        matchDate: date('2027-06-15'),
      },
    ]);
    const { reader } = createBoardFakes({
      matches: [yearMatch(4, 4, today)],
      brackets: [bracket],
      years: [YEAR_ROW],
    });

    const rounds = await reader.read(today, noonOf(today));

    expect(
      rounds.map(({ roundName, finalDate, isFinal }) => ({
        roundName,
        finalDate,
        isFinal,
      })),
    ).toStrictEqual([
      { roundName: '準決勝', finalDate: date('2027-06-15'), isFinal: false },
    ]);
  });

  test('その日のマッチが決勝なら、決勝の行にしてその日を決勝日にする', async () => {
    const today = date('2027-06-13');
    const bracket = bracketOf(YEAR_ROW, [
      { matchId: yearMatchIdOf(5), round: 5, position: 1, matchDate: today },
    ]);
    const { reader } = createBoardFakes({
      matches: [yearMatch(5, 5, today)],
      brackets: [bracket],
      years: [YEAR_ROW],
    });

    const rounds = await reader.read(today, noonOf(today));

    expect(
      rounds.map(({ round, roundName, finalDate, isFinal, matchIds }) => ({
        round,
        roundName,
        finalDate,
        isFinal,
        matchIds,
      })),
    ).toStrictEqual([
      {
        round: 5,
        roundName: '決勝',
        finalDate: today,
        isFinal: true,
        matchIds: [yearMatchIdOf(5)],
      },
    ]);
  });

  test('年の行の無いブラケット・読めないブラケット・Yearでないブラケット・ブラケットに引き当たらないマッチは除き、他の年の行を返す', async () => {
    const today = date('2027-06-09');
    const current = bracketOf(YEAR_ROW, [
      { matchId: yearMatchIdOf(1), round: 1, position: 1, matchDate: today },
    ]);
    const previous = bracketOf(PREVIOUS_YEAR_ROW, [
      { matchId: yearMatchIdOf(9), round: 2, position: 1, matchDate: today },
    ]);
    const matches = [
      yearMatch(1, 1, today),
      yearMatch(9, 2, today),
      yearMatch(7, 1, today),
    ];
    const withoutYearRow = createBoardFakes({
      matches,
      brackets: [current, previous],
      years: [YEAR_ROW],
    });

    const rounds = await withoutYearRow.reader.read(today, noonOf(today));

    expect(
      rounds.map(({ tournament, matchIds }) => ({
        year: tournament.year,
        matchIds,
      })),
    ).toStrictEqual([{ year: YEAR, matchIds: [yearMatchIdOf(1)] }]);

    const withoutBracket = createBoardFakes({
      matches,
      brackets: [current],
      years: [YEAR_ROW, PREVIOUS_YEAR_ROW],
      ofMatch: ofMatchFrom([current, previous]),
    });
    const keptRounds = await withoutBracket.reader.read(today, noonOf(today));
    expect(keptRounds.map(({ tournament }) => tournament.year)).toStrictEqual([
      YEAR,
    ]);

    const weekOf = new Map([
      ...ofMatchFrom([current]),
      [
        yearMatchIdOf(9),
        {
          bracketId: PREVIOUS_YEAR_ROW.bracketId ?? '',
          kind: 'week' as const,
          tournamentId: PREVIOUS_YEAR_ROW.yearTournamentId,
        },
      ],
    ]);
    const weekBracket = createBoardFakes({
      matches,
      brackets: [current, previous],
      years: [YEAR_ROW, PREVIOUS_YEAR_ROW],
      ofMatch: weekOf,
    });
    const yearOnly = await weekBracket.reader.read(today, noonOf(today));
    expect(yearOnly.map(({ tournament }) => tournament.year)).toStrictEqual([
      YEAR,
    ]);
  });

  test('マッチのラウンドがブラケットの形の範囲外なら、その年の行を作らない', async () => {
    const today = date('2027-06-13');
    const bracket = bracketOf(YEAR_ROW, [
      { matchId: yearMatchIdOf(6), round: 6, position: 1, matchDate: today },
    ]);
    const { reader } = createBoardFakes({
      matches: [yearMatch(6, 6, today)],
      brackets: [bracket],
      years: [YEAR_ROW],
    });

    expect(await reader.read(today, noonOf(today))).toStrictEqual([]);
  });

  test('その日にYearのマッチが無ければ空の一覧を返し、ブラケットと年の行を読まない', async () => {
    const { reader, reads } = createBoardFakes({
      matches: [],
      brackets: [],
      years: [],
    });

    const rounds = await reader.read(
      FIRST_ROUND_DATE,
      noonOf(FIRST_ROUND_DATE),
    );

    expect(rounds).toStrictEqual([]);
    expect(reads.dateReads).toHaveLength(1);
    expect(reads.matchBracketReads).toStrictEqual([]);
    expect(reads.bracketReads).toStrictEqual([]);
    expect(reads.yearReads).toStrictEqual([]);
  });

  test('マッチの数によらず、Yearのマッチの照会とブラケットの引き当てを1回ずつ行い、ブラケットと年の行は年ごとに1回だけ読む', async () => {
    const row = yearRowOf({
      status: 'in_progress',
      bracketId: '01JF0YBRKT0000000000000001',
      firstRoundDate: FIRST_ROUND_DATE,
      participantCount: 32,
    });
    const indexes = Array.from({ length: 16 }, (_, index) => index + 1);
    const bracket = bracketOf(
      row,
      indexes.map((index) => ({
        matchId: yearMatchIdOf(index),
        round: 1,
        position: index,
        matchDate: FIRST_ROUND_DATE,
      })),
    );
    const { reader, reads } = createBoardFakes({
      matches: indexes.map((index) => yearMatch(index, 1, FIRST_ROUND_DATE)),
      brackets: [bracket],
      years: [row],
    });
    const now = noonOf(FIRST_ROUND_DATE);

    const rounds = await reader.read(FIRST_ROUND_DATE, now);

    expect(rounds.map(({ matchIds }) => matchIds.length)).toStrictEqual([16]);
    expect(reads.dateReads).toStrictEqual([
      { date: FIRST_ROUND_DATE, kinds: ['year'], now },
    ]);
    expect(reads.matchBracketReads).toStrictEqual([
      indexes.map((index) => yearMatchIdOf(index)),
    ]);
    expect(reads.bracketReads).toStrictEqual([bracket.bracketId]);
    expect(reads.yearReads).toStrictEqual([row.yearTournamentId]);
  });
});
