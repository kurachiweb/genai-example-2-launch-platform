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
import { WEEK_TOURNAMENT_TYPES } from '../../../lib/core/week-tournament/identifiers.ts';
import type {
  WeekTournamentRecord,
  WeekTournamentStore,
} from '../../../lib/core/week-tournament/ports.ts';
import { weekBracketPathOf } from './week-bracket-path.ts';

export interface WeekBoardRound {
  readonly tournament: WeekTournamentRecord;
  readonly firstRoundDate: BusinessDate;
  readonly round: number;
  readonly roundName: string;
  // 記録された最新のラウンドの実施日から、残りのラウンドを日次の進行の規則で求める
  readonly finalDate: BusinessDate;
  readonly isFinal: boolean;
  // ブラケットの位置の昇順
  readonly matchIds: readonly string[];
  readonly bracketPath: string;
}

export interface WeekBoardReader {
  // 1回戦の日の昇順
  read(date: BusinessDate, now: Date): Promise<readonly WeekBoardRound[]>;
}

interface RoundGroup {
  readonly of: BracketOfMatch;
  readonly round: number;
  readonly matchIds: readonly string[];
}

const WEEK_KINDS = Object.freeze(['week'] as const);

const logger = getAppLogger(['api', 'application', 'week-tournament']);

function groupByRound(
  records: readonly MatchRecord[],
  brackets: ReadonlyMap<string, BracketOfMatch>,
): RoundGroup[] {
  const groups = new Map<string, RoundGroup>();
  for (const { matchId, round } of records) {
    const of = brackets.get(matchId);
    if (of?.kind !== 'week' || round === null) {
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
  tournament: WeekTournamentRecord,
  date: BusinessDate,
  now: Date,
): WeekBoardRound | undefined {
  const { round } = group;
  if (bracket.firstRoundDate === null || !isRoundOf(bracket, round)) {
    return undefined;
  }
  return {
    tournament,
    firstRoundDate: bracket.firstRoundDate,
    round,
    roundName: tournamentRoundName({
      round,
      slotCount: roundSlotCount(bracket.shape, round),
    }),
    finalDate: finalDateOf(bracket, { round, date }, now),
    isFinal: round === bracket.shape.roundCount,
    matchIds: inBracketOrder(bracket, group),
    bracketPath: weekBracketPathOf(tournament.window.weekStart),
  };
}

function compareRounds(a: WeekBoardRound, b: WeekBoardRound): number {
  if (a.firstRoundDate !== b.firstRoundDate) {
    return a.firstRoundDate < b.firstRoundDate ? -1 : 1;
  }
  if (a.tournament.window.weekStart !== b.tournament.window.weekStart) {
    return a.tournament.window.weekStart < b.tournament.window.weekStart
      ? -1
      : 1;
  }
  return a.round - b.round;
}

@injectable()
export class DirectoryWeekBoardReader implements WeekBoardReader {
  constructor(
    @inject(MATCH_PLATFORM_TYPES.MatchDirectory)
    private readonly matches: MatchDirectory,
    @inject(TOURNAMENT_PLATFORM_TYPES.BracketStore)
    private readonly brackets: BracketStore,
    @inject(WEEK_TOURNAMENT_TYPES.WeekTournamentStore)
    private readonly store: WeekTournamentStore,
  ) {}

  // マッチの数によらず、マッチとブラケットの引き当ては1回ずつ、ブラケットと週の行はトーナメントの数だけ読む
  async read(
    date: BusinessDate,
    now: Date,
  ): Promise<readonly WeekBoardRound[]> {
    const records = await this.matches.listForDate({
      date,
      kinds: WEEK_KINDS,
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
      Promise.all(tournamentIds.map((id) => this.store.findTournament(id))),
    ]);
    const bracketOf = new Map(
      brackets.flatMap((bracket) =>
        bracket === undefined ? [] : [[bracket.bracketId, bracket]],
      ),
    );
    const tournamentOf = new Map(
      tournaments.flatMap((tournament) =>
        tournament === undefined ? [] : [[tournament.tournamentId, tournament]],
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
        // 不整合な1件でトップページの区画全体をエラーにしないため、行を作れないトーナメントは除く
        if (row === undefined) {
          logger.warn('トップページの区画に置けないトーナメントを除きました', {
            bracketId: group.of.bracketId,
            tournamentId: group.of.tournamentId,
            round: group.round,
          });
          return [];
        }
        return [row];
      })
      .toSorted(compareRounds);
  }
}
