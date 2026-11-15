import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { MATCH_PLATFORM_TYPES } from '../../../lib/core/match/identifiers.ts';
import { decideAtKickoff } from '../../../lib/core/match/match-decision.ts';
import type { MatchEventDispatcher } from '../../../lib/core/match/ports.ts';
import { MATCH_TYPES } from './match-types.ts';
import type {
  DueKickoff,
  EntryEligibilityChecker,
  KickoffStore,
  KickoffWrite,
  MatchIncidentReporter,
} from './ports.ts';

export const MATCH_KICKOFF_READ_LIMIT = 100;

export const MATCH_KICKOFF_WRITE_LIMIT = 50;

export const MATCH_KICKOFF_LATE_AFTER_MS = 10 * 60 * 1000;

export interface KickoffSummary {
  // この呼び出しで開始したマッチの数
  readonly started: number;
  // この呼び出しで開始の時点に決着したマッチの数
  readonly decided: number;
}

export interface MatchKickoff {
  // nowは開始の日時と比べる実行時刻で、開始と決着の日時にもなる
  kickoffDue(now: Date): Promise<KickoffSummary>;
}

const logger = getAppLogger(['api', 'application', 'match']);

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

interface KickoffTally {
  started: number;
  decided: number;
  late: number;
}

@injectable()
export class StoreMatchKickoff implements MatchKickoff {
  constructor(
    @inject(MATCH_TYPES.KickoffStore) private readonly store: KickoffStore,
    @inject(MATCH_TYPES.EntryEligibilityChecker)
    private readonly eligibility: EntryEligibilityChecker,
    @inject(MATCH_PLATFORM_TYPES.MatchEventDispatcher)
    private readonly dispatcher: MatchEventDispatcher,
    @inject(MATCH_TYPES.MatchIncidentReporter)
    private readonly reporter: MatchIncidentReporter,
    @inject(PLATFORM_TYPES.IdGenerator) private readonly ids: IdGenerator,
  ) {}

  // 書き込みを拒まれたマッチ(読み取りの後に該当が記録された)は読み直して1回だけ試し直す。決着を決められないマッチと2回拒まれたマッチは同じ読み取りで再び返るため、それだけの読み取りで終える
  async kickoffDue(now: Date): Promise<KickoffSummary> {
    const finished = new Set<string>();
    const refused = new Set<string>();
    const tally: KickoffTally = { started: 0, decided: 0, late: 0 };
    for (;;) {
      const due = await this.store.listDue(now, MATCH_KICKOFF_READ_LIMIT);
      const fresh = due.filter((match) => !finished.has(match.matchId));
      if (fresh.length === 0) {
        break;
      }
      const written = await this.kickoff(fresh, now, tally);
      for (const { matchId } of fresh) {
        if (written.has(matchId) || refused.has(matchId)) {
          finished.add(matchId);
        } else {
          refused.add(matchId);
        }
      }
      const retrying = fresh.some((match) => !finished.has(match.matchId));
      if (due.length < MATCH_KICKOFF_READ_LIMIT && !retrying) {
        break;
      }
    }
    if (tally.late > 0) {
      this.reporter.report({ kind: 'match-kickoff-late', count: tally.late });
    }
    return { started: tally.started, decided: tally.decided };
  }

  // 書き込んだマッチと、決着を決められず書き込まないマッチのID
  private async kickoff(
    matches: readonly DueKickoff[],
    now: Date,
    tally: KickoffTally,
  ): Promise<ReadonlySet<string>> {
    const forfeited = await this.eligibility.forfeitedEntries(matches, now);
    const handled = new Set<string>();
    const writes: {
      readonly match: DueKickoff;
      readonly write: KickoffWrite;
    }[] = [];
    for (const match of matches) {
      const write = this.writeOf(match, forfeited);
      if (write === undefined) {
        handled.add(match.matchId);
      } else {
        writes.push({ match, write });
      }
    }
    for (const page of chunk(writes, MATCH_KICKOFF_WRITE_LIMIT)) {
      const eventIds = new Set(
        await this.store.writeKickoffs(
          page.map(({ write }) => write),
          now,
        ),
      );
      for (const { match, write } of page) {
        if (eventIds.has(write.eventId)) {
          handled.add(match.matchId);
          this.count(tally, match, write, now);
        }
      }
      if (eventIds.size > 0) {
        await this.dispatcher.publish([...eventIds]);
      }
    }
    return handled;
  }

  private count(
    tally: KickoffTally,
    match: DueKickoff,
    write: KickoffWrite,
    now: Date,
  ): void {
    if (write.outcome.kind === 'start') {
      tally.started += 1;
    } else {
      tally.decided += 1;
    }
    if (
      now.getTime() - match.startsAt.getTime() >
      MATCH_KICKOFF_LATE_AFTER_MS
    ) {
      tally.late += 1;
    }
  }

  private writeOf(
    match: DueKickoff,
    forfeited: ReadonlySet<string>,
  ): KickoffWrite | undefined {
    const standings = match.entries.map((entry) => ({
      entryId: entry.entryId,
      forfeited: forfeited.has(entry.entryId),
    }));
    try {
      return {
        matchId: match.matchId,
        outcome: decideAtKickoff(standings),
        eventId: this.ids.generate(),
        forfeitedEntryIds: standings
          .filter((standing) => standing.forfeited)
          .map((standing) => standing.entryId),
      };
    } catch (error: unknown) {
      if (!(error instanceof RangeError)) {
        throw error;
      }
      logger.warn('側の数が不正なマッチを開始できませんでした', {
        matchId: match.matchId,
        entryCount: match.entries.length,
      });
      return undefined;
    }
  }
}
