import { asc, eq, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';

import type { AuditTargetKind } from '../../../../common-lib/admin/audit-action.ts';
import type { ModerationAction } from '../../../../common-lib/moderation/moderation-actions.ts';
import { adminAuditLogTargets } from '../../../../db/schema/admin/admin-audit-log-targets.ts';
import { adminAuditLogs } from '../../../../db/schema/admin/admin-audit-logs.ts';
import type { PreparedAuditEntry } from '../../../../lib/core/admin/audit-log.ts';
import {
  clearModerationRecords,
  db,
  OPERATOR_ADMIN_ID,
} from '../../../../lib/workers/moderation/testing/moderation-record-fixtures.ts';
import type {
  ModerationWriteContext,
  ModerationWriteParticipant,
} from '../moderation-write-participant.ts';

export const TEST_PARTICIPANT_KIND = 'test-spec.moderation-note';

export const TEST_PARTICIPANT = Symbol.for('test.ModerationNoteParticipant');

const PARTICIPANT_NOTE_ID = '01JQ0NOTE00000000000000001';

const PARTICIPANT_NOTE_OPERATOR = 'test-spec';

// 利用者の対象は監査ログの規則で仮名化ID(UUID)だけを受け付ける
export const PSEUDONYMOUS_ID = '0b9c6f0e-6a55-4a1f-9d4e-2f3c5b7a8d91';

export function auditLogIdOf(index: number): string {
  return `01JQ0AUD${String(index).padStart(18, '0')}`;
}

export function auditOf(input: {
  readonly index: number;
  readonly action: ModerationAction;
  readonly targetKind: AuditTargetKind;
  readonly targetId: string;
  readonly occurredAt: Date;
  readonly reason?: string | null;
}): PreparedAuditEntry {
  return {
    id: auditLogIdOf(input.index),
    operatorAdminId: OPERATOR_ADMIN_ID,
    action: input.action,
    targetKind: input.targetKind,
    targetIds: [input.targetId],
    reason: input.reason ?? null,
    detail: {},
    occurredAt: input.occurredAt,
  } as unknown as PreparedAuditEntry;
}

export interface ParticipantNotePayload {
  readonly note: string;
  // 参加者の文の違反で一括の書き込み全体が取り消されることを確かめるため、NOT NULLの列を空にする
  readonly violate?: boolean;
}

// 呼び出し側(後続spec)の記録の代わりに、措置の記録のIDを詳細に持つ行を監査ログのテーブルへ挿入する
export function createTestParticipant(): ModerationWriteParticipant & {
  readonly received: (readonly [unknown, ModerationWriteContext])[];
} {
  const received: (readonly [unknown, ModerationWriteContext])[] = [];
  return {
    received,
    statementsFor: (participation, context) => {
      received.push([participation.payload, context]);
      const payload = participation.payload as ParticipantNotePayload;
      const statement: BatchItem<'sqlite'> = db.insert(adminAuditLogs).values({
        id: PARTICIPANT_NOTE_ID,
        operatorAdminId: PARTICIPANT_NOTE_OPERATOR,
        action: payload.violate === true ? sql`NULL` : TEST_PARTICIPANT_KIND,
        reason: payload.note,
        detail: { actionId: context.actionId },
        occurredAt: context.occurredAt,
        createdAt: context.occurredAt,
        updatedAt: context.occurredAt,
      });
      return Promise.resolve([statement]);
    },
  };
}

export async function readParticipantNotes() {
  return db
    .select({
      reason: adminAuditLogs.reason,
      detail: adminAuditLogs.detail,
    })
    .from(adminAuditLogs)
    .where(eq(adminAuditLogs.operatorAdminId, PARTICIPANT_NOTE_OPERATOR));
}

export async function readModerationAuditLogs() {
  const logs = await db
    .select()
    .from(adminAuditLogs)
    .orderBy(asc(adminAuditLogs.id));
  const targets = await db
    .select()
    .from(adminAuditLogTargets)
    .orderBy(asc(adminAuditLogTargets.id));
  return logs
    .filter(
      ({ operatorAdminId }) => operatorAdminId !== PARTICIPANT_NOTE_OPERATOR,
    )
    .map((log) => ({
      ...log,
      targets: targets
        .filter(({ logId }) => logId === log.id)
        .map(({ targetKind, targetId }) => ({ targetKind, targetId })),
    }));
}

export async function clearModerationWrites(): Promise<void> {
  await db.delete(adminAuditLogTargets);
  await db.delete(adminAuditLogs);
  await clearModerationRecords();
}
