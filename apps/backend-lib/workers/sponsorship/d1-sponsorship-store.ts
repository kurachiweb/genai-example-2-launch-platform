import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { sponsorships } from '../../../db/schema/sponsorship/sponsorships.ts';
import type { SponsorshipTier } from '../../../common-lib/sponsorship/sponsorship-tiers.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import { invalidCursorError } from '../../core/errors/invalid-cursor.ts';
import type { IdGenerator } from '../../core/ids/id-generator.ts';
import { UPPERCASE_ULID_SOURCE } from '../../core/ids/uppercase-ulid.ts';
import type {
  AdminSponsorshipFilter,
  AdminSponsorshipStatusFilter,
  NewSponsorship,
  SponsorshipDatePeriodRecord,
  SponsorshipPage,
  SponsorshipPageInput,
  SponsorshipRecord,
  SponsorshipRefundRecord,
  SponsorshipStore,
} from '../../core/sponsorship/ports.ts';
import {
  type BusinessDate,
  parseBusinessDate,
} from '../../core/time/business-time.ts';

type SponsorshipRow = typeof sponsorships.$inferSelect;

const CURSOR_PATTERN = new RegExp(
  String.raw`^(\d{1,15}):(${UPPERCASE_ULID_SOURCE})$`,
  'u',
);

const BASE64URL_OPTIONS = {
  alphabet: 'base64url',
  omitPadding: true,
} as const;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });

const NOT_DELETED = isNull(sponsorships.deletedAt);

// 重なり・件数・掲載期間の一覧が数える、掲載権の有効な決済済みの申込
const ENTITLED = and(
  eq(sponsorships.state, 'paid'),
  NOT_DELETED,
  isNull(sponsorships.productDeletedAt),
);

// SQLiteは問い合わせの条件が部分索引の条件を含むと分かるときだけ部分索引を使い、バインド変数の値では判定しないため、部分索引の条件の値をリテラルで書く
const UNSETTLED_PAID = sql`${sponsorships.state} = 'paid' and ${sponsorships.deletedAt} is null and ${sponsorships.stopRefundStatus} = 'none'`;

// 統計の無いD1では状態の等号で絞れる表示の索引が選ばれ、決済済みの全件を読んで並べ替えるため、終了日の部分索引を指定する。部分索引を使えない条件に変えると実行時のエラーになる。
// Drizzleの問い合わせの組み立てはINDEXED BYを書けないため、対象のIDを選ぶ副問い合わせだけをSQLで書く
const UNSETTLED_END_INDEX = 'sponsorships_unsettled_end_idx';

interface PagePosition {
  readonly createdAt: Date;
  readonly id: string;
}

function encodeCursor(position: PagePosition): string {
  return textEncoder
    .encode(`${String(position.createdAt.getTime())}:${position.id}`)
    .toBase64(BASE64URL_OPTIONS);
}

function decodeCursorText(cursor: string): string | undefined {
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.fromBase64(cursor, { alphabet: 'base64url' });
  } catch {
    return undefined;
  }
  // デコードは空白・パディング・末尾の余りのビットを許すため、再エンコードして同じ表記のものだけを受け付ける
  if (bytes.toBase64(BASE64URL_OPTIONS) !== cursor) {
    return undefined;
  }
  try {
    return textDecoder.decode(bytes);
  } catch {
    return undefined;
  }
}

function afterCursor(cursor: string | undefined): SQL | undefined {
  if (cursor === undefined) {
    return undefined;
  }
  const [, createdAt, id] =
    CURSOR_PATTERN.exec(decodeCursorText(cursor) ?? '') ?? [];
  if (createdAt === undefined || id === undefined) {
    throw invalidCursorError();
  }
  const at = new Date(Number(createdAt));
  return or(
    lt(sponsorships.createdAt, at),
    and(eq(sponsorships.createdAt, at), lt(sponsorships.id, id)),
  );
}

function refundOf(
  status: SponsorshipRow['stopRefundStatus'],
  days: number | null,
  amount: number | null,
  refundRequestId: string | null,
): SponsorshipRefundRecord {
  return { status, days, amount, refundRequestId };
}

function recordOf(row: SponsorshipRow): SponsorshipRecord {
  return {
    id: row.id,
    userId: row.userId,
    productId: row.productId,
    tier: row.tier,
    startsOn: parseBusinessDate(row.startsOn),
    endsOn: parseBusinessDate(row.endsOn),
    days: row.days,
    state: row.state,
    purchaseId: row.purchaseId,
    paymentRecordId: row.paymentRecordId,
    amountTotal: row.amountTotal,
    paidAt: row.paidAt,
    terminatedAt: row.terminatedAt,
    terminationReason: row.terminationReason,
    productDeletedAt: row.productDeletedAt,
    terminationRefund: refundOf(
      row.terminationRefundStatus,
      row.terminationRefundDays,
      row.terminationRefundAmount,
      row.terminationRefundRequestId,
    ),
    stopRefund: refundOf(
      row.stopRefundStatus,
      row.stopRefundDays,
      row.stopRefundAmount,
      row.stopRefundRequestId,
    ),
    createdAt: row.createdAt,
  };
}

// 返す状態はderiveSponsorshipStatusが保存の状態・期間・プロダクトの論理削除から導く境界と同じ条件をSQLで書く。表示停止はプロダクトと投稿者の状態のため、掲載中に含める
function statusCondition(
  status: AdminSponsorshipStatusFilter,
  today: BusinessDate,
): SQL | undefined {
  switch (status) {
    case 'pending_payment':
      return eq(sponsorships.state, 'pending_payment');
    case 'scheduled':
      return and(
        eq(sponsorships.state, 'paid'),
        isNull(sponsorships.productDeletedAt),
        gt(sponsorships.startsOn, today),
      );
    case 'active':
      return and(
        eq(sponsorships.state, 'paid'),
        isNull(sponsorships.productDeletedAt),
        lte(sponsorships.startsOn, today),
        gte(sponsorships.endsOn, today),
      );
    case 'ended':
      return and(
        eq(sponsorships.state, 'paid'),
        or(
          isNotNull(sponsorships.productDeletedAt),
          lt(sponsorships.endsOn, today),
        ),
      );
    case 'terminated':
      return eq(sponsorships.state, 'terminated');
  }
}

function samePlacement(input: {
  readonly productId: string;
  readonly tier: SponsorshipTier;
}): SQL | undefined {
  return and(
    eq(sponsorships.productId, input.productId),
    eq(sponsorships.tier, input.tier),
    ENTITLED,
  );
}

@injectable()
export class D1SponsorshipStore implements SponsorshipStore {
  constructor(
    @inject(PLATFORM_TYPES.Database) private readonly db: Database,
    @inject(PLATFORM_TYPES.IdGenerator) private readonly ids: IdGenerator,
  ) {}

  async create(input: NewSponsorship, at: Date): Promise<SponsorshipRecord> {
    const [row] = await this.db
      .insert(sponsorships)
      .values({
        id: this.ids.generate(),
        ...input,
        state: 'pending_payment',
        createdAt: at,
        updatedAt: at,
      })
      .returning();
    if (row === undefined) {
      throw new Error('作成した申込の行を読めませんでした');
    }
    return recordOf(row);
  }

  async findById(id: string): Promise<SponsorshipRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(sponsorships)
      .where(and(eq(sponsorships.id, id), NOT_DELETED));
    return row === undefined ? undefined : recordOf(row);
  }

  async hasPaidOverlap(input: {
    readonly productId: string;
    readonly tier: SponsorshipTier;
    readonly startsOn: BusinessDate;
    readonly endsOn: BusinessDate;
    readonly excludeId?: string;
  }): Promise<boolean> {
    const [row] = await this.db
      .select({ id: sponsorships.id })
      .from(sponsorships)
      .where(
        and(
          samePlacement(input),
          lte(sponsorships.startsOn, input.endsOn),
          gte(sponsorships.endsOn, input.startsOn),
          input.excludeId === undefined
            ? undefined
            : ne(sponsorships.id, input.excludeId),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  async listPaidPeriods(input: {
    readonly productId: string;
    readonly tier: SponsorshipTier;
    readonly endsOnOrAfter: BusinessDate;
  }): Promise<readonly SponsorshipDatePeriodRecord[]> {
    const rows = await this.db
      .select({ startsOn: sponsorships.startsOn, endsOn: sponsorships.endsOn })
      .from(sponsorships)
      .where(
        and(
          samePlacement(input),
          gte(sponsorships.endsOn, input.endsOnOrAfter),
        ),
      )
      .orderBy(asc(sponsorships.startsOn), asc(sponsorships.id));
    return rows.map((row) => ({
      startsOn: parseBusinessDate(row.startsOn),
      endsOn: parseBusinessDate(row.endsOn),
    }));
  }

  async listByOwner(
    userId: string,
    page: SponsorshipPageInput,
  ): Promise<SponsorshipPage> {
    return this.readPage(eq(sponsorships.userId, userId), page);
  }

  async listForAdmin(
    filter: AdminSponsorshipFilter,
    today: BusinessDate,
    page: SponsorshipPageInput,
  ): Promise<SponsorshipPage> {
    return this.readPage(
      and(
        filter.status === undefined
          ? undefined
          : statusCondition(filter.status, today),
        filter.tier === undefined
          ? undefined
          : eq(sponsorships.tier, filter.tier),
      ),
      page,
    );
  }

  async countActiveForProduct(
    productId: string,
    today: BusinessDate,
  ): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(sponsorships)
      .where(
        and(
          eq(sponsorships.productId, productId),
          ENTITLED,
          gte(sponsorships.endsOn, today),
        ),
      );
    return row?.total ?? 0;
  }

  async deleteUnpaid(id: string): Promise<void> {
    await this.db
      .delete(sponsorships)
      .where(
        and(eq(sponsorships.id, id), eq(sponsorships.state, 'pending_payment')),
      );
  }

  async deleteExpiredUnpaid(
    today: BusinessDate,
    limit: number,
  ): Promise<number> {
    const expired = this.db
      .select({ id: sponsorships.id })
      .from(sponsorships)
      .where(
        and(
          eq(sponsorships.state, 'pending_payment'),
          lt(sponsorships.startsOn, today),
        ),
      )
      .orderBy(asc(sponsorships.startsOn), asc(sponsorships.id))
      .limit(limit);
    const deleted = await this.db
      .delete(sponsorships)
      .where(
        and(
          inArray(sponsorships.id, expired),
          eq(sponsorships.state, 'pending_payment'),
        ),
      )
      .returning({ id: sponsorships.id });
    return deleted.length;
  }

  async listUnsettledEnded(
    today: BusinessDate,
    limit: number,
  ): Promise<readonly SponsorshipRecord[]> {
    const unsettled = sql`(select ${sponsorships.id} from ${sponsorships} indexed by ${sql.identifier(UNSETTLED_END_INDEX)} where ${UNSETTLED_PAID} and ${sponsorships.productDeletedAt} is null and ${sponsorships.endsOn} < ${today} order by ${sponsorships.endsOn}, ${sponsorships.id} limit ${limit})`;
    const rows = await this.db
      .select()
      .from(sponsorships)
      .where(inArray(sponsorships.id, unsettled))
      .orderBy(asc(sponsorships.endsOn), asc(sponsorships.id));
    return rows.map(recordOf);
  }

  private async readPage(
    condition: SQL | undefined,
    page: SponsorshipPageInput,
  ): Promise<SponsorshipPage> {
    const rows = await this.db
      .select()
      .from(sponsorships)
      .where(and(condition, NOT_DELETED, afterCursor(page.after)))
      .orderBy(desc(sponsorships.createdAt), desc(sponsorships.id))
      .limit(page.first + 1);
    const pageRows = rows.slice(0, page.first);
    const last = pageRows.at(-1);
    return {
      records: pageRows.map(recordOf),
      hasNextPage: rows.length > page.first,
      endCursor: last === undefined ? null : encodeCursor(last),
    };
  }
}
