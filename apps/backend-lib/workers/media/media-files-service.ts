import type { Logger } from '@logtape/logtape';

import { getAppLogger } from '../../core/logging/app-logger.ts';
import {
  type MediaFileView,
  readLocationsOf,
} from '../../core/media/media-file.ts';
import {
  type ClaimFailure,
  type ClaimFailureReason,
  type ClaimRequest,
  type ClaimResult,
  type EraseSummary,
  type MediaContent,
  type MediaEraser,
  type MediaFiles,
  type MediaFileStore,
  type MediaObjectStore,
  OWNER_ID_LIST_MAX_LIMIT,
  OWNER_OPERATION_BATCH_LIMIT,
  type OwnerBatchResult,
  type OwnerIdList,
  type OwnerIdListInput,
  type OwnerRef,
} from '../../core/media/ports.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import {
  invalidLimit,
  isValidLimit,
  storageUnavailable,
} from './media-operation-errors.ts';

export interface MediaFilesServiceDependencies {
  readonly files: MediaFileStore;
  readonly objects: MediaObjectStore;
  readonly eraser: MediaEraser;
  readonly appName: LoggingOptions['appName'];
}

function isOwnedBy(file: MediaFileView, owner: OwnerRef): boolean {
  return (
    file.owner.kind !== 'system' &&
    file.owner.kind === owner.kind &&
    file.owner.id === owner.id
  );
}

function claimFailureOf(
  file: MediaFileView | undefined,
  request: ClaimRequest,
): ClaimFailureReason | undefined {
  if (file === undefined) {
    return 'not_found';
  }
  if (!file.stored) {
    return 'not_stored';
  }
  if (file.deletedAt !== null || file.eraseRequested) {
    return 'deleted';
  }
  if (file.purpose !== request.purpose) {
    return 'purpose_mismatch';
  }
  return isOwnedBy(file, request.owner) ? undefined : 'owner_mismatch';
}

function isReadable(file: MediaFileView): boolean {
  return (
    file.stored &&
    file.deletedAt === null &&
    !file.eraseRequested &&
    !file.quarantined
  );
}

export class MediaFilesService implements MediaFiles {
  private readonly files: MediaFileStore;
  private readonly objects: MediaObjectStore;
  private readonly eraser: MediaEraser;
  private readonly logger: Logger;

  constructor(dependencies: MediaFilesServiceDependencies) {
    this.files = dependencies.files;
    this.objects = dependencies.objects;
    this.eraser = dependencies.eraser;
    this.logger = getAppLogger([dependencies.appName, 'media', 'files']);
  }

  async claim(request: ClaimRequest): Promise<ClaimResult> {
    const fileIds = [...new Set(request.fileIds)];
    const views = await this.files.findViews(fileIds);
    const failures = fileIds.flatMap((fileId): ClaimFailure[] => {
      const reason = claimFailureOf(views.get(fileId), request);
      return reason === undefined ? [] : [{ fileId, reason }];
    });
    if (failures.length > 0) {
      return { ok: false, failures };
    }
    await this.files.attach(fileIds);
    return { ok: true };
  }

  async markDeleted(fileIds: readonly string[]): Promise<void> {
    await this.files.markDeleted(fileIds);
  }

  async eraseNow(fileIds: readonly string[]): Promise<EraseSummary> {
    try {
      await this.files.markEraseRequested(fileIds);
      return await this.eraser.erase(fileIds);
    } catch (error) {
      // 削除待ちの印が付いていれば日次の削除が完了させ、付いていなければ何も変わっていないため、呼び出し元は同じ要求を再実行できる
      this.logger.warn('ファイルの即時の物理削除を完了できませんでした', {
        fileCount: fileIds.length,
        error,
      });
      throw storageUnavailable();
    }
  }

  async eraseOwnedBy(owner: OwnerRef): Promise<OwnerBatchResult> {
    const ids = await this.files.findIdsOwnedBy(
      owner,
      OWNER_OPERATION_BATCH_LIMIT + 1,
    );
    const summary = await this.eraseNow(
      ids.slice(0, OWNER_OPERATION_BATCH_LIMIT),
    );
    return {
      processed: summary.erased,
      hasMore: ids.length > OWNER_OPERATION_BATCH_LIMIT,
    };
  }

  async listOwnerIds(input: OwnerIdListInput): Promise<OwnerIdList> {
    const { limit } = input;
    if (!isValidLimit(limit, OWNER_ID_LIST_MAX_LIMIT)) {
      throw invalidLimit(OWNER_ID_LIST_MAX_LIMIT);
    }
    // 1件多く読み、続きがあるかを次の呼び出しを待たずに判定する
    const found = await this.files.findOwnerIds({ ...input, limit: limit + 1 });
    if (found.length <= limit) {
      return { ownerIds: found, next: undefined };
    }
    const ownerIds = found.slice(0, limit);
    return { ownerIds, next: ownerIds.at(-1) };
  }

  async findMany(
    fileIds: readonly string[],
  ): Promise<ReadonlyMap<string, MediaFileView>> {
    return this.files.findViews(fileIds);
  }

  async openContent(fileId: string): Promise<MediaContent | undefined> {
    const file = (await this.files.findViews([fileId])).get(fileId);
    if (file === undefined || !isReadable(file)) {
      return undefined;
    }
    for (const location of readLocationsOf(file)) {
      const stored = await this.objects.get(location, file.objectKey);
      if (stored !== undefined) {
        return { file, body: stored.body };
      }
    }
    return undefined;
  }
}
