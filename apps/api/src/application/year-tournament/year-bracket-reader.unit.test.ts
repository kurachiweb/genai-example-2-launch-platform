import { describe, expect, test } from 'bun:test';

import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import type {
  ProductDirectory,
  ProductLookupScope,
  ProductSummaryRecord,
} from '../../../lib/core/product/ports.ts';
import type {
  BracketRecord,
  BracketStore,
} from '../../../lib/core/tournament/ports.ts';
import type {
  YearTournamentRecord,
  YearTournamentStore,
} from '../../../lib/core/year-tournament/ports.ts';
import { productSummaryOf } from '../match/testing/kickoff-fakes.ts';
import { voterOf } from '../match/testing/upvote-fakes.ts';
import type { MatchView, MatchViewReader } from '../match/match-view-reader.ts';
import { productViewOf } from '../match/match-view-reader.ts';
import { buildBracketRoundsView } from '../tournament/bracket-view-builder.ts';
import {
  decided,
  FIRST_ROUND_DATE,
  type MatchFixture,
  N13_FIRST_ROUND,
  noonOf,
  productOf,
  recordOf,
  viewsOf,
} from '../tournament/testing/bracket-view-fixtures.ts';
import {
  createYearDecisionFakes,
  YEAR,
  yearRowOf,
} from './testing/year-decision-fakes.ts';
import { DirectoryYearBracketReader } from './year-bracket-reader.ts';

const YEAR_KEY = String(YEAR);
const NOW = noonOf(FIRST_ROUND_DATE);
const BRACKET_ID = '01JF0BRKBRK000000000000001';

const DRAWN_YEAR = yearRowOf({
  status: 'in_progress',
  drawStartedAt: new Date('2027-05-24T07:45:00.000Z'),
  bracketId: BRACKET_ID,
});

interface ReaderScenario {
  readonly tournament?: YearTournamentRecord;
  readonly bracket?: BracketRecord;
  readonly matchViews?: ReadonlyMap<string, MatchView>;
  readonly summaries?: readonly ProductSummaryRecord[];
}

const unused = (name: string) => (): never => {
  throw new Error(`照会は${name}を呼ばない`);
};

function createStore(
  scenario: ReaderScenario,
  yearReads: (readonly number[])[],
): YearTournamentStore {
  return {
    findByYears(years) {
      yearReads.push(years);
      const tournament = scenario.tournament;
      return Promise.resolve(
        new Map(
          tournament !== undefined && years.includes(tournament.year)
            ? [[tournament.year, tournament]]
            : [],
        ),
      );
    },
    ensureYear: unused('ensureYear'),
    findById: unused('findById'),
    listDue: unused('listDue'),
    listInProgress: unused('listInProgress'),
    latestFrozenDeadlineDate: unused('latestFrozenDeadlineDate'),
    freeze: unused('freeze'),
    markDrawn: unused('markDrawn'),
    recordFinish: unused('recordFinish'),
    listAwardedBetween: unused('listAwardedBetween'),
    listAwardsByProducts: unused('listAwardsByProducts'),
  };
}

function createReaderFakes(scenario: ReaderScenario) {
  const reads = {
    yearReads: [] as (readonly number[])[],
    bracketReads: [] as string[],
    viewReads: [] as Parameters<MatchViewReader['findViews']>[0][],
    summaryReads: [] as {
      productIds: readonly string[];
      scope: ProductLookupScope;
    }[],
  };
  const brackets: BracketStore = {
    ...createYearDecisionFakes().brackets,
    findById(bracketId) {
      reads.bracketReads.push(bracketId);
      return Promise.resolve(
        scenario.bracket?.bracketId === bracketId
          ? scenario.bracket
          : undefined,
      );
    },
  };
  const views: MatchViewReader = {
    findViews(input) {
      reads.viewReads.push(input);
      return Promise.resolve(
        new Map(
          [...(scenario.matchViews ?? new Map<string, MatchView>())].filter(
            ([matchId]) => input.matchIds.includes(matchId),
          ),
        ),
      );
    },
    assemble: unused('assemble'),
  };
  const products: ProductDirectory = {
    findSummaries(productIds, scope) {
      reads.summaryReads.push({ productIds, scope });
      return Promise.resolve(
        new Map(
          (scenario.summaries ?? [])
            .filter((summary) => productIds.includes(summary.productId))
            .map((summary) => [summary.productId, summary]),
        ),
      );
    },
    resolveHandle: unused('resolveHandle'),
    findDetail: unused('findDetail'),
    listLaunches: unused('listLaunches'),
  };
  return {
    reader: new DirectoryYearBracketReader(
      createStore(scenario, reads.yearReads),
      brackets,
      views,
      products,
    ),
    reads,
  };
}

const read = (
  scenario: ReaderScenario,
  year: string = YEAR_KEY,
  viewer?: CurrentUser,
) => {
  const fakes = createReaderFakes(scenario);
  return {
    ...fakes,
    result: fakes.reader.read({ year, viewer, now: NOW }),
  };
};

// 2人のブラケットで決勝を参加者1が勝ち、優勝が記録されている
const finishedFinal = (
  championProductId: string | null = productOf(1).productId,
): BracketRecord => {
  const record = recordOf({
    kind: 'year',
    participantCount: 2,
    status: 'finished',
    outcome: 'champion',
    championNo: 1,
    matches: [
      {
        round: 1,
        position: 1,
        participantNos: [1, 2],
        status: 'decided',
        winnerNo: 1,
      },
    ],
  });
  return {
    ...record,
    participants: record.participants.map((participant) =>
      participant.participantNo === 1
        ? { ...participant, productId: championProductId }
        : participant,
    ),
  };
};

const finalViews = (record: BracketRecord) =>
  viewsOf(record, () => [
    { upvoteCount: 9, result: 'won' },
    { upvoteCount: 4, result: 'lost' },
  ]);

describe('DirectoryYearBracketReader.read', () => {
  test('4桁の年で年の行を引き、記録したブラケットのIDのブラケットに表示の組み立ての結果を返す', async () => {
    const bracket = recordOf({
      kind: 'year',
      participantCount: 13,
      matches: decided(N13_FIRST_ROUND, new Map([[1, 4]])),
    });
    const matchViews = viewsOf(bracket, (match) => [
      { upvoteCount: match.position },
      { upvoteCount: match.position * 2 },
    ]);
    const viewer = voterOf();

    const { result, reads } = read(
      { tournament: DRAWN_YEAR, bracket, matchViews },
      YEAR_KEY,
      viewer,
    );

    expect(await result).toEqual({
      tournament: DRAWN_YEAR,
      rounds: buildBracketRoundsView({ record: bracket, matchViews, now: NOW }),
      champion: null,
    });
    expect(reads.yearReads).toEqual([[YEAR]]);
    expect(reads.bracketReads).toEqual([BRACKET_ID]);
    expect(reads.viewReads).toEqual([
      {
        matchIds: bracket.matches.map(({ matchId }) => matchId),
        viewer,
        now: NOW,
      },
    ]);
    expect(reads.summaryReads).toEqual([]);
  });

  test('優勝の参加者のプロダクトを表示できる範囲で1回読み、マッチの表示と同じ形で返す', async () => {
    const bracket = finishedFinal();
    const summary = productSummaryOf(productOf(1).productId);

    const { result, reads } = read({
      tournament: { ...DRAWN_YEAR, status: 'finished', outcome: 'awarded' },
      bracket,
      matchViews: finalViews(bracket),
      summaries: [summary],
    });

    const view = await result;
    expect(view?.rounds.championNo).toBe(1);
    expect(view?.champion).toEqual(productViewOf(summary));
    expect(reads.summaryReads).toEqual([
      { productIds: [productOf(1).productId], scope: 'visible' },
    ]);
  });

  test('優勝のプロダクトが見つからない・表示できなければnullを返す', async () => {
    const bracket = finishedFinal();
    const scenarios: readonly (readonly ProductSummaryRecord[])[] = [
      [],
      [productSummaryOf(productOf(1).productId, { visible: false })],
    ];

    for (const summaries of scenarios) {
      const { result } = read({
        tournament: DRAWN_YEAR,
        bracket,
        matchViews: finalViews(bracket),
        summaries,
      });

      expect((await result)?.champion).toBeNull();
    }
  });

  test('優勝の参加者のプロダクトの紐付けが解除されていればプロダクトを読まずにnullを返す', async () => {
    const bracket = finishedFinal(null);

    const { result, reads } = read({
      tournament: DRAWN_YEAR,
      bracket,
      matchViews: finalViews(bracket),
    });

    const view = await result;
    expect(view?.rounds.championNo).toBe(1);
    expect(view?.champion).toBeNull();
    expect(reads.summaryReads).toEqual([]);
  });

  test('優勝の無いブラケットはプロダクトを読まずに優勝をnullにする', async () => {
    const bracket = recordOf({ kind: 'year', participantCount: 13 });

    const { result, reads } = read({ tournament: DRAWN_YEAR, bracket });

    const view = await result;
    expect(view?.rounds.championNo).toBeNull();
    expect(view?.champion).toBeNull();
    expect(reads.summaryReads).toEqual([]);
  });

  test.each(['27', '20270', '２０２７', '2027a', ''])(
    '4桁の年でない値(%p)は何も読まずにundefinedを返す',
    async (year) => {
      const { result, reads } = read(
        { tournament: DRAWN_YEAR, bracket: finishedFinal() },
        year,
      );

      expect(await result).toBeUndefined();
      expect(reads.yearReads).toEqual([]);
    },
  );

  test('年の行が無ければブラケットを読まずにundefinedを返す', async () => {
    const { result, reads } = read({ bracket: finishedFinal() }, '2031');

    expect(await result).toBeUndefined();
    expect(reads.yearReads).toEqual([[2031]]);
    expect(reads.bracketReads).toEqual([]);
  });

  test.each(['open', 'drawing'] as const)(
    '組み合わせを記録していない%sの年はブラケットを読まずにundefinedを返す',
    async (status) => {
      const { result, reads } = read({
        tournament: { ...DRAWN_YEAR, status, bracketId: null },
        bracket: finishedFinal(),
      });

      expect(await result).toBeUndefined();
      expect(reads.bracketReads).toEqual([]);
    },
  );

  test('ブラケットが見つからなければマッチを読まずにundefinedを返す', async () => {
    const { result, reads } = read({ tournament: DRAWN_YEAR });

    expect(await result).toBeUndefined();
    expect(reads.bracketReads).toEqual([BRACKET_ID]);
    expect(reads.viewReads).toEqual([]);
  });

  test('記録済みのマッチをマッチの表示の照会へ90件ずつ渡し、結果をまとめて組み立てる', async () => {
    // 参加250はシード6・1回戦122試合
    const base = recordOf({ kind: 'year', participantCount: 250 });
    const firstRound: readonly MatchFixture[] = Array.from(
      { length: base.shape.firstRoundMatchCount },
      (_, index) => ({
        round: 1,
        position: index + 1,
        participantNos: [
          base.shape.seedCount + index * 2 + 1,
          base.shape.seedCount + index * 2 + 2,
        ],
      }),
    );
    const bracket = recordOf({
      kind: 'year',
      participantCount: 250,
      matches: firstRound,
    });
    const matchViews = viewsOf(bracket, () => [
      { upvoteCount: 1 },
      { upvoteCount: 2 },
    ]);

    const { result, reads } = read({
      tournament: DRAWN_YEAR,
      bracket,
      matchViews,
    });

    const view = await result;
    expect(reads.viewReads.map(({ matchIds }) => matchIds.length)).toEqual([
      90, 32,
    ]);
    expect(reads.viewReads.flatMap(({ matchIds }) => matchIds)).toEqual(
      bracket.matches.map(({ matchId }) => matchId),
    );
    expect(view?.rounds).toEqual(
      buildBracketRoundsView({ record: bracket, matchViews, now: NOW }),
    );
  });
});
