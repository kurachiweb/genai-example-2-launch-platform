import type { BatchItem } from 'drizzle-orm/batch';

import type { PendingModerationRecord } from '../../application/moderation/pending-moderation-record.ts';
import type { D1ModerationStatements } from './d1-moderation-statements.ts';
import {
  moderationWriteContextOf,
  type ModerationWriteParticipants,
} from './moderation-write-participant.ts';

export interface PendingModerationDependencies {
  readonly pending: PendingModerationRecord;
  readonly statements: D1ModerationStatements;
  readonly participants: ModerationWriteParticipants;
}

export interface ModerationLifecycleOccurrence {
  readonly id: string;
  readonly type: string;
  readonly targetId: string;
  readonly occurredAt: Date;
}

// 保留中の措置が同じイベントの種類と対象を待っていれば、イベントのIDと日時で記録を完成させ、記録・監査ログ・参加者の文をこの順に返す。措置でないイベント(本人の退会など)には文を返さない
export async function pendingModerationStatements(
  { pending, statements, participants }: PendingModerationDependencies,
  occurrence: ModerationLifecycleOccurrence,
): Promise<readonly BatchItem<'sqlite'>[]> {
  const taken = pending.take({
    type: occurrence.type,
    targetId: occurrence.targetId,
  });
  if (taken === undefined) {
    return [];
  }
  const record = {
    ...taken.record,
    lifecycleEventId: occurrence.id,
    occurredAt: occurrence.occurredAt,
  };
  const participantStatements = await participants.statementsFor(
    taken.participation,
    moderationWriteContextOf(record),
  );
  return [
    ...statements.forRecord(record, taken.audit),
    ...participantStatements,
  ];
}
