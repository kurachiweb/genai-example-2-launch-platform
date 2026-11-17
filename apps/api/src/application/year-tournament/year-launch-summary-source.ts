import { inject, injectable } from 'inversify';

import { roundLabel } from '../../../common-lib/tournament/round-name.ts';
import { MATCH_PLATFORM_TYPES } from '../../../lib/core/match/identifiers.ts';
import type {
  MatchDirectory,
  MatchRecord,
} from '../../../lib/core/match/ports.ts';
import type { QualifierOutcome } from '../../../lib/core/product/launch-status.ts';
import {
  type BracketShape,
  roundStage,
} from '../../../lib/core/tournament/bracket-shape.ts';
import { TOURNAMENT_PLATFORM_TYPES } from '../../../lib/core/tournament/identifiers.ts';
import type {
  BracketParticipantStanding,
  BracketStore,
} from '../../../lib/core/tournament/ports.ts';
import { YEAR_TOURNAMENT_TYPES } from '../../../lib/core/year-tournament/identifiers.ts';
import type {
  YearCalendar,
  YearCalendarEntry,
  YearEntryRecord,
  YearEntryStore,
} from '../../../lib/core/year-tournament/ports.ts';
import type {
  LaunchSummaryContribution,
  LaunchSummarySource,
  ProductAwardContribution,
} from '../product/decision-sources.ts';
import {
  resolveTargetIn,
  targetYearCandidates,
} from './year-launch-standings.ts';

// tournament-weekの要約より大きい順位を使う
const RANKS = Object.freeze({
  champion: 100,
  inMatch: 90,
  advanced: 80,
  eliminated: 80,
  entitled: 70,
  accepting: 60,
});

const CHAMPION_LABEL = 'Product of the Year';
const ENTITLED_LABEL = 'Yearトーナメント参加決定';
const ACCEPTING_LABEL = 'Yearトーナメント参加受付中';

interface SummaryLaunch {
  readonly launchId: string;
  readonly productId: string;
  readonly outcome: QualifierOutcome | null;
}

interface SummaryTarget {
  readonly launch: SummaryLaunch;
  readonly entry: YearEntryRecord;
}

interface SummaryContext {
  readonly calendar: ReadonlyMap<number, YearCalendarEntry>;
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

function roundContribution(
  launchId: string,
  shape: BracketShape,
  round: number,
  suffix: 'マッチ中' | '進出' | '敗退',
): LaunchSummaryContribution | undefined {
  const name = roundNameOf(shape, round);
  const label = name === undefined ? undefined : `Year${name}${suffix}`;
  switch (suffix) {
    case 'マッチ中':
      return contributionOf(launchId, label, RANKS.inMatch, true);
    case '進出':
      return contributionOf(launchId, label, RANKS.advanced);
    case '敗退':
      return contributionOf(launchId, label, RANKS.eliminated);
  }
}

// 直近のYearのマッチから現在のラウンドを求める。ブラケットへの敗退の記録は夜の進行で行うため、確定した負けもここで敗退とみなす
function contendingContribution(
  launchId: string,
  { shape }: BracketParticipantStanding,
  matches: readonly MatchRecord[],
): LaunchSummaryContribution | undefined {
  const yearMatches = matches.filter(({ kind }) => kind === 'year');
  const latest = yearMatches[0];
  if (latest === undefined) {
    return contributionOf(launchId, ENTITLED_LABEL, RANKS.entitled);
  }
  const { round, phase } = latest;
  if (round === null) {
    return undefined;
  }
  if (phase === 'live') {
    return roundContribution(launchId, shape, round, 'マッチ中');
  }
  if (phase === 'finished') {
    const side = latest.entries.find((entry) => entry.launchId === launchId);
    return side?.result === 'lost'
      ? roundContribution(launchId, shape, round, '敗退')
      : roundContribution(launchId, shape, round + 1, '進出');
  }
  const played = yearMatches.some((match) => match.phase === 'finished');
  return played
    ? roundContribution(launchId, shape, round, '進出')
    : contributionOf(launchId, ENTITLED_LABEL, RANKS.entitled);
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
    return roundContribution(
      launch.launchId,
      standing.shape,
      standing.eliminatedRound,
      '敗退',
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

function acceptingContribution(
  { launch, entry }: SummaryTarget,
  context: SummaryContext,
): LaunchSummaryContribution | undefined {
  const target = resolveTargetIn(entry.awardedDate, context.calendar);
  return target.kind === 'open' &&
    context.at.getTime() < target.year.schedule.acceptUntil.getTime()
    ? contributionOf(launch.launchId, ACCEPTING_LABEL, RANKS.accepting)
    : undefined;
}

function launchContribution(
  target: SummaryTarget,
  context: SummaryContext,
): LaunchSummaryContribution | undefined {
  switch (target.entry.status) {
    case 'awaiting_payment':
      return acceptingContribution(target, context);
    case 'entitled':
      return contributionOf(
        target.launch.launchId,
        ENTITLED_LABEL,
        RANKS.entitled,
      );
    case 'drawn':
      return drawnContribution(target, context);
    default:
      return undefined;
  }
}

function championYearOf(
  entry: YearEntryRecord,
  calendar: ReadonlyMap<number, YearCalendarEntry>,
): number | undefined {
  if (entry.status !== 'drawn' || entry.classifiedYear === null) {
    return undefined;
  }
  const record = calendar.get(entry.classifiedYear)?.record;
  return record?.outcome === 'awarded' &&
    record.championEntryId === entry.entryId
    ? record.year
    : undefined;
}

// 受付中の枠は対象年を求めるためWeek優勝の日から4年分を、組み合わせの対象の枠は分類した年を読む
function yearsToDescribe(targets: readonly SummaryTarget[]): readonly number[] {
  const years = new Set<number>();
  for (const { entry } of targets) {
    if (entry.status === 'awaiting_payment') {
      for (const year of targetYearCandidates(entry.awardedDate)) {
        years.add(year);
      }
    } else if (entry.status === 'drawn' && entry.classifiedYear !== null) {
      years.add(entry.classifiedYear);
    }
  }
  return [...years].sort((left, right) => left - right);
}

@injectable()
export class YearLaunchSummarySource implements LaunchSummarySource {
  constructor(
    @inject(YEAR_TOURNAMENT_TYPES.YearEntryStore)
    private readonly entries: YearEntryStore,
    @inject(TOURNAMENT_PLATFORM_TYPES.BracketStore)
    private readonly brackets: BracketStore,
    @inject(YEAR_TOURNAMENT_TYPES.YearCalendar)
    private readonly calendar: YearCalendar,
    @inject(MATCH_PLATFORM_TYPES.MatchDirectory)
    private readonly matchDirectory: MatchDirectory,
  ) {}

  // 対象の数によらず、枠・年の日程・参加者の状態・マッチをそれぞれ1回の一括の読み取りで引き当てる
  async summarize(input: {
    readonly launches: readonly SummaryLaunch[];
    readonly at: Date;
  }): Promise<SummaryResult> {
    const won = input.launches.filter(({ outcome }) => outcome === 'won');
    if (won.length === 0) {
      return EMPTY_RESULT;
    }
    const entries = await this.entries.findByLaunches(
      won.map(({ launchId }) => launchId),
    );
    const targets = won.flatMap((launch): SummaryTarget[] => {
      const entry = entries.get(launch.launchId);
      return entry === undefined ? [] : [{ launch, entry }];
    });
    if (targets.length === 0) {
      return EMPTY_RESULT;
    }
    const drawn = targets.filter(({ entry }) => entry.status === 'drawn');
    const years = yearsToDescribe(targets);
    const [calendar, standings, matches] = await Promise.all([
      years.length === 0
        ? new Map<number, YearCalendarEntry>()
        : this.calendar.describe(years, input.at),
      drawn.length === 0
        ? new Map<string, BracketParticipantStanding>()
        : this.brackets.findParticipantStandings(
            'year',
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
      calendar,
      standings,
      matches,
      at: input.at,
    };
    const launches: LaunchSummaryContribution[] = [];
    const awards: ProductAwardContribution[] = [];
    for (const target of targets) {
      const championYear = championYearOf(target.entry, calendar);
      if (championYear !== undefined) {
        launches.push({
          launchId: target.launch.launchId,
          label: CHAMPION_LABEL,
          inMatch: false,
          rank: RANKS.champion,
        });
        awards.push({
          productId: target.launch.productId,
          kind: 'year',
          label: `${String(championYear)}年`,
        });
        continue;
      }
      const contribution = launchContribution(target, context);
      if (contribution !== undefined) {
        launches.push(contribution);
      }
    }
    return { launches, awards };
  }
}
