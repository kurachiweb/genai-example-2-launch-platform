import { and, asc, count, eq, type SQL, sql } from 'drizzle-orm';
import { unionAll } from 'drizzle-orm/sqlite-core';
import { inject, injectable } from 'inversify';

import { INQUIRY_CATEGORY_OTHER_ID } from '../../../common-lib/inquiry/inquiry-category-constants.ts';
import type { Database } from '../../../db/client.ts';
import { guestInquiries } from '../../../db/schema/inquiry/guest-inquiries.ts';
import { inquiryCategories } from '../../../db/schema/inquiry/inquiry-categories.ts';
import { memberInquiries } from '../../../db/schema/inquiry/member-inquiries.ts';
import type { PreparedAuditEntry } from '../../../lib/core/admin/audit-log.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  InquiryCategoryDeletion,
  InquiryCategoryRecord,
  InquiryCategoryStore,
  NewInquiryCategory,
} from '../../application/inquiry/ports.ts';
import {
  buildAuditLogStatements,
  isAuditGuardRejection,
} from '../admin/audit-log-statements.ts';

const CATEGORY_RECORD_COLUMNS = {
  id: inquiryCategories.id,
  name: inquiryCategories.name,
  systemDefault: inquiryCategories.systemDefault,
  createdAt: inquiryCategories.createdAt,
};

const NAME_COLUMN = 'inquiry_categories.name';

const UNIQUE_VIOLATION_PATTERN = /UNIQUE constraint failed: ([^:]+)/u;

// 一括の書き込みの失敗はD1のエラーがcauseにSQLiteのエラーを持ち、文の組み立ての失敗はDrizzleQueryErrorが包むため、原因をたどって文言を調べる
function violatesUniqueName(error: unknown): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    const columns = UNIQUE_VIOLATION_PATTERN.exec(current.message)?.[1];
    if (columns !== undefined) {
      return columns.split(',').some((column) => column.trim() === NAME_COLUMN);
    }
  }
  return false;
}

const editableCategory = (id: string): SQL | undefined =>
  and(eq(inquiryCategories.id, id), eq(inquiryCategories.systemDefault, false));

// 監査ログの条件は書き込みの時点で評価され、偽なら名前の変更・付け替え・削除も含めて取り消される
const editableCategoryExists = (id: string): SQL =>
  sql`EXISTS (SELECT 1 FROM ${inquiryCategories} WHERE ${editableCategory(id)})`;

@injectable()
export class D1InquiryCategoryStore implements InquiryCategoryStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async list(): Promise<readonly InquiryCategoryRecord[]> {
    return this.db
      .select(CATEGORY_RECORD_COLUMNS)
      .from(inquiryCategories)
      .orderBy(asc(inquiryCategories.createdAt), asc(inquiryCategories.id));
  }

  async findById(id: string): Promise<InquiryCategoryRecord | undefined> {
    const [row] = await this.db
      .select(CATEGORY_RECORD_COLUMNS)
      .from(inquiryCategories)
      .where(eq(inquiryCategories.id, id));
    return row;
  }

  async insert(
    category: NewInquiryCategory,
    audit: PreparedAuditEntry,
  ): Promise<'created' | 'name-taken'> {
    try {
      await this.db.batch([
        ...buildAuditLogStatements(this.db, audit),
        this.db.insert(inquiryCategories).values({
          id: category.id,
          name: category.name,
          createdAt: category.at,
          updatedAt: category.at,
        }),
      ]);
      return 'created';
    } catch (error) {
      if (violatesUniqueName(error)) {
        return 'name-taken';
      }
      throw error;
    }
  }

  async rename(
    id: string,
    name: string,
    at: Date,
    audit: PreparedAuditEntry,
  ): Promise<'renamed' | 'name-taken' | 'not-found'> {
    try {
      await this.db.batch([
        ...buildAuditLogStatements(this.db, audit, {
          kind: 'condition',
          condition: editableCategoryExists(id),
        }),
        this.db
          .update(inquiryCategories)
          .set({ name, updatedAt: at })
          .where(editableCategory(id)),
      ]);
      return 'renamed';
    } catch (error) {
      if (violatesUniqueName(error)) {
        return 'name-taken';
      }
      if (isAuditGuardRejection(error)) {
        return 'not-found';
      }
      throw error;
    }
  }

  // 外部キーにより紐付く行が1件でも残るとカテゴリを消せないため、退会により論理削除したログインの問い合わせも付け替える
  async deleteAndReassign(
    id: string,
    audit: PreparedAuditEntry,
  ): Promise<InquiryCategoryDeletion> {
    const at = audit.occurredAt;
    try {
      // 監査ログの文の数が対象の数で変わり、DrizzleがBatchItemの一般形の結果の型を求められないため、D1の結果の型で受ける
      const results = (await this.db.batch([
        ...buildAuditLogStatements(this.db, audit, {
          kind: 'condition',
          condition: editableCategoryExists(id),
        }),
        this.db
          .update(memberInquiries)
          .set({ categoryId: INQUIRY_CATEGORY_OTHER_ID, updatedAt: at })
          .where(eq(memberInquiries.categoryId, id)),
        this.db
          .update(guestInquiries)
          .set({ categoryId: INQUIRY_CATEGORY_OTHER_ID, updatedAt: at })
          .where(eq(guestInquiries.categoryId, id)),
        this.db.delete(inquiryCategories).where(editableCategory(id)),
      ])) as readonly D1Result[];
      const [memberResult, guestResult] = results.slice(-3);
      return {
        result: 'deleted',
        reassigned:
          (memberResult?.meta.changes ?? 0) + (guestResult?.meta.changes ?? 0),
      };
    } catch (error) {
      if (isAuditGuardRejection(error)) {
        return { result: 'not-found', reassigned: 0 };
      }
      throw error;
    }
  }

  // 削除の付け替えと同じ範囲で数えるため、論理削除したログインの問い合わせも含める
  async countLinked(id: string): Promise<number> {
    const [members, guests] = await Promise.all([
      this.db.$count(memberInquiries, eq(memberInquiries.categoryId, id)),
      this.db.$count(guestInquiries, eq(guestInquiries.categoryId, id)),
    ]);
    return members + guests;
  }

  async countLinkedByCategory(): Promise<ReadonlyMap<string, number>> {
    const linked = unionAll(
      this.db
        .select({ categoryId: memberInquiries.categoryId })
        .from(memberInquiries),
      this.db
        .select({ categoryId: guestInquiries.categoryId })
        .from(guestInquiries),
    ).as('linked');
    const rows = await this.db
      .select({ categoryId: linked.categoryId, linkedCount: count() })
      .from(linked)
      .groupBy(linked.categoryId);
    return new Map(rows.map((row) => [row.categoryId, row.linkedCount]));
  }
}
