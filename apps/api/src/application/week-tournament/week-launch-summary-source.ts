import { inject, injectable } from 'inversify';

import { roundLabel } from '../../../common-lib/tournament/round-name.ts';
import {
  formatWeekPeriodLabel,
  weekStartOf,
} from '../../../common-lib/tournament/week-period.ts';
import { MATCH_PLATFORM_TYPES } from '../../../lib/core/match/identifiers.ts';
import type {
  MatchDirectory,
  MatchRecord,
} from '../../../lib/core/match/ports.ts';
import type { QualifierOutcome } from '../../../lib/core/product/launch-status.ts';
import {
  type BusinessDate,
  parseBusinessDate,
} from '../../../lib/core/time/business-time.ts';
import {
  type BracketShape,
  roundStage,
} from '../../../lib/core/tournament/bracket-shape.ts';
import { TOURNAMENT_PLATFORM_TYPES } from '../../../lib/core/tournament/identifiers.ts';
import type {
  BracketParticipantStanding,
  BracketStore,
} from '../../../lib/core/tournament/ports.ts';
import { WEEK_TOURNAMENT_TYPES } from '../../../lib/core/week-tournament/identifiers.ts';
import type {
  WeekEntryRecord,
  WeekTournamentRecord,
  WeekTournamentStore,
} from '../../../lib/core/week-tournament/ports.ts';
import { entryWindowFor } from '../../../lib/core/week-tournament/week-schedule.ts';
import type {
  LaunchSummaryContribution,
  LaunchSummarySource,
  ProductAwardContribution,
} from '../product/decision-sources.ts';

// tournament-yearの要約はこれより大きい順位を使う
const RANKS = Object.freeze({
  champion: 50,
  inMatch: 40,
  advanced: 30,
  eliminated: 30,
  entitled: 20,
  accepting: 10,
});

const CHAMPION_LABEL = 'Product of the Week';
const ENTITLED_LABEL = 'Weekトーナメント参加決定';
const ACCEPTING_LABEL = 'Weekトーナメント参加受付中';

const FIRST_ROUND = 1;
const SECOND_ROUND = 2;

interface SummaryLaunch {
  readonly launchId: string;
  readonly productId: string;
  readonly outcome: QualifierOutcome | null;
}

interface SummaryTarget {
  readonly launch: SummaryLaunch;
  readonly entry: WeekEntryRecord;
  readonly weekStart: BusinessDate;
}

interface SummaryContext {
  readonly standings: ReadonlyMap<string, BracketParticipantStanding>;
  readonly matches: ReadonlyMap<string, readonly MatchRecord[]>;
  readonly at: Date;
}

interface SummaryResult {
  readonly launches: readonly LaunchSummaryContribution[];
  readonly awards: readonly ProductAwardContribution[];
}

const EMPTY_RESULT: SummaryResult = Object.freeze({
  launches: [],
  awards: [],
});

function roundNameOf(shape: BracketShape, round: number): string | undefined {
  if (!Number.isInteger(round) || round < 1 || round > shape.roundCount) {
    return undefined;
  }
  return roundLabel({ round, stage: roundStage(shape, round) }) ?? undefined;
}

function contributionOf(
  launchId: string,
  label: string | undefined,
  rank: number,
  inMatch = false,
): LaunchSummaryContribution | undefined {
  return label === undefined ? undefined : { launchId, label, inMatch, rank };
}

function eliminatedIn(
  launchId: string,
  shape: BracketShape,
  round: number,
): LaunchSummaryContribution | undefined {
  const name = roundNameOf(shape, round);
  return contributionOf(
    launchId,
    name === undefined ? undefined : `Week${name}敗退`,
    RANKS.eliminated,
  );
}

// 直近のWeekのマッチから現在のラウンドを求める。ブラケットへの敗退の記録は夜の進行で行うため、確定した負けもここで敗退とみなす
function contendingContribution(
  launchId: string,
  standing: BracketParticipantStanding,
  matches: readonly MatchRecord[],
): LaunchSummaryContribution | undefined {
  const { shape } = standing;
  const latest = matches.find(({ kind }) => kind === 'week');
  if (latest === undefined) {
    return advancedTo(
      launchId,
      shape,
      standing.participantNo <= shape.seedCount ? SECOND_ROUND : FIRST_ROUND,
    );
  }
  const { round, phase } = latest;
  if (round === null) {
    return undefined;
  }
  if (phase === 'live') {
    const name = roundNameOf(shape, round);
    return contributionOf(
      launchId,
      name === undefined ? undefined : `Week${name}マッチ中`,
      RANKS.inMatch,
      true,
    );
  }
  if (phase !== 'finished') {
    return advancedTo(launchId, shape, round);
  }
  const side = latest.entries.find((entry) => entry.launchId === launchId);
  return side?.result === 'lost'
    ? eliminatedIn(launchId, shape, round)
    : advancedTo(launchId, shape, round + 1);
}

function advancedTo(
  launchId: string,
  shape: BracketShape,
  round: number,
): LaunchSummaryContribution | undefined {
  const name = roundNameOf(shape, round);
  return contributionOf(
    launchId,
    name === undefined ? undefined : `Week${name}進出`,
    RANKS.advanced,
  );
}

function drawnContribution(
  { launch, entry }: SummaryTarget,
  context: SummaryContext,
): LaunchSummaryContribution | undefined {
  const standing = context.standings.get(entry.entryId);
  // 凍結の後、組み合わせを書き終えるまではブラケットの参加者が無い
  if (standing === undefined) {
    return contributionOf(launch.launchId, ENTITLED_LABEL, RANKS.entitled);
  }
  if (standing.eliminatedRound !== null) {
    return eliminatedIn(
      launch.launchId,
      standing.shape,
      standing.eliminatedRound,
    );
  }
  if (standing.status !== 'active' || standing.champion) {
    return undefined;
  }
  return contendingContribution(
    launch.launchId,
    standing,
    context.matches.get(launch.launchId) ?? [],
  );
}

function launchContribution(
  target: SummaryTarget,
  tournament: WeekTournamentRecord | undefined,
  context: SummaryContext,
): LaunchSummaryContribution | undefined {
  const { launch, entry, weekStart } = target;
  switch (entry.status) {
    case 'awaiting_payment': {
      const acceptUntil =
        tournament?.window.acceptUntil ?? entryWindowFor(weekStart).acceptUntil;
      return context.at.getTime() < acceptUntil.getTime()
        ? contributionOf(launch.launchId, ACCEPTING_LABEL, RANKS.accepting)
        : undefined;
    }
    case 'entitled':
      return contributionOf(launch.launchId, ENTITLED_LABEL, RANKS.entitled);
    case 'drawn':
      return drawnContribution(target, context);
    default:
      return undefined;
  }
}

function isChampion(
  entry: WeekEntryRecord,
  tournament: WeekTournamentRecord | undefined,
): boolean {
  return (
    tournament?.outcome === 'awarded' &&
    tournament.championEntryId === entry.entryId
  );
}

@injectable()
export class WeekLaunchSummarySource implements LaunchSummarySource {
  constructor(
    @inject(WEEK_TOURNAMENT_TYPES.WeekTournamentStore)
    private readonly store: WeekTournamentStore,
    @inject(TOURNAMENT_PLATFORM_TYPES.BracketStore)
    private readonly brackets: BracketStore,
    @inject(MATCH_PLATFORM_TYPES.MatchDirectory)
    private readonly matchDirectory: MatchDirectory,
  ) {}

  // 対象の数によらず、枠・週の行・参加者の状態・マッチをそれぞれ1回の一括の読み取りで引き当てる
  async summarize(input: {
    readonly launches: readonly SummaryLaunch[];
    readonly at: Date;
  }): Promise<SummaryResult> {
    const won = input.launches.filter(({ outcome }) => outcome === 'won');
    if (won.length === 0) {
      return EMPTY_RESULT;
    }
    const entries = await this.store.findEntriesByLaunch(
      won.map(({ launchId }) => launchId),
    );
    const targets = won.flatMap((launch): SummaryTarget[] => {
      const entry = entries.get(launch.launchId);
      return entry === undefined
        ? []
        : [
            {
              launch,
              entry,
              weekStart: parseBusinessDate(weekStartOf(entry.launchDate)),
            },
          ];
    });
    if (targets.length === 0) {
      return EMPTY_RESULT;
    }
    const drawn = targets.filter(({ entry }) => entry.status === 'drawn');
    const [tournaments, standings, matches] = await Promise.all([
      this.store.findTournamentsByWeeks([
        ...new Set(targets.map(({ weekStart }) => weekStart)),
      ]),
      drawn.length === 0
        ? new Map<string, BracketParticipantStanding>()
        : this.brackets.findParticipantStandings(
            'week',
            drawn.map(({ entry }) => entry.entryId),
          ),
      drawn.length === 0
        ? new Map<string, readonly MatchRecord[]>()
        : this.matchDirectory.listByLaunches(
            drawn.map(({ launch }) => launch.launchId),
            input.at,
          ),
    ]);
    const context: SummaryContext = {
      standings,
      matches,
      at: input.at,
    };
    const launches: LaunchSummaryContribution[] = [];
    const awards: ProductAwardContribution[] = [];
    for (const target of targets) {
      const tournament = tournaments.get(target.weekStart);
      if (isChampion(target.entry, tournament)) {
        launches.push({
          launchId: target.launch.launchId,
          label: CHAMPION_LABEL,
          inMatch: false,
          rank: RANKS.champion,
        });
        awards.push({
          productId: target.launch.productId,
          kind: 'week',
          label: formatWeekPeriodLabel(target.weekStart),
        });
        continue;
      }
      const contribution = launchContribution(target, tournament, context);
      if (contribution !== undefined) {
        launches.push(contribution);
      }
    }
    return { launches, awards };
  }
}
