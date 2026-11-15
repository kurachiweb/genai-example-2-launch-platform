import { inject, injectable } from 'inversify';

import { getAppLogger } from '../../../../lib/core/logging/app-logger.ts';
import type {
  ScheduledJobContext,
  ScheduledJobDefinition,
  ScheduledJobHandler,
} from '../../../../lib/core/scheduling/cron-registry.ts';
import { ULTRAS_TYPES } from '../../../../lib/core/ultras/identifiers.ts';
import type {
  ActivationDispatcher,
  ActivationStore,
  NoticeStore,
  UltrasNotifier,
} from '../../../../lib/core/ultras/ports.ts';
import { API_ULTRAS_TYPES } from '../ultras-types.ts';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

// 有効化の直後の送り出しとメールの依頼は確定した処理が続けて行うため、10分待ってから送り直す
const PENDING_AFTER_MS = 10 * MINUTE_MS;

// 知らせの処理の再試行は上限まで含めて24時間以内に終わるため、送り出しから24時間経っても完了していない知らせは失われたとみなす
const REDISPATCH_AFTER_MS = DAY_MS;

const RETENTION_MS = 30 * DAY_MS;

export const UNDISPATCHED_ACTIVATION_LIMIT = 100;

export const PENDING_NOTICE_LIMIT = 100;

// Workersの実時間に収めるため1回の起動で消す件数を区切り、残りは翌日の起動に任せる
export const RETENTION_DELETE_BATCH_SIZE = 500;

export const RETENTION_DELETE_MAX_BATCHES = 20;

export const PENDING_DISPATCH_SWEEP_JOB_DEFINITION: ScheduledJobDefinition =
  Object.freeze({
    name: 'ultras-subscription.pending-dispatch-sweep',
    at: Object.freeze({ hour: 4, minute: 21 }),
    order: 500,
    handler: API_ULTRAS_TYPES.PendingDispatchSweepJob,
  });

const logger = getAppLogger(['api', 'application', 'ultras']);

type SweepPhase =
  'redispatch' | 'notices' | 'activation-retention' | 'notice-retention';

interface PhaseFailure {
  readonly kind: 'failed';
  readonly phase: SweepPhase;
  readonly error: unknown;
}

interface PhaseSuccess<T> {
  readonly kind: 'succeeded';
  readonly value: T;
}

type PhaseOutcome<T> = PhaseSuccess<T> | PhaseFailure;

interface RedispatchTally {
  readonly targets: number;
}

interface NoticeTally {
  readonly targets: number;
  readonly requested: number;
  readonly skipped: number;
  readonly failed: number;
}

interface RetentionTally {
  readonly deleted: number;
  readonly batches: number;
  readonly limitReached: boolean;
}

type DeleteBefore = (threshold: Date, limit: number) => Promise<number>;

// 1つの処理の失敗が残りの処理を止めないよう失敗を持ち帰り、全処理を終えてからまとめて投げる。処理ごとのログは定期実行の記録のerrorと重ねないためwarnに留める
async function guarded<T>(
  phase: SweepPhase,
  task: () => Promise<T>,
): Promise<PhaseOutcome<T>> {
  try {
    return { kind: 'succeeded', value: await task() };
  } catch (error: unknown) {
    logger.warn('日次の確認の処理に失敗したため、残りの処理を続けます', {
      phase,
      error,
    });
    return { kind: 'failed', phase, error };
  }
}

function summaryOf<T>(outcome: PhaseOutcome<T>): T | 'failed' {
  return outcome.kind === 'failed' ? 'failed' : outcome.value;
}

// 失敗した処理があれば、定期実行の記録がエラートラッキングへ通知できるよう例外で終える
function assertAllSucceeded(outcomes: readonly PhaseOutcome<unknown>[]): void {
  const failures = outcomes.filter(
    (outcome): outcome is PhaseFailure => outcome.kind === 'failed',
  );
  const [first] = failures;
  if (first === undefined) {
    return;
  }
  throw new Error(
    `日次の確認の処理に失敗しました: ${failures.map(({ phase }) => phase).join(', ')}`,
    { cause: first.error },
  );
}

async function deleteInBatches(
  deleteBefore: DeleteBefore,
  threshold: Date,
): Promise<RetentionTally> {
  let deleted = 0;
  let batches = 0;
  let lastCount: number;
  do {
    lastCount = await deleteBefore(threshold, RETENTION_DELETE_BATCH_SIZE);
    deleted += lastCount;
    batches += 1;
  } while (
    lastCount === RETENTION_DELETE_BATCH_SIZE &&
    batches < RETENTION_DELETE_MAX_BATCHES
  );
  return {
    deleted,
    batches,
    limitReached: lastCount === RETENTION_DELETE_BATCH_SIZE,
  };
}

@injectable()
export class PendingDispatchSweepJob implements ScheduledJobHandler {
  constructor(
    @inject(ULTRAS_TYPES.ActivationStore)
    private readonly activations: ActivationStore,
    @inject(ULTRAS_TYPES.NoticeStore)
    private readonly notices: NoticeStore,
    @inject(ULTRAS_TYPES.ActivationDispatcher)
    private readonly dispatcher: ActivationDispatcher,
    @inject(ULTRAS_TYPES.UltrasNotifier)
    private readonly notifier: UltrasNotifier,
  ) {}

  async run({ scheduledTime }: ScheduledJobContext): Promise<void> {
    const pendingBefore = new Date(scheduledTime.getTime() - PENDING_AFTER_MS);
    const retentionThreshold = new Date(scheduledTime.getTime() - RETENTION_MS);
    const redispatch = await guarded('redispatch', () =>
      this.redispatchActivations(scheduledTime, pendingBefore),
    );
    const notices = await guarded('notices', () =>
      this.requestNotices(pendingBefore),
    );
    const activationRetention = await guarded('activation-retention', () =>
      deleteInBatches(
        (threshold, limit) =>
          this.activations.deleteCompletedBefore(threshold, limit),
        retentionThreshold,
      ),
    );
    const noticeRetention = await guarded('notice-retention', () =>
      deleteInBatches(
        (threshold, limit) =>
          this.notices.deleteFinishedBefore(threshold, limit),
        retentionThreshold,
      ),
    );
    logger.info(
      '未送り出しの知らせと依頼待ちのメールを送り直し、保持期間を過ぎた記録を削除しました',
      {
        redispatch: summaryOf(redispatch),
        notices: summaryOf(notices),
        retention: {
          activations: summaryOf(activationRetention),
          notices: summaryOf(noticeRetention),
        },
      },
    );
    assertAllSucceeded([
      redispatch,
      notices,
      activationRetention,
      noticeRetention,
    ]);
  }

  // 送り出しの失敗は送り出し側が警告に留めるため、1件ずつの保護を置かない
  private async redispatchActivations(
    scheduledTime: Date,
    createdBefore: Date,
  ): Promise<RedispatchTally> {
    const undispatched = await this.activations.findUndispatched({
      createdBefore,
      redispatchBefore: new Date(scheduledTime.getTime() - REDISPATCH_AFTER_MS),
      limit: UNDISPATCHED_ACTIVATION_LIMIT,
    });
    for (const { id } of undispatched) {
      await this.dispatcher.dispatch(id);
    }
    return { targets: undispatched.length };
  }

  // 依頼待ちの行だけを依頼し、依頼を記録した行は依頼待ちでなくなるため、同じメールを2回依頼しない
  private async requestNotices(pendingBefore: Date): Promise<NoticeTally> {
    const pending = await this.notices.findPendingBefore(
      pendingBefore,
      PENDING_NOTICE_LIMIT,
    );
    let requested = 0;
    let skipped = 0;
    let failed = 0;
    for (const notice of pending) {
      try {
        const outcome = await this.notifier.send(notice);
        if (outcome === 'requested') {
          requested += 1;
        } else if (outcome === 'skipped') {
          skipped += 1;
        }
      } catch (error: unknown) {
        failed += 1;
        logger.warn('依頼待ちのメールを依頼できませんでした', {
          noticeId: notice.id,
          error,
        });
      }
    }
    return { targets: pending.length, requested, skipped, failed };
  }
}
