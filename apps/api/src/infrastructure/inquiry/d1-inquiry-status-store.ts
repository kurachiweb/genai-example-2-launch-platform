import { and, eq, type SQL, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { inject, injectable } from 'inversify';

import type { InquiryStatus } from '../../../common-lib/inquiry/inquiry-status.ts';
import type { Database } from '../../../db/client.ts';
import { notDeleted } from '../../../db/schema/_shared/columns.ts';
import { guestInquiries } from '../../../db/schema/inquiry/guest-inquiries.ts';
import { memberInquiries } from '../../../db/schema/inquiry/member-inquiries.ts';
import type { PreparedAuditEntry } from '../../../lib/core/admin/audit-log.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  InquiryStatusStore,
  InquiryStatusTarget,
} from '../../application/inquiry/ports.ts';
import {
  buildAuditLogStatements,
  isAuditGuardRejection,
} from '../admin/audit-log-statements.ts';

interface StatusChange {
  readonly next: InquiryStatus;
  readonly at: Date;
}

@injectable()
export class D1InquiryStatusStore implements InquiryStatusStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  // 読み取った後の別の管理者の変更や退会の確定を上書きしないよう、読み取った時点のステータスのままで論理削除されていないことを書き込みの時点の条件にする
  async change(
    target: InquiryStatusTarget,
    next: InquiryStatus,
    at: Date,
    audit: PreparedAuditEntry,
  ): Promise<'changed' | 'conflict'> {
    const { condition, update } = this.statementsOf(target, { next, at });
    try {
      await this.db.batch([
        ...buildAuditLogStatements(this.db, audit, {
          kind: 'condition',
          condition,
        }),
        update,
      ]);
      return 'changed';
    } catch (error) {
      if (isAuditGuardRejection(error)) {
        return 'conflict';
      }
      throw error;
    }
  }

  private statementsOf(
    target: InquiryStatusTarget,
    change: StatusChange,
  ): { readonly condition: SQL; readonly update: BatchItem<'sqlite'> } {
    const values = {
      status: change.next,
      statusChangedAt: change.at,
      updatedAt: change.at,
    };
    if (target.kind === 'member') {
      const unchanged = and(
        eq(memberInquiries.id, target.id),
        eq(memberInquiries.status, target.status),
        notDeleted(memberInquiries.deletedAt),
      );
      return {
        condition: sql`EXISTS (SELECT 1 FROM ${memberInquiries} WHERE ${unchanged})`,
        update: this.db.update(memberInquiries).set(values).where(unchanged),
      };
    }
    const unchanged = and(
      eq(guestInquiries.id, target.id),
      eq(guestInquiries.status, target.status),
    );
    return {
      condition: sql`EXISTS (SELECT 1 FROM ${guestInquiries} WHERE ${unchanged})`,
      update: this.db.update(guestInquiries).set(values).where(unchanged),
    };
  }
}
