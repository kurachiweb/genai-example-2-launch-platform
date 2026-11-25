import { injectable } from 'inversify';

import type { ModerationLifecycleEvent } from '../../../common-lib/moderation/moderation-actions.ts';
import type { PreparedAuditEntry } from '../../../lib/core/admin/audit-log.ts';
import type { NewModerationRecord } from '../../../lib/core/moderation/ports.ts';
import type { ModerationWriteParticipation } from './ports.ts';

export interface PendingModeration {
  readonly record: Omit<NewModerationRecord, 'lifecycleEventId' | 'occurredAt'>;
  readonly lifecycleEvent: ModerationLifecycleEvent;
  readonly audit: PreparedAuditEntry;
  readonly participation: ModerationWriteParticipation | undefined;
}

export interface PendingModerationTakeEvent {
  readonly type: string;
  readonly targetId: string;
}

// 文を受け取らない上流の操作口の確定に、同期の処理が記録と監査ログの文を同じ一括の書き込みとして載せるため、措置を要求の間だけ預かる
export interface PendingModerationRecord {
  set(pending: PendingModeration): void;
  take(event: PendingModerationTakeEvent): PendingModeration | undefined;
  wasTaken(): boolean;
  clear(): void;
}

@injectable()
export class InMemoryPendingModerationRecord implements PendingModerationRecord {
  private pending: PendingModeration | undefined;

  private taken = false;

  set(pending: PendingModeration): void {
    if (this.pending !== undefined) {
      throw new Error(
        '保留中の措置が残ったまま次の措置を置こうとしました。1つの措置の確定ごとに取り出すか破棄してください。',
      );
    }
    this.pending = pending;
    this.taken = false;
  }

  take(event: PendingModerationTakeEvent): PendingModeration | undefined {
    const pending = this.pending;
    if (
      pending?.lifecycleEvent !== event.type ||
      pending.record.targetId !== event.targetId
    ) {
      return undefined;
    }
    this.pending = undefined;
    this.taken = true;
    return pending;
  }

  wasTaken(): boolean {
    return this.taken;
  }

  clear(): void {
    this.pending = undefined;
    this.taken = false;
  }
}
