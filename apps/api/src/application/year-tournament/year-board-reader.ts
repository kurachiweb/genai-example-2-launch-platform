import { inject, injectable } from 'inversify';

import { tournamentRoundName } from '../../../common-lib/tournament/round-name.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { MATCH_PLATFORM_TYPES } from '../../../lib/core/match/identifiers.ts';
import type {
  MatchDirectory,
  MatchRecord,
} from '../../../lib/core/match/ports.ts';
import type { BusinessDate } from '../../../lib/core/time/business-time.ts';
import { roundSlotCount } from '../../../lib/core/tournament/bracket-shape.ts';
import { TOURNAMENT_PLATFORM_TYPES } from '../../../lib/core/tournament/identifiers.ts';
import type {
  BracketOfMatch,
  BracketRecord,
  BracketStore,
} from '../../../lib/core/tournament/ports.ts';
import { dailyRoundPolicy } from '../../../lib/core/tournament/round-schedule.ts';
import { YEAR_TOURNAMENT_TYPES } from '../../../lib/core/year-tournament/identifiers.ts';
import type {
  YearTournamentRecord,
  YearTournamentStore,
} from '../../../lib/core/year-tournament/ports.ts';
import { yearBracketPathOf } from './year-bracket-path.ts';

export interface YearBoardRound {
  readonly tournament: YearTournamentRecord;
  readonly round: number;
  readonly roundName: string;
  // 記録された最新のラウンドの実施日から、残りのラウンドを日次の進行の規則で求める
  readonly finalDate: BusinessDate;
  readonly isFinal: boolean;
  // ブラケットの位置の昇順
  readonly matchIds: readonly string[];
  readonly bracketPath: string;
}

export interface YearBoardReader {
  // 年の昇順
  read(date: BusinessDate, now: Date): Promise<readonly YearBoardRound[]>;
}

interface RoundGroup {
  readonly of: BracketOfMatch;
  readonly round: number;
  readonly matchIds: readonly string[];
}

const YEAR_KINDS = Object.freeze(['year'] as const);

const logger = getAppLogger(['api', 'application', 'year-tournament']);

function groupByRound(
  records: readonly MatchRecord[],
  brackets: ReadonlyMap<string, BracketOfMatch>,
): RoundGroup[] {
  const groups = new Map<string, RoundGroup>();
  for (const { matchId, round } of records) {
    const of = brackets.get(matchId);
    if (of?.kind !== 'year' || round === null) {
      continue;
    }
    const key = `${of.bracketId}:${String(round)}`;
    const group = groups.get(key);
    groups.set(key, {
      of,
      round,
      matchIds: [...(group?.matchIds ?? []), matchId],
    });
  }
  return [...groups.values()];
}

function isRoundOf(bracket: BracketRecord, round: number): boolean {
  return (
    Number.isInteger(round) && round >= 1 && round <= bracket.shape.roundCount
  );
}

function finalDateOf(
  bracket: BracketRecord,
  current: { readonly round: number; readonly date: BusinessDate },
  now: Date,
): BusinessDate {
  const latest = bracket.matches.reduce(
    (found, { round, matchDate }) =>
      round > found.round || (round === found.round && matchDate > found.date)
        ? { round, date: matchDate }
        : found,
    current,
  );
  const policy = dailyRoundPolicy(bracket.firstRoundDate ?? current.date, now);
  let finalDate = latest.date;
  for (
    let round = latest.round + 1;
    round <= bracket.shape.roundCount;
    round += 1
  ) {
    finalDate = policy.nextRoundDate(finalDate, now);
  }
  return finalDate;
}

function inBracketOrder(
  bracket: BracketRecord,
  group: RoundGroup,
): readonly string[] {
  const positions = new Map(
    bracket.matches
      .filter(({ round }) => round === group.round)
      .map(({ matchId, position }) => [matchId, position]),
  );
  return group.matchIds.toSorted(
    (a, b) =>
      (positions.get(a) ?? Number.POSITIVE_INFINITY) -
      (positions.get(b) ?? Number.POSITIVE_INFINITY),
  );
}

function boardRoundOf(
  group: RoundGroup,
  bracket: BracketRecord,
  tournament: YearTournamentRecord,
  date: BusinessDate,
  now: Date,
): YearBoardRound | undefined {
  const { round } = group;
  if (!isRoundOf(bracket, round)) {
    return undefined;
  }
  return {
    tournament,
    round,
    roundName: tournamentRoundName({
      round,
      slotCount: roundSlotCount(bracket.shape, round),
    }),
    finalDate: finalDateOf(bracket, { round, date }, now),
    isFinal: round === bracket.shape.roundCount,
    matchIds: inBracketOrder(bracket, group),
    bracketPath: yearBracketPathOf(tournament.year),
  };
}

function compareRounds(a: YearBoardRound, b: YearBoardRound): number {
  return a.tournament.year - b.tournament.year || a.round - b.round;
}

@injectable()
export class DirectoryYearBoardReader implements YearBoardReader {
  constructor(
    @inject(MATCH_PLATFORM_TYPES.MatchDirectory)
    private readonly matches: Pick<MatchDirectory, 'listForDate'>,
    @inject(TOURNAMENT_PLATFORM_TYPES.BracketStore)
    private readonly brackets: Pick<
      BracketStore,
      'findByMatchIds' | 'findById'
    >,
    @inject(YEAR_TOURNAMENT_TYPES.YearTournamentStore)
    private readonly store: Pick<YearTournamentStore, 'findById'>,
  ) {}

  // マッチの数によらず、マッチとブラケットの引き当ては1回ずつ、ブラケットと年の行は年の数だけ読む
  async read(
    date: BusinessDate,
    now: Date,
  ): Promise<readonly YearBoardRound[]> {
    const records = await this.matches.listForDate({
      date,
      kinds: YEAR_KINDS,
      now,
    });
    if (records.length === 0) {
      return [];
    }
    const groups = groupByRound(
      records,
      await this.brackets.findByMatchIds(records.map(({ matchId }) => matchId)),
    );
    const bracketIds = [...new Set(groups.map(({ of }) => of.bracketId))];
    const tournamentIds = [...new Set(groups.map(({ of }) => of.tournamentId))];
    const [brackets, tournaments] = await Promise.all([
      Promise.all(bracketIds.map((id) => this.brackets.findById(id))),
      Promise.all(tournamentIds.map((id) => this.store.findById(id))),
    ]);
    const bracketOf = new Map(
      brackets.flatMap((bracket) =>
        bracket === undefined ? [] : [[bracket.bracketId, bracket]],
      ),
    );
    const tournamentOf = new Map(
      tournaments.flatMap((tournament) =>
        tournament === undefined
          ? []
          : [[tournament.yearTournamentId, tournament]],
      ),
    );
    return groups
      .flatMap((group) => {
        const bracket = bracketOf.get(group.of.bracketId);
        const tournament = tournamentOf.get(group.of.tournamentId);
        const row =
          bracket === undefined || tournament === undefined
            ? undefined
            : boardRoundOf(group, bracket, tournament, date, now);
        // 不整合な1件でトップページの区画全体をエラーにしないため、行を作れない年は除く
        if (row === undefined) {
          logger.warn('トップページの区画に置けない年を除きました', {
            bracketId: group.of.bracketId,
            yearTournamentId: group.of.tournamentId,
            round: group.round,
          });
          return [];
        }
        return [row];
      })
      .toSorted(compareRounds);
  }
}
