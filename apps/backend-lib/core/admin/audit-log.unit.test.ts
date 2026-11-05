import { describe, expect, expectTypeOf, test } from 'bun:test';

import type { AuditTargetKind } from '../../../common-lib/admin/audit-action.ts';
import type {
  AuditEntryInput,
  AuditLogRecorder,
  PreparedAuditEntry,
} from './audit-log.ts';

const ENTRY: AuditEntryInput = {
  operatorAdminId: '01JBX8Y4Z5ABCDEFGHJKMNPQRS',
  action: 'admin-account.invite',
  targetIds: ['01JBX8Y4Z5ABCDEFGHJKMNPQRT'],
  occurredAt: new Date('2026-11-03T12:00:00.000Z'),
};

describe('AuditEntryInput', () => {
  test('操作者・操作種別・対象・日時を必須とし、理由と詳細は任意である', () => {
    expectTypeOf<AuditEntryInput>().toEqualTypeOf<{
      readonly operatorAdminId: string;
      readonly action: string;
      readonly targetIds: readonly string[];
      readonly reason?: string;
      readonly detail?: Readonly<Record<string, string>>;
      readonly occurredAt: Date;
    }>();
    expect(ENTRY.reason).toBeUndefined();
  });
});

describe('PreparedAuditEntry', () => {
  test('準備済みの印の無い値は、同じ項目を持っていても準備済みの記録として扱えない', () => {
    const unprepared = {
      id: '01JAUDITLOG000000000000001',
      operatorAdminId: ENTRY.operatorAdminId,
      action: ENTRY.action,
      targetKind: 'admin' as AuditTargetKind | null,
      targetIds: ENTRY.targetIds,
      reason: null,
      detail: {},
      occurredAt: ENTRY.occurredAt,
    };

    expectTypeOf(unprepared).not.toExtend<PreparedAuditEntry>();
    expect(Object.getOwnPropertySymbols(unprepared)).toEqual([]);
  });
});

describe('AuditLogRecorder', () => {
  test('準備は同期で準備済みの記録を返し、記録だけの操作は単独で書く', () => {
    expectTypeOf<
      ReturnType<AuditLogRecorder['prepare']>
    >().toEqualTypeOf<PreparedAuditEntry>();
    expectTypeOf<Parameters<AuditLogRecorder['record']>>().toEqualTypeOf<
      [AuditEntryInput]
    >();
    expectTypeOf<ReturnType<AuditLogRecorder['record']>>().toEqualTypeOf<
      Promise<void>
    >();
  });
});
