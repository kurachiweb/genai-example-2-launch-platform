import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type { SponsorshipRequestBody } from '../../../lib/core/messaging/contracts/sponsorship.ts';
import type {
  MessageHandler,
  MessageHandlingResult,
} from '../../../lib/core/messaging/message-contract.ts';
import type {
  NoticeRequester,
  NoticeScheduler,
  SponsorshipRecord,
  SponsorshipStore,
} from '../../../lib/core/sponsorship/ports.ts';
import { toBusinessDateTime } from '../../../lib/core/time/business-time.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type {
  PeriodEndSettlementCommitter,
  PeriodEndSettlementFailureReporter,
} from './ports.ts';

export const PERIOD_END_SETTLEMENT_LIMIT = 20;

// 系統的な障害で例外の広告が溜まっても、1回の読み取りと精算の試行がWorkersの1回の処理の上限に当たらないよう、除く件数を1回分に抑える
export const PERIOD_END_FAILURE_LIMIT = 20;

export const PERIOD_END_CONTINUE_DELAY_SECONDS = 5;

const DONE: MessageHandlingResult = Object.freeze({ kind: 'done' });

const CONTINUE: MessageHandlingResult = Object.freeze({
  kind: 'defer',
  delaySeconds: PERIOD_END_CONTINUE_DELAY_SECONDS,
});

const logger = getAppLogger(['event', 'sponsorship']);

type SettlementOutcome = 'settled' | 'skipped' | 'failed';

export interface PeriodEndSettlementHandlerDependencies {
  readonly sponsorships: SponsorshipStore;
  readonly committer: PeriodEndSettlementCommitter;
  readonly scheduler: NoticeScheduler;
  readonly requester: NoticeRequester;
  readonly failures: PeriodEndSettlementFailureReporter;
  readonly clock: Clock;
}

// 掲載終了通知の本文に表示停止の返金を載せるため、精算の後に終了の通知を依頼待ちにする。ログの属性は申込のIDと件数だけにする
export class PeriodEndSettlementHandler implements MessageHandler<SponsorshipRequestBody> {
  private readonly sponsorships: SponsorshipStore;
  private readonly committer: PeriodEndSettlementCommitter;
  private readonly scheduler: NoticeScheduler;
  private readonly requester: NoticeRequester;
  private readonly failures: PeriodEndSettlementFailureReporter;
  private readonly clock: Clock;

  constructor(dependencies: PeriodEndSettlementHandlerDependencies) {
    this.sponsorships = dependencies.sponsorships;
    this.committer = dependencies.committer;
    this.scheduler = dependencies.scheduler;
    this.requester = dependencies.requester;
    this.failures = dependencies.failures;
    this.clock = dependencies.clock;
  }

  async handle(): Promise<MessageHandlingResult> {
    const now = this.clock.now();
    const today = toBusinessDateTime(now).date;
    const counts: Record<SettlementOutcome, number> = {
      settled: 0,
      skipped: 0,
      failed: 0,
    };
    // 精算と取り消しの広告は未精算の一覧から外れ、例外の広告だけが残る。常に例外になる広告が先頭に溜まって後ろを止めないよう、
    // 例外の広告の数だけ多く読んでメモリ上で除き、例外以外で上限まで処理するか、例外が上限に達するか、一覧が尽きるまで読み直す
    const failed = new Set<string>();
    for (;;) {
      const processed = counts.settled + counts.skipped;
      const limit = PERIOD_END_SETTLEMENT_LIMIT + failed.size;
      const read = await this.sponsorships.listUnsettledEnded(today, limit);
      const targets = read
        .filter(({ id }) => !failed.has(id))
        .slice(0, PERIOD_END_SETTLEMENT_LIMIT - processed);
      for (const record of targets) {
        const outcome = await this.settle(record, now);
        counts[outcome] += 1;
        if (outcome === 'failed') {
          failed.add(record.id);
          if (failed.size >= PERIOD_END_FAILURE_LIMIT) {
            break;
          }
        }
      }
      const exhausted = read.length < limit;
      if (
        exhausted ||
        failed.size >= PERIOD_END_FAILURE_LIMIT ||
        counts.settled + counts.skipped >= PERIOD_END_SETTLEMENT_LIMIT
      ) {
        break;
      }
    }
    await this.scheduler.markDue(today);
    await this.requester.request();
    // 例外を除いて上限まで処理し、1件以上精算できた回だけ続ける。例外の上限で打ち切った回と精算できなかった回は障害か競合が続いている見込みが高いため、次の日次の処理の依頼に任せる
    const more =
      failed.size < PERIOD_END_FAILURE_LIMIT &&
      counts.settled + counts.skipped >= PERIOD_END_SETTLEMENT_LIMIT &&
      counts.settled > 0;
    logger.info('スポンサー広告の掲載の終わりの精算を処理しました', {
      ...counts,
      more,
    });
    return more ? CONTINUE : DONE;
  }

  private async settle(
    record: SponsorshipRecord,
    now: Date,
  ): Promise<SettlementOutcome> {
    try {
      const result = await this.committer.settle(record, now);
      if (result.kind === 'skipped') {
        logger.info(
          '条件が変わったスポンサー広告の掲載の終わりの精算を取り消しました',
          { sponsorshipId: record.id },
        );
      }
      return result.kind;
    } catch (error) {
      this.failures.report({ sponsorshipId: record.id, error });
      return 'failed';
    }
  }
}
