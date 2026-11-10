import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { MATCH_PLATFORM_TYPES } from '../../../lib/core/match/identifiers.ts';
import { QUALIFIER_SCHEDULE } from '../../../lib/core/match/match-model.ts';
import type {
  MatchEventDispatcher,
  MatchEventStore,
} from '../../../lib/core/match/ports.ts';
import type {
  ScheduledJobContext,
  ScheduledJobDefinition,
  ScheduledJobHandler,
} from '../../../lib/core/scheduling/cron-registry.ts';
import {
  type BusinessDate,
  fromBusinessDateTime,
  toBusinessDateTime,
} from '../../../lib/core/time/business-time.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type { MatchKickoff } from './match-kickoff.ts';
import {
  MATCH_SETTLEMENT_TIME_LIMIT_MS,
  type MatchSettlement,
} from './match-settlement.ts';
import { MATCH_TYPES } from './match-types.ts';
import type {
  MatchIncidentReporter,
  PairingStore,
  SettlementStore,
} from './ports.ts';
import type { QualifierPairingService } from './qualifier-pairing-service.ts';

export const MATCH_EVENT_SWEEP_LIMIT = 50;

export const MATCH_EVENT_SWEEP_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

const MILLISECONDS_PER_DAY = 86_400_000;

const MATCH_JOB_ORDER = 1100;

// 同じ23:40の起動で決済の突合(order 10)の後に動く
export const MATCH_SETTLEMENT_JOB_DEFINITION: ScheduledJobDefinition =
  Object.freeze({
    name: 'match-engine.match-settlement',
    at: QUALIFIER_SCHEDULE.fullTime,
    order: MATCH_JOB_ORDER,
    handler: MATCH_TYPES.MatchSettlementJob,
  });

export const QUALIFIER_PAIRING_JOB_DEFINITION: ScheduledJobDefinition =
  Object.freeze({
    name: 'match-engine.qualifier-pairing',
    at: QUALIFIER_SCHEDULE.pairing,
    order: MATCH_JOB_ORDER,
    handler: MATCH_TYPES.QualifierPairingJob,
  });

export const MATCH_KICKOFF_JOB_DEFINITION: ScheduledJobDefinition =
  Object.freeze({
    name: 'match-engine.match-kickoff',
    at: QUALIFIER_SCHEDULE.kickoff,
    order: MATCH_JOB_ORDER,
    handler: MATCH_TYPES.MatchKickoffJob,
  });

const MAINTENANCE_TIME = Object.freeze({ hour: 4, minute: 21 });

export const MATCH_EVENT_REDISPATCH_JOB_DEFINITION: ScheduledJobDefinition =
  Object.freeze({
    name: 'match-engine.event-redispatch',
    at: MAINTENANCE_TIME,
    order: MATCH_JOB_ORDER,
    handler: MATCH_TYPES.MatchEventRedispatchJob,
  });

export const MATCH_EVENT_CLEANUP_JOB_DEFINITION: ScheduledJobDefinition =
  Object.freeze({
    name: 'match-engine.event-cleanup',
    at: MAINTENANCE_TIME,
    order: MATCH_JOB_ORDER + 10,
    handler: MATCH_TYPES.MatchEventCleanupJob,
  });

const MILLISECONDS_PER_HOUR = 3_600_000;

export const MATCH_EVENT_REDISPATCH_LIMIT = 100;

export const MATCH_EVENT_STALE_AFTER_MS = MILLISECONDS_PER_HOUR;

export const MATCH_SETTLEMENT_OVERDUE_AFTER_MS = MILLISECONDS_PER_HOUR;

export const MATCH_EVENT_RETENTION_MS = 30 * MILLISECONDS_PER_DAY;

// 起動の時間の予算とD1の負荷に収めるため1回の起動で消す件数を区切り、残りは翌日の起動に任せる
export const MATCH_EVENT_CLEANUP_BATCH_SIZE = 500;

export const MATCH_EVENT_CLEANUP_MAX_BATCHES = 10;

const logger = getAppLogger(['api', 'application', 'match']);

// 即時の終了は確定と同じ書き込みでイベントを作らず後続の非同期の処理に任せるため、その処理が失敗して確定のイベントが欠けたマッチを各ジョブの先頭で拾う
export async function sweepMissingDecidedEvents(
  events: MatchEventStore,
  dispatcher: MatchEventDispatcher,
  now: Date,
): Promise<number> {
  const decidedSince = new Date(now.getTime() - MATCH_EVENT_SWEEP_WINDOW_MS);
  let swept = 0;
  for (;;) {
    const created = await events.createMissingDecidedEvents(
      decidedSince,
      now,
      MATCH_EVENT_SWEEP_LIMIT,
    );
    swept += created.length;
    if (created.length > 0) {
      await dispatcher.publish(created);
    }
    if (created.length < MATCH_EVENT_SWEEP_LIMIT) {
      return swept;
    }
  }
}

// 業務時刻は固定のオフセットで夏時間が無いため、0:00の24時間後の業務日付が翌日になる
function nextBusinessDate(date: BusinessDate): BusinessDate {
  const startOfDay = fromBusinessDateTime(date, QUALIFIER_SCHEDULE.kickoff);
  return toBusinessDateTime(
    new Date(startOfDay.getTime() + MILLISECONDS_PER_DAY),
  ).date;
}

@injectable()
export class MatchSettlementJob implements ScheduledJobHandler {
  constructor(
    @inject(MATCH_TYPES.MatchSettlement)
    private readonly settlement: MatchSettlement,
    @inject(MATCH_PLATFORM_TYPES.MatchEventStore)
    private readonly events: MatchEventStore,
    @inject(MATCH_PLATFORM_TYPES.MatchEventDispatcher)
    private readonly dispatcher: MatchEventDispatcher,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  // 打ち切った残りは23:45のジョブの先頭の確定が行い、遅れの報告もそちらが行う
  async run({ scheduledTime }: ScheduledJobContext): Promise<void> {
    const now = this.clock.now();
    const swept = await sweepMissingDecidedEvents(
      this.events,
      this.dispatcher,
      now,
    );
    const { settled, truncated } = await this.settlement.settleDue(
      now,
      new Date(scheduledTime.getTime() + MATCH_SETTLEMENT_TIME_LIMIT_MS),
    );
    logger.info('終了の日時を過ぎたマッチを確定しました', {
      swept,
      settled,
      truncated,
    });
  }
}

@injectable()
export class QualifierPairingJob implements ScheduledJobHandler {
  constructor(
    @inject(MATCH_TYPES.MatchSettlement)
    private readonly settlement: MatchSettlement,
    @inject(MATCH_TYPES.QualifierPairingService)
    private readonly pairing: QualifierPairingService,
    @inject(MATCH_TYPES.MatchIncidentReporter)
    private readonly reporter: MatchIncidentReporter,
    @inject(MATCH_PLATFORM_TYPES.MatchEventStore)
    private readonly events: MatchEventStore,
    @inject(MATCH_PLATFORM_TYPES.MatchEventDispatcher)
    private readonly dispatcher: MatchEventDispatcher,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  // 翌日のトーナメントの対戦相手は当日の勝敗で決まるため、ペアリングの前に未確定のマッチを打ち切らずに確定する
  async run({ business }: ScheduledJobContext): Promise<void> {
    const now = this.clock.now();
    const swept = await sweepMissingDecidedEvents(
      this.events,
      this.dispatcher,
      now,
    );
    const { settled } = await this.settlement.settleDue(now);
    if (settled > 0) {
      this.reporter.report({ kind: 'match-settlement-late', count: settled });
    }
    const matchDate = nextBusinessDate(business.date);
    const { launches, matches } = await this.pairing.pair(matchDate);
    logger.info('翌日の予選を組みました', {
      swept,
      settled,
      matchDate,
      launches,
      matches,
    });
  }
}

@injectable()
export class MatchKickoffJob implements ScheduledJobHandler {
  constructor(
    @inject(MATCH_TYPES.MatchKickoff) private readonly kickoff: MatchKickoff,
    @inject(MATCH_TYPES.QualifierPairingService)
    private readonly pairing: QualifierPairingService,
    @inject(MATCH_TYPES.PairingStore)
    private readonly pairingDays: PairingStore,
    @inject(MATCH_TYPES.MatchIncidentReporter)
    private readonly reporter: MatchIncidentReporter,
    @inject(MATCH_PLATFORM_TYPES.MatchEventStore)
    private readonly events: MatchEventStore,
    @inject(MATCH_PLATFORM_TYPES.MatchEventDispatcher)
    private readonly dispatcher: MatchEventDispatcher,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async run({ business }: ScheduledJobContext): Promise<void> {
    const swept = await sweepMissingDecidedEvents(
      this.events,
      this.dispatcher,
      this.clock.now(),
    );
    const matchDate = business.date;
    let latePairedMatches = 0;
    if (!(await this.pairingDays.isDayCompleted(matchDate))) {
      ({ matches: latePairedMatches } = await this.pairing.pair(matchDate));
      this.reporter.report({
        kind: 'qualifier-pairing-late',
        count: latePairedMatches,
      });
    }
    // 遅れたペアリングが作ったマッチより後の時刻を開始の日時にするため、ペアリングの後に時計を読む
    const { started, decided } = await this.kickoff.kickoffDue(
      this.clock.now(),
    );
    logger.info('当日のマッチを開始しました', {
      swept,
      matchDate,
      latePairedMatches,
      started,
      decided,
    });
  }
}

@injectable()
export class MatchEventRedispatchJob implements ScheduledJobHandler {
  constructor(
    @inject(MATCH_PLATFORM_TYPES.MatchEventStore)
    private readonly events: MatchEventStore,
    @inject(MATCH_PLATFORM_TYPES.MatchEventDispatcher)
    private readonly dispatcher: MatchEventDispatcher,
    @inject(MATCH_TYPES.SettlementStore)
    private readonly settlements: SettlementStore,
    @inject(MATCH_TYPES.MatchIncidentReporter)
    private readonly reporter: MatchIncidentReporter,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  // 送信に失敗したイベントもpendingのまま最後の送信の日時が進むため、翌日の起動が再び拾う
  async run(): Promise<void> {
    const now = this.clock.now();
    const swept = await sweepMissingDecidedEvents(
      this.events,
      this.dispatcher,
      now,
    );
    // ストアは「より前」で比べるため、ちょうど1時間前に送ったイベントも含めるよう1ミリ秒後を渡す
    const stale = await this.events.listStalePending(
      new Date(now.getTime() - MATCH_EVENT_STALE_AFTER_MS + 1),
      MATCH_EVENT_REDISPATCH_LIMIT,
    );
    const eventIds = stale.map(({ id }) => id);
    if (eventIds.length > 0) {
      await this.dispatcher.publish(eventIds);
      await this.events.markRedispatched(eventIds, now);
    }
    const overdue = await this.settlements.countOverdue(
      new Date(now.getTime() - MATCH_SETTLEMENT_OVERDUE_AFTER_MS),
    );
    if (overdue > 0) {
      this.reporter.report({
        kind: 'match-settlement-overdue',
        count: overdue,
      });
    }
    logger.info('滞ったマッチイベントを送り直しました', {
      swept,
      redispatched: eventIds.length,
      overdue,
    });
  }
}

@injectable()
export class MatchEventCleanupJob implements ScheduledJobHandler {
  constructor(
    @inject(MATCH_PLATFORM_TYPES.MatchEventStore)
    private readonly events: MatchEventStore,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async run(): Promise<void> {
    const completedBefore = new Date(
      this.clock.now().getTime() - MATCH_EVENT_RETENTION_MS,
    );
    let deleted = 0;
    let batches = 0;
    let lastCount: number;
    do {
      lastCount = await this.events.deleteCompletedBefore(
        completedBefore,
        MATCH_EVENT_CLEANUP_BATCH_SIZE,
      );
      deleted += lastCount;
      batches += 1;
    } while (
      lastCount === MATCH_EVENT_CLEANUP_BATCH_SIZE &&
      batches < MATCH_EVENT_CLEANUP_MAX_BATCHES
    );
    logger.info('完了から30日を過ぎたマッチイベントを削除しました', {
      deleted,
      batches,
      limitReached: lastCount === MATCH_EVENT_CLEANUP_BATCH_SIZE,
    });
  }
}
