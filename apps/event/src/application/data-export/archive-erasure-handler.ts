import { inject, injectable } from 'inversify';

import { DATA_EXPORT_PLATFORM_TYPES } from '../../../lib/core/data-export/identifiers.ts';
import type {
  DataExportStore,
  ExportArchiveStorage,
} from '../../../lib/core/data-export/ports.ts';
import type {
  LifecycleHandlerOutcome,
  UserLifecycleAsyncHandler,
  UserLifecycleEvent,
} from '../../../lib/core/identity/user-lifecycle.ts';

export const ARCHIVE_ERASURE_BATCH_SIZE = 100;

const DONE: LifecycleHandlerOutcome = Object.freeze({ kind: 'done' });

const CONTINUE: LifecycleHandlerOutcome = Object.freeze({ kind: 'continue' });

// 記録を消す前にR2のアップロードとオブジェクトを消す。記録はR2の削除が全て成功してから消すため、失敗した回は記録が残り、再試行が同じ記録から消し直す。
// 対象を毎回D1から選び直すため、再試行・送り直し・続きの再開で同じイベントを何度処理しても結果が変わらない
@injectable()
export class ArchiveErasureHandler implements UserLifecycleAsyncHandler {
  constructor(
    @inject(DATA_EXPORT_PLATFORM_TYPES.DataExportStore)
    private readonly store: Pick<DataExportStore, 'listForUser' | 'removeMany'>,
    @inject(DATA_EXPORT_PLATFORM_TYPES.ExportArchiveStorage)
    private readonly storage: Pick<
      ExportArchiveStorage,
      'abortUpload' | 'delete'
    >,
  ) {}

  async handle(event: UserLifecycleEvent): Promise<LifecycleHandlerOutcome> {
    const records = await this.store.listForUser({
      userId: event.userId,
      limit: ARCHIVE_ERASURE_BATCH_SIZE,
    });
    for (const { uploadId, objectKey } of records) {
      if (uploadId !== null && objectKey !== null) {
        await this.storage.abortUpload(objectKey, uploadId);
      }
    }
    const objectKeys = records.flatMap(({ objectKey }) =>
      objectKey === null ? [] : [objectKey],
    );
    if (objectKeys.length > 0) {
      await this.storage.delete(objectKeys);
    }
    if (records.length > 0) {
      await this.store.removeMany(records.map(({ id }) => id));
    }
    return records.length >= ARCHIVE_ERASURE_BATCH_SIZE ? CONTINUE : DONE;
  }
}
