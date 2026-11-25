import { inject, injectable } from 'inversify';

import {
  DATA_EXPORT_GENERATE_MESSAGE,
  DATA_EXPORT_WATCHDOG_MESSAGE,
  GENERATION_WATCHDOG_DELAY_SECONDS,
} from '../../../lib/core/data-export/data-export-messages.ts';
import { DATA_EXPORT_PLATFORM_TYPES } from '../../../lib/core/data-export/identifiers.ts';
import type { DataExportStore } from '../../../lib/core/data-export/ports.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { AccountGuard } from '../../../lib/core/identity/account-guard.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type { SessionView } from '../../../lib/core/session/session-view.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { identityError } from '../identity/identity-errors.ts';
import { dataExportUnavailableError } from './data-export-errors.ts';
import type {
  DataExportMessagePublisher,
  DataExportRequestLimits,
} from './data-export-request-ports.ts';
import { DATA_EXPORT_TYPES } from './data-export-types.ts';
import { type DataExportView, toDataExportView } from './data-export-view.ts';

export interface DataExportRequestService {
  request(session: SessionView): Promise<DataExportView>;
}

const logger = getAppLogger(['api', 'application', 'data-export']);

@injectable()
export class StoreDataExportRequestService implements DataExportRequestService {
  constructor(
    @inject(IDENTITY_PLATFORM_TYPES.AccountGuard)
    private readonly guard: AccountGuard,
    @inject(DATA_EXPORT_TYPES.DataExportRequestLimits)
    private readonly limits: DataExportRequestLimits,
    @inject(DATA_EXPORT_PLATFORM_TYPES.DataExportStore)
    private readonly store: DataExportStore,
    @inject(PLATFORM_TYPES.MessagePublisher)
    private readonly publisher: DataExportMessagePublisher,
    @inject(PLATFORM_TYPES.IdGenerator)
    private readonly ids: IdGenerator,
    @inject(PLATFORM_TYPES.Clock)
    private readonly clock: Clock,
  ) {}

  async request(session: SessionView): Promise<DataExportView> {
    // 停止中の利用者も自分のデータを持ち出せるため、書き込みの可否ではなく本人だけを確かめる
    const { user } = await this.guard.requireUser(session);
    if (user.emailVerifiedAt === null) {
      throw identityError('email_not_verified');
    }
    // 拒否した要求を数えないよう、本人と確認の判定を回数より先に行う
    await this.limits.consume(user.id);
    const requestedAt = this.clock.now();
    const record = await this.store.create({
      id: this.ids.generate(),
      userId: user.id,
      requestedAt,
    });
    await this.requestGeneration(record.id);
    await this.requestWatchdog(record.id);
    return toDataExportView(record, requestedAt);
  }

  // 受け付けたと誤って伝えないよう、依頼を送れなければ記録を消す。数えた回数は戻さない
  private async requestGeneration(exportId: string): Promise<void> {
    try {
      await this.publisher.publish(DATA_EXPORT_GENERATE_MESSAGE, { exportId });
    } catch (error: unknown) {
      logger.error('データエクスポートの生成の依頼を送れませんでした', {
        exportId,
        error,
      });
      await this.discard(exportId);
      throw dataExportUnavailableError();
    }
  }

  private async discard(exportId: string): Promise<void> {
    try {
      await this.store.remove(exportId);
    } catch (error: unknown) {
      logger.error('受け付けられなかった要求の記録を消せませんでした', {
        exportId,
        error,
      });
    }
  }

  // 見張りを失っても日次の受け皿が拾うため、受け付けは成功させる
  private async requestWatchdog(exportId: string): Promise<void> {
    try {
      await this.publisher.publish(
        DATA_EXPORT_WATCHDOG_MESSAGE,
        { exportId },
        { delaySeconds: GENERATION_WATCHDOG_DELAY_SECONDS },
      );
    } catch (error: unknown) {
      logger.warn('データエクスポートの生成の見張りを送れませんでした', {
        exportId,
        error,
      });
    }
  }
}
