import { inject, injectable } from 'inversify';

import { DATA_EXPORT_PLATFORM_TYPES } from '../../../lib/core/data-export/identifiers.ts';
import type { DataExportStore } from '../../../lib/core/data-export/ports.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { AccountGuard } from '../../../lib/core/identity/account-guard.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import type { SessionView } from '../../../lib/core/session/session-view.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { type DataExportView, toDataExportView } from './data-export-view.ts';

export interface DataExportPage {
  readonly first: number;
  readonly afterId: string | undefined;
}

export interface DataExportReader {
  // 要求日時の新しい順で最大first + 1件を返し、続きの有無は呼び出し側が件数から判定する
  listMine(
    session: SessionView,
    page: DataExportPage,
  ): Promise<readonly DataExportView[]>;
}

@injectable()
export class StoreDataExportReader implements DataExportReader {
  constructor(
    @inject(IDENTITY_PLATFORM_TYPES.AccountGuard)
    private readonly guard: AccountGuard,
    @inject(DATA_EXPORT_PLATFORM_TYPES.DataExportStore)
    private readonly store: DataExportStore,
    @inject(PLATFORM_TYPES.Clock)
    private readonly clock: Clock,
  ) {}

  async listMine(
    session: SessionView,
    page: DataExportPage,
  ): Promise<readonly DataExportView[]> {
    const { user } = await this.guard.requireUser(session);
    // 保存先が続きの判定用に1件多く返すため、limitには1ページの件数をそのまま渡す
    const records = await this.store.listByUserPage({
      userId: user.id,
      afterId: page.afterId,
      limit: page.first,
    });
    const now = this.clock.now();
    return records.map((record) => toDataExportView(record, now));
  }
}
