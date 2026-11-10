import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { MATCH_PLATFORM_TYPES } from '../../../lib/core/match/identifiers.ts';
import { decideAtFullTime } from '../../../lib/core/match/match-decision.ts';
import type { MatchEventDispatcher } from '../../../lib/core/match/ports.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { MATCH_TYPES } from './match-types.ts';
import type {
  DueSettlement,
  SettlementStore,
  SettlementWrite,
} from './ports.ts';

export const MATCH_SETTLEMENT_READ_LIMIT = 100;

export const MATCH_SETTLEMENT_WRITE_LIMIT = 50;

// 同じ23:40の起動で先に動く決済の突合が予定時刻から4分で打ち切るため、残りの1分のうちに終える
export const MATCH_SETTLEMENT_TIME_LIMIT_MS = (4 * 60 + 50) * 1000;

export interface SettlementSummary {
  // この呼び出しで確定したマッチの数
  readonly settled: number;
  readonly truncated: boolean;
}

export interface MatchSettlement {
  // nowは終了の日時と比べる実行時刻。deadlineを渡すと、100件の読み取りの前ごとに時計と比べて過ぎていれば残りを残して終える
  settleDue(now: Date, deadline?: Date): Promise<SettlementSummary>;
}

const logger = getAppLogger(['api', 'application', 'match']);

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

@injectable()
export class StoreMatchSettlement implements MatchSettlement {
  constructor(
    @inject(MATCH_TYPES.SettlementStore)
    private readonly store: SettlementStore,
    @inject(MATCH_PLATFORM_TYPES.MatchEventDispatcher)
    private readonly dispatcher: MatchEventDispatcher,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
    @inject(PLATFORM_TYPES.IdGenerator) private readonly ids: IdGenerator,
  ) {}

  // 決着を決められず未確定のまま残るマッチは同じ読み取りで再び返るため、一度扱ったマッチだけの読み取りで終える。残ったマッチは4:21の未確定の報告が拾う
  async settleDue(now: Date, deadline?: Date): Promise<SettlementSummary> {
    const attempted = new Set<string>();
    let settled = 0;
    for (;;) {
      if (deadline !== undefined && this.isPast(deadline)) {
        logger.warn(
          '打ち切りの時刻を過ぎたため、残りのマッチの確定を次のジョブに任せました',
          { settled },
        );
        return { settled, truncated: true };
      }
      const due = await this.store.listDue(now, MATCH_SETTLEMENT_READ_LIMIT);
      const fresh = due.filter((match) => !attempted.has(match.matchId));
      for (const match of fresh) {
        attempted.add(match.matchId);
      }
      settled += await this.settle(fresh, now);
      if (due.length < MATCH_SETTLEMENT_READ_LIMIT || fresh.length === 0) {
        return { settled, truncated: false };
      }
    }
  }

  private isPast(deadline: Date): boolean {
    return this.clock.now().getTime() >= deadline.getTime();
  }

  private async settle(
    matches: readonly DueSettlement[],
    now: Date,
  ): Promise<number> {
    const outcomes = matches.flatMap((match) => this.outcomeOf(match));
    let settled = 0;
    for (const page of chunk(outcomes, MATCH_SETTLEMENT_WRITE_LIMIT)) {
      const eventIds = await this.store.writeOutcomes(page, now);
      settled += eventIds.length;
      if (eventIds.length > 0) {
        await this.dispatcher.publish(eventIds);
      }
    }
    return settled;
  }

  private outcomeOf(match: DueSettlement): SettlementWrite[] {
    const [first, second] = match.entries;
    if (match.entryCount !== 2 || first === undefined || second === undefined) {
      logger.warn('側が2つでないマッチ中のマッチを確定できませんでした', {
        matchId: match.matchId,
        entryCount: match.entryCount,
      });
      return [];
    }
    try {
      return [
        {
          matchId: match.matchId,
          outcome: decideAtFullTime([first, second]),
          eventId: this.ids.generate(),
        },
      ];
    } catch (error: unknown) {
      if (!(error instanceof RangeError)) {
        throw error;
      }
      logger.warn('集計値が不整合なマッチを確定できませんでした', {
        matchId: match.matchId,
        error,
      });
      return [];
    }
  }
}
