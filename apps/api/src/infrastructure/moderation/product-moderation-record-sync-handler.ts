import type { BatchItem } from 'drizzle-orm/batch';
import { inject, injectable } from 'inversify';

import type { ProductLifecycleEvent } from '../../../lib/core/product/product-lifecycle.ts';
import { MODERATION_TYPES } from '../../application/moderation/moderation-types.ts';
import type { PendingModerationRecord } from '../../application/moderation/pending-moderation-record.ts';
import type { ProductLifecycleSyncHandler } from '../product/product-lifecycle-sync-handler.ts';
import type { D1ModerationStatements } from './d1-moderation-statements.ts';
import type { ModerationWriteParticipants } from './moderation-write-participant.ts';
import {
  type PendingModerationDependencies,
  pendingModerationStatements,
} from './pending-moderation-statements.ts';

// 非公開化・復元の記録と監査ログを、プロダクトの状態の変更と同じ一括の書き込みに載せる
@injectable()
export class ProductModerationRecordSyncHandler implements ProductLifecycleSyncHandler {
  readonly #dependencies: PendingModerationDependencies;

  constructor(
    @inject(MODERATION_TYPES.PendingModerationRecord)
    pending: PendingModerationRecord,
    @inject(MODERATION_TYPES.ModerationStatements)
    statements: D1ModerationStatements,
    @inject(MODERATION_TYPES.ModerationWriteParticipants)
    participants: ModerationWriteParticipants,
  ) {
    this.#dependencies = { pending, statements, participants };
  }

  statementsFor(
    event: ProductLifecycleEvent,
  ): Promise<readonly BatchItem<'sqlite'>[]> {
    return pendingModerationStatements(this.#dependencies, {
      id: event.id,
      type: event.type,
      targetId: event.productId,
      occurredAt: event.occurredAt,
    });
  }
}
