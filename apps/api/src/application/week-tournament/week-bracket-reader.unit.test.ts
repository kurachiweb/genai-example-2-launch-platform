import { describe, expect, test } from 'bun:test';

import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import type {
  ProductDirectory,
  ProductLookupScope,
  ProductSummaryRecord,
} from '../../../lib/core/product/ports.ts';
import type {
  BracketKind,
  BracketRecord,
  BracketStore,
} from '../../../lib/core/tournament/ports.ts';
import type {
  WeekTournamentRecord,
  WeekTournamentStore,
} from '../../../lib/core/week-tournament/ports.ts';
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
  createWeekDecisionFakes,
  tournamentOf,
} from './testing/week-decision-fakes.ts';
import { DirectoryWeekBracketReader } from './week-bracket-reader.ts';

// 1回戦の2027-03-09は2027-03-01の週(2027-W09)のトーナメント
const WEEK_KEY = '2027-W09';
const WEEK_START = '2027-03-01';
const NOW = noonOf(FIRST_ROUND_DATE);

const DRAWN_WEEK = tournamentOf({
  tournamentId: '01JF0BRKTRN000000000000001',
  status: 'in_progress',
  drawStartedAt: new Date('2027-03-08T14:40:00.000Z'),
  bracketId: '01JF0BRKBRK000000000000001',
});

interface ReaderScenario {
  readonly tournament?: WeekTournamentRecord;
  readonly bracket?: BracketRecord;
  readonly matchViews?: ReadonlyMap<string, MatchView>;
  readonly summaries?: readonly ProductSummaryRecord[];
}

function createReaderFakes(scenario: ReaderScenario) {
  const reads = {
    weekReads: [] as string[],
    bracketReads: [] as { kind: BracketKind; tournamentId: string }[],
    viewReads: [] as Parameters<MatchViewReader['findViews']>[0][],
    summaryReads: [] as {
      productIds: readonly string[];
      scope: ProductLookupScope;
    }[],
  };
  const unused = (name: string) => (): never => {
    throw new Error(`照会は${name}を呼ばない`);
  };
  const store: WeekTournamentStore = {
    ...createWeekDecisionFakes().store,
    findTournamentByWeek(weekStart) {
      reads.weekReads.push(weekStart);
      return Promise.resolve(
        scenario.tournament?.window.weekStart === weekStart
          ? scenario.tournament
          : undefined,
      );
    },
  };
  const brackets: BracketStore = {
    ...createWeekDecisionFakes().brackets,
    findByTournament(kind, tournamentId) {
      reads.bracketReads.push({ kind, tournamentId });
      return Promise.resolve(
        scenario.bracket?.kind === kind &&
          scenario.bracket.tournamentId === tournamentId
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
    reader: new DirectoryWeekBracketReader(store, brackets, views, products),
    reads,
  };
}

const read = (
  scenario: ReaderScenario,
  week: string = WEEK_KEY,
  viewer?: CurrentUser,
) => {
  const fakes = createReaderFakes(scenario);
  return {
    ...fakes,
    result: fakes.reader.read({ week, viewer, now: NOW }),
  };
};

// 2人のブラケットで決勝を参加者1が勝ち、優勝が記録されている
const finishedFinal = (
  championProductId: string | null = productOf(1).productId,
): BracketRecord => {
  const record = recordOf({
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

describe('DirectoryWeekBracketReader.read', () => {
  test('ISO週の週の初日で週を引き、そのトーナメントのWeekのブラケットに表示の組み立ての結果を返す', async () => {
    const bracket = recordOf({
      participantCount: 13,
      matches: decided(N13_FIRST_ROUND, new Map([[1, 4]])),
    });
    const matchViews = viewsOf(bracket, (match) => [
      { upvoteCount: match.position },
      { upvoteCount: match.position * 2 },
    ]);
    const viewer = voterOf();

    const { result, reads } = read(
      { tournament: DRAWN_WEEK, bracket, matchViews },
      WEEK_KEY,
      viewer,
    );

    expect(await result).toEqual({
      tournament: DRAWN_WEEK,
      rounds: buildBracketRoundsView({ record: bracket, matchViews, now: NOW }),
      champion: null,
    });
    expect(reads.weekReads).toEqual([WEEK_START]);
    expect(reads.bracketReads).toEqual([
      { kind: 'week', tournamentId: DRAWN_WEEK.tournamentId },
    ]);
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
      tournament: { ...DRAWN_WEEK, status: 'finished', outcome: 'awarded' },
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
        tournament: DRAWN_WEEK,
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
      tournament: DRAWN_WEEK,
      bracket,
      matchViews: finalViews(bracket),
    });

    const view = await result;
    expect(view?.rounds.championNo).toBe(1);
    expect(view?.champion).toBeNull();
    expect(reads.summaryReads).toEqual([]);
  });

  test.each(['2027-09', '2027-W9', '2027-W00', '2026-W54', '0000-W01', ''])(
    '不正な週(%p)は何も読まずにundefinedを返す',
    async (week) => {
      const { result, reads } = read(
        { tournament: DRAWN_WEEK, bracket: finishedFinal() },
        week,
      );

      expect(await result).toBeUndefined();
      expect(reads.weekReads).toEqual([]);
    },
  );

  test('週の行が無ければブラケットを読まずにundefinedを返す', async () => {
    const { result, reads } = read({ bracket: finishedFinal() });

    expect(await result).toBeUndefined();
    expect(reads.weekReads).toEqual([WEEK_START]);
    expect(reads.bracketReads).toEqual([]);
  });

  test.each(['open', 'drawing'] as const)(
    '組み合わせを記録していない%sの週はブラケットを読まずにundefinedを返す',
    async (status) => {
      const { result, reads } = read({
        tournament: { ...DRAWN_WEEK, status, bracketId: null },
        bracket: finishedFinal(),
      });

      expect(await result).toBeUndefined();
      expect(reads.bracketReads).toEqual([]);
    },
  );

  test('ブラケットが見つからなければマッチを読まずにundefinedを返す', async () => {
    const { result, reads } = read({ tournament: DRAWN_WEEK });

    expect(await result).toBeUndefined();
    expect(reads.viewReads).toEqual([]);
  });

  test('記録済みのマッチをマッチの表示の照会へ90件ずつ渡し、結果をまとめて組み立てる', async () => {
    // 参加250はシード6・1回戦122試合
    const base = recordOf({ participantCount: 250 });
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
    const bracket = recordOf({ participantCount: 250, matches: firstRound });
    const matchViews = viewsOf(bracket, () => [
      { upvoteCount: 1 },
      { upvoteCount: 2 },
    ]);

    const { result, reads } = read({
      tournament: DRAWN_WEEK,
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

  test('記録済みのマッチが無いブラケットはマッチの表示を読まずに組み立てる', async () => {
    const bracket = recordOf({ participantCount: 1, firstRoundDate: null });

    const { result, reads } = read({ tournament: DRAWN_WEEK, bracket });

    const view = await result;
    expect(view?.rounds).toEqual(
      buildBracketRoundsView({
        record: bracket,
        matchViews: new Map(),
        now: NOW,
      }),
    );
    expect(view?.rounds.rounds).toEqual([]);
    expect(reads.viewReads).toEqual([]);
  });
});
