import type { AuditTargetKind } from '../../../common-lib/admin/audit-action.ts';

export interface AuditEntryInput {
  readonly operatorAdminId: string;
  readonly action: string;
  readonly targetIds: readonly string[];
  readonly reason?: string;
  readonly detail?: Readonly<Record<string, string>>;
  readonly occurredAt: Date;
}

// 検証を経ずに組み立てた値をストアへ渡せないよう、型だけの印で準備済みの値を区別する。印は値を持たないため、付けられるのは記録の実装の型の表明だけである
declare const PREPARED: unique symbol;

export interface PreparedAuditEntry {
  readonly [PREPARED]: true;
  readonly id: string;
  readonly operatorAdminId: string;
  readonly action: string;
  readonly targetKind: AuditTargetKind | null;
  readonly targetIds: readonly string[];
  readonly reason: string | null;
  readonly detail: Readonly<Record<string, string>>;
  readonly occurredAt: Date;
}

export interface AuditLogRecorder {
  // 管理操作の前に呼び、違反があれば操作を行わせない。結果は操作と同じ一括の書き込みでストアへ渡す
  prepare(entry: AuditEntryInput): PreparedAuditEntry;
  // 閲覧・検索のような記録だけの操作で、結果を返す前に単独で書く
  record(entry: AuditEntryInput): Promise<void>;
}
