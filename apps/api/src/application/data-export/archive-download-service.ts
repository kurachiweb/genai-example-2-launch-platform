import { inject, injectable } from 'inversify';

import { DATA_EXPORT_PLATFORM_TYPES } from '../../../lib/core/data-export/identifiers.ts';
import type {
  DataExportRecord,
  DataExportStore,
} from '../../../lib/core/data-export/ports.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { AccountGuard } from '../../../lib/core/identity/account-guard.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import { isUppercaseUlid } from '../../../lib/core/ids/uppercase-ulid.ts';
import type { SessionView } from '../../../lib/core/session/session-view.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { dataExportNotFoundError } from './data-export-errors.ts';

export interface ArchiveDownloadService {
  // 未ログインはunauthenticated、本人の期限内の完了以外は理由によらず同じnot_found
  authorize(session: SessionView, exportId: string): Promise<DataExportRecord>;
}

@injectable()
export class StoreArchiveDownloadService implements ArchiveDownloadService {
  constructor(
    @inject(IDENTITY_PLATFORM_TYPES.AccountGuard)
    private readonly guard: AccountGuard,
    @inject(DATA_EXPORT_PLATFORM_TYPES.DataExportStore)
    private readonly store: DataExportStore,
    @inject(PLATFORM_TYPES.Clock)
    private readonly clock: Clock,
  ) {}

  async authorize(
    session: SessionView,
    exportId: string,
  ): Promise<DataExportRecord> {
    // 停止中の利用者も自分のデータを持ち出せるため、書き込みの可否ではなく本人だけを確かめる
    const { user } = await this.guard.requireUser(session);
    if (!isUppercaseUlid(exportId)) {
      throw dataExportNotFoundError();
    }
    const record = await this.store.findOwnedReady({
      id: exportId,
      userId: user.id,
      now: this.clock.now(),
    });
    if (record === undefined) {
      throw dataExportNotFoundError();
    }
    return record;
  }
}
