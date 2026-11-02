import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { MEDIA_TYPES } from '../../../lib/core/media/identifiers.ts';
import {
  MEDIA_MESSAGE_LIMITS,
  MODERATE_IMAGE_MESSAGE,
  RELOCATE_FILES_MESSAGE,
} from '../../../lib/core/media/media-messages.ts';
import type {
  MediaEraser,
  MediaFileStore,
} from '../../../lib/core/media/ports.ts';
import type { MessageContract } from '../../../lib/core/messaging/message-contract.ts';
import type {
  ScheduledJobContext,
  ScheduledJobHandler,
} from '../../../lib/core/scheduling/cron-registry.ts';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

// 1回の照会で扱う件数の上限。820・830は1回の起動で1度だけ照会し、超えた分は翌日の起動が状態から求め直して扱う
export const MEDIA_DAILY_JOB_LIMIT = 1000;
// 810の1回の繰り返しは、候補の照会1・記録の読み出し12(90件ずつ)・3バケットの削除3・パージの依頼10(100件ずつ)・記録の削除1の最大27回のサブリクエストを使う。
// 10回で最大270回となり、同じ起動の他のジョブとWorkers Paidの1起動あたり10,000回を分け合える。D1の照会は1回の繰り返しで14回(一括実行は1回と数える)、10回で140回となり、1起動あたり1,000回の上限にも収まる。処理の大半がI/Oの待ちのため、CPU時間の既定の上限(30秒。limits.cpu_msは未設定)にも届かない
export const EXPIRED_FILE_ERASURE_MAX_ROUNDS = 10;
export const SOFT_DELETED_RETENTION_MS = 13 * DAY_MS;
export const UNATTACHED_RETENTION_MS = DAY_MS;
export const MODERATION_PENDING_TIMEOUT_MS = HOUR_MS;

const ExpiredFileErasureJobId: unique symbol = Symbol.for(
  'media.ExpiredFileErasureJob',
);
const ModerationRequeueJobId: unique symbol = Symbol.for(
  'media.ModerationRequeueJob',
);
const LocationReconciliationJobId: unique symbol = Symbol.for(
  'media.LocationReconciliationJob',
);

export const MEDIA_JOB_TYPES = Object.freeze({
  ExpiredFileErasureJob: ExpiredFileErasureJobId,
  ModerationRequeueJob: ModerationRequeueJobId,
  LocationReconciliationJob: LocationReconciliationJobId,
});

// application層は共通ライブラリのworkersの送信部品を読み込めないため、PLATFORM_TYPES.MessagePublisherに束縛された部品をこの形で受け取る
export interface MediaJobMessagePublisher {
  publish<TType extends string, TBody>(
    contract: MessageContract<TType, TBody>,
    body: TBody,
  ): Promise<string>;
}

export class MediaDailyJobError extends Error {
  override readonly name = 'MediaDailyJobError';
}

interface RequestSummary {
  readonly found: number;
  readonly requested: number;
  readonly failed: number;
  readonly hasMore: boolean;
}

interface Batch {
  readonly targets: readonly string[];
  readonly hasMore: boolean;
}

const erasureLogger = getAppLogger(['api', 'media', 'expired-file-erasure']);
const requeueLogger = getAppLogger(['api', 'media', 'moderation-requeue']);
const reconciliationLogger = getAppLogger([
  'api',
  'media',
  'location-reconciliation',
]);

// 残りの有無を知るために上限より1件多く照会し、先頭の上限件数だけを扱う
async function limitedBatch(
  find: (limit: number) => Promise<readonly string[]>,
): Promise<Batch> {
  const candidates = await find(MEDIA_DAILY_JOB_LIMIT + 1);
  return {
    targets: candidates.slice(0, MEDIA_DAILY_JOB_LIMIT),
    hasMore: candidates.length > MEDIA_DAILY_JOB_LIMIT,
  };
}

function before(scheduledTime: Date, durationMs: number): Date {
  return new Date(scheduledTime.getTime() - durationMs);
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

@injectable()
export class ExpiredFileErasureJob implements ScheduledJobHandler {
  constructor(
    @inject(MEDIA_TYPES.MediaFileStore) private readonly files: MediaFileStore,
    @inject(MEDIA_TYPES.MediaEraser) private readonly eraser: MediaEraser,
  ) {}

  async run({ scheduledTime }: ScheduledJobContext): Promise<void> {
    // ストアの期限は「より前」で比べるため、13日ちょうどの論理削除も含めるよう1ミリ秒後を渡し、14日が経つ前の起動で必ず消す
    const deletedBefore = new Date(
      before(scheduledTime, SOFT_DELETED_RETENTION_MS).getTime() + 1,
    );
    const query = {
      deletedBefore,
      unattachedCreatedBefore: before(scheduledTime, UNATTACHED_RETENTION_MS),
    };
    let found = 0;
    let erased = 0;
    let rounds = 0;
    let hasMore = true;
    while (hasMore && rounds < EXPIRED_FILE_ERASURE_MAX_ROUNDS) {
      const batch = await limitedBatch((limit) =>
        this.files.findEraseCandidates({ ...query, limit }),
      );
      hasMore = batch.hasMore;
      if (batch.targets.length === 0) {
        break;
      }
      erased += (await this.eraser.erase(batch.targets)).erased;
      found += batch.targets.length;
      rounds += 1;
    }
    erasureLogger.info('期限を過ぎたファイルを物理削除しました', {
      found,
      erased,
      rounds,
      hasMore,
    });
    if (hasMore) {
      erasureLogger.warn(
        '1回の起動の繰り返しの上限に達したため、残りのファイルの物理削除を翌日に回します',
        { erased, rounds },
      );
    }
  }
}

@injectable()
export class ModerationRequeueJob implements ScheduledJobHandler {
  constructor(
    @inject(MEDIA_TYPES.MediaFileStore) private readonly files: MediaFileStore,
    @inject(PLATFORM_TYPES.MessagePublisher)
    private readonly publisher: MediaJobMessagePublisher,
  ) {}

  async run({ scheduledTime }: ScheduledJobContext): Promise<void> {
    const { targets, hasMore } = await limitedBatch((limit) =>
      this.files.findModerationRequeueCandidates({
        pendingCreatedBefore: before(
          scheduledTime,
          MODERATION_PENDING_TIMEOUT_MS,
        ),
        limit,
      }),
    );
    // 1件の送信の失敗で残りの依頼を止めず、失敗はまとめて1件の例外にしてディスパッチャからエラートラッキングへ送る
    const errors: unknown[] = [];
    for (const fileId of targets) {
      try {
        await this.publisher.publish(MODERATE_IMAGE_MESSAGE, { fileId });
      } catch (error) {
        requeueLogger.error('画像の判定を依頼し直せませんでした', {
          error,
          fileId,
        });
        errors.push(error);
      }
    }
    const summary: RequestSummary = {
      found: targets.length,
      requested: targets.length - errors.length,
      failed: errors.length,
      hasMore,
    };
    requeueLogger.info('判定の済んでいない画像の判定を依頼し直しました', {
      ...summary,
    });
    throwIfFailed(
      errors,
      `判定の再依頼で${String(summary.failed)}件の送信に失敗しました`,
    );
  }
}

@injectable()
export class LocationReconciliationJob implements ScheduledJobHandler {
  constructor(
    @inject(MEDIA_TYPES.MediaFileStore) private readonly files: MediaFileStore,
    @inject(PLATFORM_TYPES.MessagePublisher)
    private readonly publisher: MediaJobMessagePublisher,
  ) {}

  async run(): Promise<void> {
    const { targets, hasMore } = await limitedBatch((limit) =>
      this.files.findLocationMismatches(limit),
    );
    const errors: unknown[] = [];
    let failed = 0;
    for (const fileIds of chunk(targets, MEDIA_MESSAGE_LIMITS.relocateBatch)) {
      try {
        await this.publisher.publish(RELOCATE_FILES_MESSAGE, { fileIds });
      } catch (error) {
        reconciliationLogger.error('保存先の移動を依頼できませんでした', {
          error,
          fileIds,
        });
        errors.push(error);
        failed += fileIds.length;
      }
    }
    const summary: RequestSummary = {
      found: targets.length,
      requested: targets.length - failed,
      failed,
      hasMore,
    };
    reconciliationLogger.info('保存先の食い違う画像の移動を依頼しました', {
      ...summary,
    });
    throwIfFailed(
      errors,
      `保存先の照合で${String(failed)}件の移動の依頼に失敗しました`,
    );
  }
}

function throwIfFailed(errors: readonly unknown[], message: string): void {
  if (errors.length > 0) {
    throw new MediaDailyJobError(message, { cause: errors[0] });
  }
}
