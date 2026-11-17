import type { Logger } from '@logtape/logtape';
import { captureEvent } from '@sentry/cloudflare';

import { isoWeekKey } from '../../../common-lib/tournament/week-period.ts';
import type { IdGenerator } from '../../core/ids/id-generator.ts';
import { isUppercaseUlid } from '../../core/ids/uppercase-ulid.ts';
import { getAppLogger } from '../../core/logging/app-logger.ts';
import { isWinningResult } from '../../core/match/match-model.ts';
import type {
  MatchDirectory,
  MatchEntryRecord,
  MatchRecord,
} from '../../core/match/ports.ts';
import { toBusinessDateTime } from '../../core/time/business-time.ts';
import type { UltrasEntitlements } from '../../core/ultras/ports.ts';
import type {
  WeekChampion,
  WeekChampionDirectory,
} from '../../core/week-tournament/ports.ts';
import type {
  NewYearEntry,
  YearCalendar,
  YearCalendarEntry,
  YearEntryRegistrar,
  YearEntryStore,
} from '../../core/year-tournament/ports.ts';
import {
  resolveTargetYear,
  type TargetYearResolution,
} from '../../core/year-tournament/year-target-rules.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';

// resolveTargetYearが調べる年数(Week優勝の日の年〜3年後)
const TARGET_LOOKUP_YEARS = 4;

const LATE_ENTRY_MESSAGE =
  '組み合わせ決定の凍結の後に届いたWeek優勝を、Yearトーナメントの期限切れの参加の枠で記録しました';

const QUALIFIER_MISSING_MESSAGE =
  'Week優勝のローンチの予選の勝利が見つからないため、Yearトーナメントの参加の枠を作りませんでした';

const UNSAFE_TAG_VALUE = 'unknown';

type Incident = 'late-entry' | 'qualifier-missing';

type ChampionEntry = Omit<NewYearEntry, 'entryId' | 'initialStatus'>;

interface TargetedEntry {
  readonly entry: ChampionEntry;
  readonly target: TargetYearResolution;
}

export interface ChampionYearEntryRegistrarOptions {
  readonly appName: LoggingOptions['appName'];
  readonly champions: WeekChampionDirectory;
  readonly matches: MatchDirectory;
  readonly entitlements: UltrasEntitlements;
  readonly calendar: YearCalendar;
  readonly store: YearEntryStore;
  readonly ids: IdGenerator;
}

export interface SyncChampionsResult {
  readonly created: readonly string[];
  readonly late: readonly string[];
  // 予選が見つからず作らなかったWeek優勝の数。次の取り込みで再び試す
  readonly skipped: number;
}

function yearOf(awardedDate: string): number {
  return Number(awardedDate.slice(0, 4));
}

function winningSideOf(
  match: MatchRecord | undefined,
  launchId: string,
): MatchEntryRecord | undefined {
  return match?.entries.find(
    (side) =>
      side.launchId === launchId &&
      side.result !== null &&
      isWinningResult(side.result),
  );
}

function entryOf(
  champion: WeekChampion,
  match: MatchRecord,
  side: MatchEntryRecord,
): ChampionEntry {
  return {
    weekTournamentId: champion.tournamentId,
    weekPeriod: isoWeekKey(champion.weekStart),
    launchId: champion.launchId,
    productId: champion.productId,
    ownerUserId: champion.ownerUserId,
    launchDate: match.matchDate,
    qualifierMatchId: match.matchId,
    qualifierUpvoteCount: side.upvoteCount,
    qualifierLastUpvoteElapsedMs: side.lastUpvoteElapsedMs,
    awardedAt: champion.awardedAt,
    awardedDate: toBusinessDateTime(champion.awardedAt).date,
  };
}

function yearsCovering(entries: readonly ChampionEntry[]): number[] {
  const years = entries.map(({ awardedDate }) => yearOf(awardedDate));
  const first = Math.min(...years);
  const last = Math.max(...years) + TARGET_LOOKUP_YEARS - 1;
  return Array.from(
    { length: last - first + 1 },
    (_, offset) => first + offset,
  );
}

function lookupOf(
  calendar: ReadonlyMap<number, YearCalendarEntry>,
): (year: number) => YearCalendarEntry {
  return (year) => {
    const entry = calendar.get(year);
    if (entry === undefined) {
      throw new RangeError(`照会していない年です: ${String(year)}`);
    }
    return entry;
  };
}

// タグは除去処理の対象外のため、識別子の形の値だけを送る
function safeTagOf(value: string): string {
  return isUppercaseUlid(value) ? value : UNSAFE_TAG_VALUE;
}

function reportIncident(
  incident: Incident,
  message: string,
  weekTournamentId: string,
): void {
  // captureMessageの文言だけのイベントは、直前と同じ文言と指紋なら重複として捨てられる。文言をlogentryに置くと重複の判定から外れる
  captureEvent({
    level: 'warning',
    logentry: { message },
    fingerprint: ['tournament-year', incident],
    tags: {
      tournament_year_incident: incident,
      week_tournament_id: safeTagOf(weekTournamentId),
    },
  });
}

export class ChampionYearEntryRegistrar implements YearEntryRegistrar {
  private readonly logger: Logger;

  constructor(private readonly options: ChampionYearEntryRegistrarOptions) {
    this.logger = getAppLogger([options.appName, 'year-tournament', 'entry']);
  }

  async syncChampions(input: {
    readonly awardedFrom: Date | null;
    readonly now: Date;
  }): Promise<SyncChampionsResult> {
    const champions = await this.pendingChampions(input);
    if (champions.length === 0) {
      return Object.freeze({ created: [], late: [], skipped: 0 });
    }
    const entries = await this.entriesOf(champions, input.now);
    const targeted = await this.targetedOf(entries, input.now);
    const entitled = await this.entitledByUltras(targeted);
    const created: string[] = [];
    const late: string[] = [];
    for (const { entry } of targeted) {
      const entryId = this.options.ids.generate();
      const outcome = await this.options.store.insertFromChampion(
        {
          ...entry,
          entryId,
          initialStatus: entitled.has(entry) ? 'entitled' : 'awaiting_payment',
        },
        input.now,
      );
      if (outcome === 'inserted') {
        created.push(entryId);
      } else if (outcome === 'late') {
        late.push(entryId);
        this.reportLateEntry(entry, entryId);
      }
    }
    return Object.freeze({
      created,
      late,
      skipped: champions.length - entries.length,
    });
  }

  private async pendingChampions({
    awardedFrom,
    now,
  }: {
    readonly awardedFrom: Date | null;
    readonly now: Date;
  }): Promise<readonly WeekChampion[]> {
    const champions = await this.options.champions.listChampions({
      awardedFrom,
      awardedBefore: now,
    });
    if (champions.length === 0) {
      return [];
    }
    const existing = await this.options.store.findByWeekTournaments(
      champions.map(({ tournamentId }) => tournamentId),
    );
    return champions.filter(({ tournamentId }) => !existing.has(tournamentId));
  }

  // 予選の勝った側の確定値を写す。見つからないWeek優勝は作らずに知らせ、次の取り込みで再び試す
  private async entriesOf(
    champions: readonly WeekChampion[],
    now: Date,
  ): Promise<readonly ChampionEntry[]> {
    const results = await this.options.matches.findQualifierResults(
      champions.map(({ launchId }) => launchId),
    );
    const matchIds = [
      ...new Set([...results.values()].map(({ matchId }) => matchId)),
    ];
    const matches =
      matchIds.length === 0
        ? new Map<string, MatchRecord>()
        : await this.options.matches.findMatches(matchIds, now);
    return champions.flatMap((champion) => {
      const result = results.get(champion.launchId);
      const match =
        result === undefined ? undefined : matches.get(result.matchId);
      const side = winningSideOf(match, champion.launchId);
      if (match === undefined || side === undefined) {
        this.reportQualifierMissing(champion);
        return [];
      }
      return [entryOf(champion, match, side)];
    });
  }

  // 年の照会を1回にまとめ、Week優勝の日ごとの対象年を求める
  private async targetedOf(
    entries: readonly ChampionEntry[],
    now: Date,
  ): Promise<readonly TargetedEntry[]> {
    if (entries.length === 0) {
      return [];
    }
    const lookup = lookupOf(
      await this.options.calendar.describe(yearsCovering(entries), now),
    );
    return entries.map((entry) => ({
      entry,
      target: resolveTargetYear(entry.awardedDate, lookup),
    }));
  }

  // 期間の和で投稿者の候補を絞ってから、Week優勝からその対象年の決済期限までの期間を投稿者ごとに判定する
  private async entitledByUltras(
    targeted: readonly TargetedEntry[],
  ): Promise<ReadonlySet<ChampionEntry>> {
    const open = targeted.flatMap(({ entry, target }) =>
      target.kind === 'open'
        ? [{ entry, deadlineAt: target.year.schedule.deadlineAt }]
        : [],
    );
    if (open.length === 0) {
      return new Set();
    }
    const candidates = await this.options.entitlements.entitledUsersDuring(
      [...new Set(open.map(({ entry }) => entry.ownerUserId))],
      new Date(Math.min(...open.map(({ entry }) => entry.awardedAt.getTime()))),
      new Date(Math.max(...open.map(({ deadlineAt }) => deadlineAt.getTime()))),
    );
    const entitled = new Set<ChampionEntry>();
    for (const { entry, deadlineAt } of open) {
      if (
        candidates.has(entry.ownerUserId) &&
        (await this.options.entitlements.wasEntitledDuring(
          entry.ownerUserId,
          entry.awardedAt,
          deadlineAt,
        ))
      ) {
        entitled.add(entry);
      }
    }
    return entitled;
  }

  private reportQualifierMissing({ tournamentId }: WeekChampion): void {
    this.logger.warn(QUALIFIER_MISSING_MESSAGE, {
      weekTournamentId: tournamentId,
    });
    reportIncident(
      'qualifier-missing',
      QUALIFIER_MISSING_MESSAGE,
      tournamentId,
    );
  }

  private reportLateEntry(
    { weekTournamentId, qualifierMatchId }: ChampionEntry,
    entryId: string,
  ): void {
    this.logger.warn(LATE_ENTRY_MESSAGE, {
      weekTournamentId,
      entryId,
      matchId: qualifierMatchId,
    });
    reportIncident('late-entry', LATE_ENTRY_MESSAGE, weekTournamentId);
  }
}
