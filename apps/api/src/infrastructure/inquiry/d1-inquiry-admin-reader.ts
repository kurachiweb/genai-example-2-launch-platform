import { and, desc, eq, gte, lt, type SQL, sql } from 'drizzle-orm';
import { unionAll } from 'drizzle-orm/sqlite-core';
import { inject, injectable } from 'inversify';

import type {
  InquiryKind,
  InquiryStatus,
} from '../../../common-lib/inquiry/inquiry-status.ts';
import type { Database } from '../../../db/client.ts';
import { notDeleted } from '../../../db/schema/_shared/columns.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { guestInquiries } from '../../../db/schema/inquiry/guest-inquiries.ts';
import { memberInquiries } from '../../../db/schema/inquiry/member-inquiries.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  AdminInquiryDetail,
  AdminInquiryFilter,
  AdminInquiryPage,
  InquiryAdminReader,
} from '../../application/inquiry/ports.ts';
import { MEMBER_INQUIRY_RECORD_COLUMNS } from './d1-member-inquiry-store.ts';
import {
  afterInquiryCursor,
  type InquiryPageKeys,
  inquiryPageOf,
} from './inquiry-page.ts';

interface InquiryFilterColumns extends InquiryPageKeys {
  readonly status: typeof memberInquiries.status | typeof guestInquiries.status;
  readonly categoryId:
    typeof memberInquiries.categoryId | typeof guestInquiries.categoryId;
}

const GUEST_INQUIRY_RECORD_COLUMNS = {
  id: guestInquiries.id,
  categoryId: guestInquiries.categoryId,
  nickname: guestInquiries.nickname,
  email: guestInquiries.email,
  body: guestInquiries.body,
  status: guestInquiries.status,
  statusChangedAt: guestInquiries.statusChangedAt,
  createdAt: guestInquiries.createdAt,
};

const UNHANDLED_STATUS: InquiryStatus = 'open';

// 両方のテーブルの副問い合わせに同じ条件を入れ、各テーブルの(status, created_at)・category_id・created_atの索引で絞れるようにする
function filterConditions(
  columns: InquiryFilterColumns,
  filter: AdminInquiryFilter,
  after: string | undefined,
): SQL | undefined {
  return and(
    filter.status === undefined ? undefined : eq(columns.status, filter.status),
    filter.categoryId === undefined
      ? undefined
      : eq(columns.categoryId, filter.categoryId),
    filter.receivedFrom === undefined
      ? undefined
      : gte(columns.createdAt, filter.receivedFrom),
    filter.receivedBefore === undefined
      ? undefined
      : lt(columns.createdAt, filter.receivedBefore),
    afterInquiryCursor(columns, after),
  );
}

const includesKind = (filter: AdminInquiryFilter, kind: InquiryKind) =>
  filter.kind === undefined || filter.kind === kind;

@injectable()
export class D1InquiryAdminReader implements InquiryAdminReader {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  // 退会した利用者の問い合わせも物理削除までは「退会済み」として一覧に出すため、論理削除を除かない
  async list(
    filter: AdminInquiryFilter,
    page: { readonly after?: string; readonly limit: 50 },
  ): Promise<AdminInquiryPage> {
    const fetchLimit = page.limit + 1;
    const merged = unionAll(
      this.db.select().from(this.memberPageOf(filter, page.after, fetchLimit)),
      this.db.select().from(this.guestPageOf(filter, page.after, fetchLimit)),
    ).as('inquiry_pages');
    const rows = await this.db
      .select()
      .from(merged)
      .orderBy(desc(merged.createdAt), desc(merged.id))
      .limit(fetchLimit);
    return inquiryPageOf(rows, page.limit);
  }

  private memberPageOf(
    filter: AdminInquiryFilter,
    after: string | undefined,
    fetchLimit: number,
  ) {
    return this.db
      .select({
        kind: sql<InquiryKind>`'member'`.as('kind'),
        id: memberInquiries.id,
        categoryId: memberInquiries.categoryId,
        status: memberInquiries.status,
        senderName: users.nickname,
        withdrawn: sql<boolean>`${memberInquiries.deletedAt} IS NOT NULL`
          .mapWith(Boolean)
          .as('withdrawn'),
        createdAt: memberInquiries.createdAt,
        lastMessageAt: memberInquiries.lastMessageAt,
      })
      .from(memberInquiries)
      .innerJoin(users, eq(users.id, memberInquiries.userId))
      .where(
        and(
          includesKind(filter, 'member') ? undefined : sql`0`,
          filterConditions(memberInquiries, filter, after),
        ),
      )
      .orderBy(desc(memberInquiries.createdAt), desc(memberInquiries.id))
      .limit(fetchLimit)
      .as('member_page');
  }

  private guestPageOf(
    filter: AdminInquiryFilter,
    after: string | undefined,
    fetchLimit: number,
  ) {
    return this.db
      .select({
        kind: sql<InquiryKind>`'guest'`.as('kind'),
        id: guestInquiries.id,
        categoryId: guestInquiries.categoryId,
        status: guestInquiries.status,
        senderName: guestInquiries.nickname,
        withdrawn: sql<boolean>`0`.mapWith(Boolean).as('withdrawn'),
        createdAt: guestInquiries.createdAt,
        lastMessageAt: sql<Date>`${guestInquiries.createdAt}`
          .mapWith(guestInquiries.createdAt)
          .as('last_message_at'),
      })
      .from(guestInquiries)
      .where(
        and(
          includesKind(filter, 'guest') ? undefined : sql`0`,
          filterConditions(guestInquiries, filter, after),
        ),
      )
      .orderBy(desc(guestInquiries.createdAt), desc(guestInquiries.id))
      .limit(fetchLimit)
      .as('guest_page');
  }

  // 退会済みの表示と管理操作の拒否は呼び出し側が削除日時で決めるため、論理削除したログインの問い合わせも返す
  async findDetail(id: string): Promise<AdminInquiryDetail | undefined> {
    const [[member], [guest]] = await Promise.all([
      this.db
        .select(MEMBER_INQUIRY_RECORD_COLUMNS)
        .from(memberInquiries)
        .where(eq(memberInquiries.id, id)),
      this.db
        .select(GUEST_INQUIRY_RECORD_COLUMNS)
        .from(guestInquiries)
        .where(eq(guestInquiries.id, id)),
    ]);
    if (member !== undefined) {
      return { kind: 'member', inquiry: member };
    }
    if (guest !== undefined) {
      return { kind: 'guest', inquiry: guest };
    }
    return undefined;
  }

  async countUnhandled(): Promise<number> {
    const [members, guests] = await Promise.all([
      this.db.$count(
        memberInquiries,
        and(
          eq(memberInquiries.status, UNHANDLED_STATUS),
          notDeleted(memberInquiries.deletedAt),
        ),
      ),
      this.db.$count(
        guestInquiries,
        eq(guestInquiries.status, UNHANDLED_STATUS),
      ),
    ]);
    return members + guests;
  }
}
