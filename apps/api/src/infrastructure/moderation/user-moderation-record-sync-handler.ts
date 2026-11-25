import type { BatchItem } from 'drizzle-orm/batch';
import { inject, injectable } from 'inversify';

import type { UserLifecycleEvent } from '../../../lib/core/identity/user-lifecycle.ts';
import { MODERATION_TYPES } from '../../application/moderation/moderation-types.ts';
import type { PendingModerationRecord } from '../../application/moderation/pending-moderation-record.ts';
import type { UserLifecycleSyncHandler } from '../identity/user-lifecycle-sync-handler.ts';
import type { D1ModerationStatements } from './d1-moderation-statements.ts';
import type { ModerationWriteParticipants } from './moderation-write-participant.ts';
import {
  type PendingModerationDependencies,
  pendingModerationStatements,
} from './pending-moderation-statements.ts';

// 停止・停止解除・代理の退会の記録と監査ログを、利用者の状態の変更と同じ一括の書き込みに載せる
@injectable()
export class UserModerationRecordSyncHandler implements UserLifecycleSyncHandler {
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
    event: UserLifecycleEvent,
  ): Promise<readonly BatchItem<'sqlite'>[]> {
    return pendingModerationStatements(this.#dependencies, {
      id: event.id,
      type: event.type,
      targetId: event.userId,
      occurredAt: event.occurredAt,
    });
  }
}
