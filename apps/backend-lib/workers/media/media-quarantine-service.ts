import type { Logger } from '@logtape/logtape';

import { AppError } from '../../core/errors/app-error.ts';
import { getAppLogger } from '../../core/logging/app-logger.ts';
import {
  desiredLocation,
  type MediaFileView,
  type QuarantineReason,
} from '../../core/media/media-file.ts';
import {
  MEDIA_MESSAGE_LIMITS,
  RELOCATE_FILES_MESSAGE,
} from '../../core/media/media-messages.ts';
import {
  type MediaFileStore,
  type MediaQuarantine,
  OWNER_OPERATION_BATCH_LIMIT,
  type OwnerBatchResult,
  type OwnerRef,
  QUARANTINED_IMAGE_LIST_MAX_LIMIT,
  type QuarantinedImageList,
  type QuarantinedImageListInput,
} from '../../core/media/ports.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import {
  type MessagePublisher,
  MessagePublishError,
} from '../messaging/queue-publisher.ts';
import {
  invalidLimit,
  isValidLimit,
  storageUnavailable,
} from './media-operation-errors.ts';

export interface MediaQuarantineServiceDependencies {
  readonly files: MediaFileStore;
  readonly publisher: MessagePublisher;
  readonly appName: LoggingOptions['appName'];
}

type ReasonChange = 'add' | 'remove';

function notApplicable(): AppError {
  return new AppError({
    kind: 'bad_request',
    code: 'quarantine_not_applicable',
    message: '画像以外のファイルは隔離の対象にできません。',
  });
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

function reasonsAfter(
  file: MediaFileView,
  reason: QuarantineReason,
  change: ReasonChange,
): readonly QuarantineReason[] {
  const others = file.quarantineReasons.filter((each) => each !== reason);
  return change === 'add' ? [...others, reason] : others;
}

// 記録の保存先との食い違いも対象にするのは、送信の失敗の後の再実行で理由が変わらなくても移動を依頼し直すため。目的の保存先が変わる場合は、逆向きの移動の途中で記録の保存先が古いままのことがあるため対象にする
function needsRelocation(
  file: MediaFileView,
  reason: QuarantineReason,
  change: ReasonChange,
): boolean {
  if (file.eraseRequested) {
    return false;
  }
  const before = desiredLocation(file.storage, file.quarantineReasons);
  const after = desiredLocation(
    file.storage,
    reasonsAfter(file, reason, change),
  );
  return before !== after || after !== file.location;
}

export class MediaQuarantineService implements MediaQuarantine {
  private readonly files: MediaFileStore;
  private readonly publisher: MessagePublisher;
  private readonly logger: Logger;

  constructor(dependencies: MediaQuarantineServiceDependencies) {
    this.files = dependencies.files;
    this.publisher = dependencies.publisher;
    this.logger = getAppLogger([dependencies.appName, 'media', 'quarantine']);
  }

  async addReason(
    fileIds: readonly string[],
    reason: QuarantineReason,
  ): Promise<void> {
    await this.change(fileIds, reason, 'add');
  }

  async removeReason(
    fileIds: readonly string[],
    reason: QuarantineReason,
  ): Promise<void> {
    await this.change(fileIds, reason, 'remove');
  }

  async addReasonForOwner(
    owner: OwnerRef,
    reason: QuarantineReason,
  ): Promise<OwnerBatchResult> {
    return this.changeForOwner(owner, reason, 'add');
  }

  async removeReasonForOwner(
    owner: OwnerRef,
    reason: QuarantineReason,
  ): Promise<OwnerBatchResult> {
    return this.changeForOwner(owner, reason, 'remove');
  }

  async listByReason(
    input: QuarantinedImageListInput,
  ): Promise<QuarantinedImageList> {
    if (!isValidLimit(input.limit, QUARANTINED_IMAGE_LIST_MAX_LIMIT)) {
      throw invalidLimit(QUARANTINED_IMAGE_LIST_MAX_LIMIT);
    }
    return this.files.listQuarantined(input);
  }

  // 対象を呼び出しのたびにD1の状態から求め直すため、呼び出し元は進み具合を持たずに同じ操作を繰り返せ、理由の記録は途中で失敗した後の再実行でも同じ結果になる。送信に失敗した移動の依頼は、再実行の対象から外れるため、日次の保存先の照合が食い違いとして拾い直す
  private async changeForOwner(
    owner: OwnerRef,
    reason: QuarantineReason,
    change: ReasonChange,
  ): Promise<OwnerBatchResult> {
    const ids = await this.files.findOwnedImageIdsByReason({
      owner,
      reason,
      hasReason: change === 'remove',
      limit: OWNER_OPERATION_BATCH_LIMIT + 1,
    });
    const targets = ids.slice(0, OWNER_OPERATION_BATCH_LIMIT);
    await this.change(targets, reason, change);
    return {
      processed: targets.length,
      hasMore: ids.length > OWNER_OPERATION_BATCH_LIMIT,
    };
  }

  private async change(
    fileIds: readonly string[],
    reason: QuarantineReason,
    change: ReasonChange,
  ): Promise<void> {
    const views = [...(await this.files.findViews(fileIds)).values()];
    if (views.some((file) => file.storage !== 'images')) {
      throw notApplicable();
    }
    const ids = views.map((file) => file.id);
    if (ids.length === 0) {
      return;
    }
    if (change === 'add') {
      await this.files.addReasons(ids, reason);
    } else {
      await this.files.removeReasons(ids, reason);
    }
    await this.requestRelocation(
      views
        .filter((file) => needsRelocation(file, reason, change))
        .map((file) => file.id),
      reason,
    );
  }

  // 移動は受信側が記録を読み直して目的の保存先へそろえるため、理由を確定させた後に送る
  private async requestRelocation(
    fileIds: readonly string[],
    reason: QuarantineReason,
  ): Promise<void> {
    try {
      for (const page of chunk(fileIds, MEDIA_MESSAGE_LIMITS.relocateBatch)) {
        await this.publisher.publish(RELOCATE_FILES_MESSAGE, {
          fileIds: page,
        });
      }
    } catch (error) {
      if (error instanceof MessagePublishError) {
        throw error;
      }
      this.logger.warn('隔離理由の変更に伴う移動の依頼を送れませんでした', {
        fileCount: fileIds.length,
        reason,
        error,
      });
      throw storageUnavailable();
    }
  }
}
