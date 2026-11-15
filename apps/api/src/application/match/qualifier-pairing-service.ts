import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { MATCH_PLATFORM_TYPES } from '../../../lib/core/match/identifiers.ts';
import { qualifierWindow } from '../../../lib/core/match/match-model.ts';
import type {
  MatchScheduleInput,
  MatchScheduler,
  ScheduledEntryInput,
} from '../../../lib/core/match/ports.ts';
import {
  type PairingCandidate,
  type PairingResult,
  pairQualifiers,
  type RandomSource,
} from '../../../lib/core/match/qualifier-pairing.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../../lib/core/product/identifiers.ts';
import type {
  ScheduledLaunch,
  ScheduledLaunchDirectory,
} from '../../../lib/core/product/ports.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type { BusinessDate } from '../../../lib/core/time/business-time.ts';
import { MATCH_TYPES } from './match-types.ts';
import type { PairingCounts, PairingStore } from './ports.ts';

export const QUALIFIER_PAIRING_READ_LIMIT = 500;

export const QUALIFIER_PAIRING_WRITE_LIMIT = 50;

export const QUALIFIER_PAIRING_RETRY_LIMIT = 3;

export interface QualifierPairingService {
  // 対象日の予選を組み、この呼び出しで予定したマッチと側のローンチの数を返す
  pair(date: BusinessDate): Promise<PairingCounts>;
}

interface ScheduledRound extends PairingCounts {
  readonly skipped: number;
}

const logger = getAppLogger(['api', 'application', 'match']);

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

function entryOf(candidate: PairingCandidate): ScheduledEntryInput {
  return {
    launchId: candidate.launchId,
    productId: candidate.productId,
    ownerUserId: candidate.ownerUserId,
  };
}

@injectable()
export class StoreQualifierPairingService implements QualifierPairingService {
  constructor(
    @inject(MATCH_TYPES.PairingStore) private readonly store: PairingStore,
    @inject(PRODUCT_PLATFORM_TYPES.ScheduledLaunchDirectory)
    private readonly launches: ScheduledLaunchDirectory,
    @inject(MATCH_PLATFORM_TYPES.MatchScheduler)
    private readonly scheduler: MatchScheduler,
    @inject(MATCH_TYPES.RandomSource) private readonly random: RandomSource,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
    @inject(PLATFORM_TYPES.IdGenerator) private readonly ids: IdGenerator,
  ) {}

  // 23:40の締め切りの後にその日のローンチは増えないため、完了済みの日の再実行は通常は組む対象が無く何も書かない
  async pair(date: BusinessDate): Promise<PairingCounts> {
    const at = this.clock.now();
    const state = await this.store.beginDay(date, at);
    let candidates = await this.unpairedLaunches(date);
    if (state === 'already-completed' && candidates.length === 0) {
      return { launches: 0, matches: 0 };
    }
    let launches = 0;
    let matches = 0;
    for (let retries = 0; ; retries += 1) {
      const round = await this.scheduleRound(date, candidates, at);
      launches += round.launches;
      matches += round.matches;
      if (round.skipped === 0) {
        break;
      }
      // 別の実行が先に組んだローンチを含むマッチは作られず、その相手のローンチが組まれずに残るため組み直す。組み直しても残る日を完了にすると0:00の回復が組まないため、未完了のまま残して回復に委ねる
      if (retries === QUALIFIER_PAIRING_RETRY_LIMIT) {
        logger.warn(
          '別の実行と重なり組めなかったマッチが残ったため、ペアリングを未完了のまま残しました',
          { skipped: round.skipped },
        );
        return { launches, matches };
      }
      candidates = await this.unpairedLaunches(date);
    }
    const counts = { launches, matches };
    await this.store.completeDay(date, counts, this.clock.now());
    return counts;
  }

  private async scheduleRound(
    date: BusinessDate,
    candidates: readonly ScheduledLaunch[],
    at: Date,
  ): Promise<ScheduledRound> {
    const inputs = this.scheduleInputs(
      date,
      pairQualifiers(candidates, this.random),
    );
    let launches = 0;
    let matches = 0;
    let skipped = 0;
    for (const page of chunk(inputs, QUALIFIER_PAIRING_WRITE_LIMIT)) {
      const result = await this.scheduler.schedule(page, at);
      const createdIds = new Set(result.created);
      skipped += result.skipped.length;
      for (const input of page) {
        if (createdIds.has(input.matchId)) {
          matches += 1;
          launches += input.entries.length;
        }
      }
    }
    return { launches, matches, skipped };
  }

  private async unpairedLaunches(
    date: BusinessDate,
  ): Promise<readonly ScheduledLaunch[]> {
    const paired = await this.store.pairedLaunchIds(date);
    const result: ScheduledLaunch[] = [];
    let after: string | undefined;
    do {
      const page = await this.launches.listForDate({
        launchDate: date,
        after,
        limit: QUALIFIER_PAIRING_READ_LIMIT,
      });
      result.push(
        ...page.launches.filter((launch) => !paired.has(launch.launchId)),
      );
      after = page.next;
    } while (after !== undefined);
    return result;
  }

  private scheduleInputs(
    date: BusinessDate,
    pairing: PairingResult,
  ): MatchScheduleInput[] {
    const window = qualifierWindow(date);
    const inputOf = (
      entries: MatchScheduleInput['entries'],
    ): MatchScheduleInput => ({
      matchId: this.ids.generate(),
      kind: 'qualifier',
      round: null,
      stage: null,
      matchDate: date,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      entries,
    });
    const pairs = pairing.pairs.map(([first, second]) =>
      inputOf([entryOf(first), entryOf(second)]),
    );
    return pairing.bye === null
      ? pairs
      : [...pairs, inputOf([entryOf(pairing.bye)])];
  }
}
