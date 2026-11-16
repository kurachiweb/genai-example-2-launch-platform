import type { Logger } from '@logtape/logtape';
import { captureEvent } from '@sentry/cloudflare';

import { weekStartOf } from '../../../common-lib/tournament/week-period.ts';
import type { IdGenerator } from '../../core/ids/id-generator.ts';
import { isUppercaseUlid } from '../../core/ids/uppercase-ulid.ts';
import { getAppLogger } from '../../core/logging/app-logger.ts';
import { isWinningResult } from '../../core/match/match-model.ts';
import type { MatchRecord } from '../../core/match/ports.ts';
import { parseBusinessDate } from '../../core/time/business-time.ts';
import type { UltrasEntitlements } from '../../core/ultras/ports.ts';
import type {
  NewWeekEntry,
  WeekEntryRegistrar,
  WeekTournamentRecord,
  WeekTournamentStore,
} from '../../core/week-tournament/ports.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';

const LATE_ENTRY_MESSAGE =
  '組み合わせ決定の凍結の後に届いた予選の勝利を、期限切れの参加の枠で記録しました';

const UNSAFE_VALUE = 'unknown';

interface QualifierWinner {
  readonly launchId: string;
  readonly productId: string;
  readonly ownerUserId: string;
  readonly upvoteCount: number;
  readonly lastUpvoteElapsedMs: number | null;
}

type NewWeekEntryBase = Omit<
  NewWeekEntry,
  'status' | 'entitlementSource' | 'closeReason'
>;

function winnersOf(match: MatchRecord): QualifierWinner[] {
  return match.entries.flatMap(
    ({
      result,
      launchId,
      productId,
      ownerUserId,
      upvoteCount,
      lastUpvoteElapsedMs,
    }) =>
      result !== null &&
      isWinningResult(result) &&
      launchId !== null &&
      productId !== null &&
      ownerUserId !== null
        ? [
            {
              launchId,
              productId,
              ownerUserId,
              upvoteCount,
              lastUpvoteElapsedMs,
            },
          ]
        : [],
  );
}

export class QualifierWeekEntryRegistrar implements WeekEntryRegistrar {
  private readonly logger: Logger;

  constructor(
    private readonly store: WeekTournamentStore,
    private readonly entitlements: UltrasEntitlements,
    private readonly ids: IdGenerator,
    appName: LoggingOptions['appName'],
  ) {
    this.logger = getAppLogger([appName, 'week-tournament', 'entry']);
  }

  async registerFromMatch(
    match: MatchRecord,
    at: Date,
  ): Promise<readonly string[]> {
    const wonAt = match.decidedAt;
    if (match.kind !== 'qualifier' || wonAt === null) {
      return [];
    }
    const winners = winnersOf(match);
    if (winners.length === 0) {
      return [];
    }
    const tournament = await this.store.ensureTournament(
      parseBusinessDate(weekStartOf(match.matchDate)),
      at,
    );
    const created: string[] = [];
    for (const winner of winners) {
      const entryId = await this.register(tournament, {
        entryId: this.ids.generate(),
        tournamentId: tournament.tournamentId,
        launchId: winner.launchId,
        productId: winner.productId,
        ownerUserId: winner.ownerUserId,
        launchDate: match.matchDate,
        qualifierMatchId: match.matchId,
        qualifierUpvoteCount: winner.upvoteCount,
        qualifierLastUpvoteElapsedMs: winner.lastUpvoteElapsedMs,
        wonAt,
        at,
      });
      if (entryId !== undefined) {
        created.push(entryId);
      }
    }
    return created;
  }

  // 凍結済みの週と、未凍結の判定の後に凍結した週(挿入がfrozen)への勝利は、組み合わせに入れず期限切れで記録する
  private async register(
    tournament: WeekTournamentRecord,
    base: NewWeekEntryBase,
  ): Promise<string | undefined> {
    if (tournament.drawStartedAt === null) {
      const inserted = await this.store.insertEntry(
        (await this.entitlements.wasEntitledDuring(
          base.ownerUserId,
          base.wonAt,
          tournament.window.deadlineAt,
        ))
          ? {
              ...base,
              status: 'entitled',
              entitlementSource: 'ultras',
              closeReason: null,
            }
          : {
              ...base,
              status: 'awaiting_payment',
              entitlementSource: null,
              closeReason: null,
            },
      );
      if (inserted !== 'frozen') {
        return inserted === 'inserted' ? base.entryId : undefined;
      }
    }
    const late = await this.store.insertEntry({
      ...base,
      status: 'expired',
      entitlementSource: null,
      closeReason: 'late_entry',
    });
    if (late !== 'inserted') {
      return undefined;
    }
    this.reportLateEntry(base);
    return base.entryId;
  }

  // タグは除去処理の対象外のため、識別子の形の値だけを送る
  private reportLateEntry({
    tournamentId,
    entryId,
    qualifierMatchId,
  }: NewWeekEntryBase): void {
    this.logger.warn(LATE_ENTRY_MESSAGE, {
      tournamentId,
      entryId,
      matchId: qualifierMatchId,
    });
    // captureMessageの文言だけのイベントは、直前と同じ文言と指紋なら重複として捨てられる。文言をlogentryに置くと重複の判定から外れる
    captureEvent({
      level: 'warning',
      logentry: { message: LATE_ENTRY_MESSAGE },
      fingerprint: ['tournament', 'late-entry'],
      tags: {
        tournament_incident: 'late-entry',
        tournament_id: isUppercaseUlid(tournamentId)
          ? tournamentId
          : UNSAFE_VALUE,
      },
    });
  }
}
