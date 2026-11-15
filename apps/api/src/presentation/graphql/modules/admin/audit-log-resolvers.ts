import type { AuditActionCatalog } from '../../../../../common-lib/admin/audit-action.ts';
import { ADMIN_PLATFORM_TYPES } from '../../../../../lib/core/admin/identifiers.ts';
import type { AdminDirectory } from '../../../../../lib/core/admin/ports.ts';
import { ADMIN_TYPES } from '../../../../application/admin/admin-types.ts';
import {
  AUDIT_LOG_PAGE_SIZE,
  type AuditLogEntryView,
  type AuditLogReader,
} from '../../../../application/admin/audit-log-reader.ts';
import { requireAdmin } from '../../admin-guard.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import { AUDIT_LOGS_ARGS } from './inputs.ts';
import { adminOnly } from './resolver-support.ts';

interface AuditLogEntrySource {
  readonly id: string;
  readonly occurredAt: Date;
  readonly operator: { readonly id: string; readonly nickname: string | null };
  readonly action: string;
  readonly actionLabel: string;
  readonly targetKind: string | null;
  readonly targetIds: string[];
  readonly reason: string | null;
  readonly detail: { readonly key: string; readonly value: string }[];
}

// 記録の後に登録から外れた操作種別も一覧から消さないよう、表示名が無ければ名前で示す
function toEntrySource(
  entry: AuditLogEntryView,
  nicknames: ReadonlyMap<string, { readonly nickname: string }>,
  catalog: AuditActionCatalog,
): AuditLogEntrySource {
  return {
    id: entry.id,
    occurredAt: entry.occurredAt,
    operator: {
      id: entry.operatorAdminId,
      nickname: nicknames.get(entry.operatorAdminId)?.nickname ?? null,
    },
    action: entry.action,
    actionLabel: catalog.find(entry.action)?.label ?? entry.action,
    targetKind: entry.targetKind,
    targetIds: [...entry.targetIds],
    reason: entry.reason,
    detail: Object.entries(entry.detail).map(([key, value]) => ({
      key,
      value,
    })),
  };
}

export const auditLogResolvers = {
  Query: {
    auditLogs: adminOnly(
      withValidatedArgs(
        AUDIT_LOGS_ARGS,
        async (_parent: unknown, { filter, after }, context) => {
          await requireAdmin(context, 'viewer');
          const { entries, nextCursor } = await context
            .resolve<AuditLogReader>(ADMIN_TYPES.AuditLogReader)
            .search(filter, {
              limit: AUDIT_LOG_PAGE_SIZE,
              ...(after !== undefined && { after }),
            });
          // 削除済みの管理者は照会口が返さないため、ニックネームが空になる
          const nicknames = await context
            .resolve<AdminDirectory>(ADMIN_PLATFORM_TYPES.AdminDirectory)
            .findProfiles(entries.map((entry) => entry.operatorAdminId));
          const catalog = context.resolve<AuditActionCatalog>(
            ADMIN_TYPES.AuditActionCatalog,
          );
          return {
            entries: entries.map((entry) =>
              toEntrySource(entry, nicknames, catalog),
            ),
            nextCursor,
          };
        },
      ),
    ),
  },
} satisfies Resolvers;
