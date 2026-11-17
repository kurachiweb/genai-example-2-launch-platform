import {
  and,
  asc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  lt,
  min,
  ne,
  notExists,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { yearTournamentEntries } from '../../../db/schema/tournament/year-tournament-entries.ts';
import { yearTournaments } from '../../../db/schema/tournament/year-tournaments.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import { parseBusinessDate } from '../../core/time/business-time.ts';
import type {
  NewYearEntry,
  YearCandidateRange,
  YearEntryClassification,
  YearEntryRecord,
  YearEntryStore,
  YearRefundClosedStatus,
} from '../../core/year-tournament/ports.ts';
import {
  GRANTABLE_STATUSES,
  OPEN_ENTRY_STATUSES,
} from '../../core/year-tournament/year-entry-rules.ts';

// D1のバインド変数の上限(100)から、IDの一覧以外に使う変数の分を残す
const IDS_PER_STATEMENT = 90;

// 分類の書き込みを、ブラケットの書き込みと同じ50件ずつの一括にそろえる
const CLASSIFICATIONS_PER_BATCH = 50;

// 決済の無い枠は返金の依頼が要らないため、返金の再処理の対象にしない
const REFUND_ON_CLOSE = sql<
  'pending' | 'not_needed'
>`case when ${yearTournamentEntries.purchaseId} is not null then 'pending' else 'not_needed' end`;

const PENDING_FOLLOW_UP = or(
  eq(yearTournamentEntries.refundStatus, 'pending'),
  eq(yearTournamentEntries.refundNoticeStatus, 'pending'),
);

type EntryInsertRow = typeof yearTournamentEntries.$inferInsert;

type EntryInsertColumn = keyof EntryInsertRow;

// 値を列の形式(日時はエポックミリ秒)へ変換したバインド変数にする
function paramOf<Key extends EntryInsertColumn>(
  key: Key,
  value: EntryInsertRow[Key],
): SQL {
  return sql`${sql.param(value, yearTournamentEntries[key])}`;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

function batchOf(
  statements: readonly BatchItem<'sqlite'>[],
): [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] | undefined {
  const [first, ...rest] = statements;
  return first === undefined ? undefined : [first, ...rest];
}

const ENTRY_COLUMNS = {
  entryId: yearTournamentEntries.id,
  weekTournamentId: yearTournamentEntries.weekTournamentId,
  weekPeriod: yearTournamentEntries.weekPeriod,
  launchId: yearTournamentEntries.launchId,
  productId: yearTournamentEntries.productId,
  ownerUserId: yearTournamentEntries.ownerUserId,
  launchDate: yearTournamentEntries.launchDate,
  qualifierUpvoteCount: yearTournamentEntries.qualifierUpvoteCount,
  qualifierLastUpvoteElapsedMs:
    yearTournamentEntries.qualifierLastUpvoteElapsedMs,
  awardedAt: yearTournamentEntries.awardedAt,
  awardedDate: yearTournamentEntries.awardedDate,
  status: yearTournamentEntries.status,
  entitlementSource: yearTournamentEntries.entitlementSource,
  purchaseId: yearTournamentEntries.purchaseId,
  closeReason: yearTournamentEntries.closeReason,
  classifiedYear: yearTournamentEntries.classifiedYear,
  refundStatus: yearTournamentEntries.refundStatus,
  refundNoticeStatus: yearTournamentEntries.refundNoticeStatus,
};

type EntryRow = Omit<YearEntryRecord, 'launchDate' | 'awardedDate'> & {
  readonly launchDate: string;
  readonly awardedDate: string;
};

function entryRecordOf({
  launchDate,
  awardedDate,
  ...row
}: EntryRow): YearEntryRecord {
  return {
    ...row,
    launchDate: parseBusinessDate(launchDate),
    awardedDate: parseBusinessDate(awardedDate),
  };
}

// 枠は対象年を持たないため、決済期限日がWeek優勝の日より後の凍結済みの年があれば、その年の枠として凍結の対象にする。
// 枠の表を更新する文の条件に使う(相関の副問い合わせ)
export function yearEntryNotFrozen(db: Database): SQL {
  return notExists(
    db
      .select({ one: sql`1` })
      .from(yearTournaments)
      .where(
        and(
          isNotNull(yearTournaments.drawStartedAt),
          gt(yearTournaments.deadlineDate, yearTournamentEntries.awardedDate),
        ),
      ),
  );
}

@injectable()
export class D1YearEntryStore implements YearEntryStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  // 同じWeek優勝の知らせや再処理が重なっても枠が1つにそろうよう、Week優勝とローンチの一意索引で重複を無視する。
  // 対象年の判定の後に凍結されても資格を与えないよう、凍結済みの年の有無を読み取りでなく挿入の文に含める
  async insertFromChampion(
    { entryId, initialStatus, ...entry }: NewYearEntry,
    at: Date,
  ): Promise<'inserted' | 'late' | 'exists'> {
    const late = this.db
      .select({
        lateYear: sql<number | null>`${min(yearTournaments.year)}`.as(
          'late_year',
        ),
      })
      .from(yearTournaments)
      .where(
        and(
          isNotNull(yearTournaments.drawStartedAt),
          gt(yearTournaments.deadlineDate, entry.awardedDate),
        ),
      )
      .as('late');
    const isLate = sql`${late.lateYear} is not null`;
    const entitled = initialStatus === 'entitled';
    const constants = {
      ...entry,
      id: entryId,
      createdAt: at,
      updatedAt: at,
    } satisfies Omit<EntryInsertRow, 'status'>;
    const selection = {
      ...Object.fromEntries(
        Object.entries(constants).map(([key, value]) => [
          key,
          paramOf(key as EntryInsertColumn, value).as(key),
        ]),
      ),
      status:
        sql`case when ${isLate} then 'expired' else ${initialStatus} end`.as(
          'status',
        ),
      entitlementSource:
        sql`case when ${isLate} then null else ${entitled ? 'ultras' : null} end`.as(
          'entitlement_source',
        ),
      entitledAt:
        sql`case when ${isLate} then null else ${entitled ? paramOf('entitledAt', at) : null} end`.as(
          'entitled_at',
        ),
      closedAt: sql`case when ${isLate} then ${paramOf('closedAt', at)} end`.as(
        'closed_at',
      ),
      closeReason: sql`case when ${isLate} then 'late_entry' end`.as(
        'close_reason',
      ),
      classifiedYear: sql`${late.lateYear}`.as('classified_year'),
      refundStatus:
        sql`case when ${isLate} then 'not_needed' else 'none' end`.as(
          'refund_status',
        ),
    } as Record<EntryInsertColumn, SQL.Aliased>;
    const rows = await this.db
      .insert(yearTournamentEntries)
      .select(
        this.db
          .select(selection)
          .from(late)
          // INSERT ... SELECTの後のON CONFLICTを結合の条件と解釈させないため、SELECTにWHEREを付ける(SQLiteの構文の制約)
          .where(sql`true`),
      )
      .onConflictDoNothing()
      .returning({ status: yearTournamentEntries.status });
    const [row] = rows;
    if (row === undefined) {
      return 'exists';
    }
    return row.status === 'expired' ? 'late' : 'inserted';
  }

  async findByWeekTournaments(
    ids: readonly string[],
  ): Promise<ReadonlySet<string>> {
    const pages = await Promise.all(
      chunk([...new Set(ids)], IDS_PER_STATEMENT).map((page) =>
        this.db
          .select({ weekTournamentId: yearTournamentEntries.weekTournamentId })
          .from(yearTournamentEntries)
          .where(inArray(yearTournamentEntries.weekTournamentId, page)),
      ),
    );
    return new Set(
      pages.flat().map(({ weekTournamentId }) => weekTournamentId),
    );
  }

  async findByLaunches(
    launchIds: readonly string[],
  ): Promise<ReadonlyMap<string, YearEntryRecord>> {
    const pages = await Promise.all(
      chunk([...new Set(launchIds)], IDS_PER_STATEMENT).map((page) =>
        this.db
          .select(ENTRY_COLUMNS)
          .from(yearTournamentEntries)
          .where(inArray(yearTournamentEntries.launchId, page)),
      ),
    );
    return new Map(
      pages.flat().flatMap((row) => {
        const record = entryRecordOf(row);
        return record.launchId === null ? [] : [[record.launchId, record]];
      }),
    );
  }

  async listCandidates(
    { awardedFrom, awardedBefore }: YearCandidateRange,
    afterEntryId: string | undefined,
    limit: number,
  ): Promise<readonly YearEntryRecord[]> {
    const rows = await this.db
      .select(ENTRY_COLUMNS)
      .from(yearTournamentEntries)
      .where(
        and(
          inArray(yearTournamentEntries.status, OPEN_ENTRY_STATUSES),
          awardedFrom === null
            ? undefined
            : gte(yearTournamentEntries.awardedDate, awardedFrom),
          lt(yearTournamentEntries.awardedDate, awardedBefore),
          afterEntryId === undefined
            ? undefined
            : gt(yearTournamentEntries.id, afterEntryId),
        ),
      )
      .orderBy(asc(yearTournamentEntries.id))
      .limit(limit);
    return rows.map(entryRecordOf);
  }

  async findEntry(entryId: string): Promise<YearEntryRecord | undefined> {
    const [row] = await this.db
      .select(ENTRY_COLUMNS)
      .from(yearTournamentEntries)
      .where(eq(yearTournamentEntries.id, entryId));
    return row === undefined ? undefined : entryRecordOf(row);
  }

  // 加入の知らせの処理が対象年ごとに期間を判定するため、凍結済みの年の枠も返す
  async listOpenByOwner(userId: string): Promise<readonly YearEntryRecord[]> {
    const rows = await this.db
      .select(ENTRY_COLUMNS)
      .from(yearTournamentEntries)
      .where(
        and(
          eq(yearTournamentEntries.ownerUserId, userId),
          inArray(yearTournamentEntries.status, OPEN_ENTRY_STATUSES),
        ),
      )
      .orderBy(asc(yearTournamentEntries.id));
    return rows.map(entryRecordOf);
  }

  async listLaunchIdsByProduct(productId: string): Promise<readonly string[]> {
    const rows = await this.db
      .selectDistinct({ launchId: yearTournamentEntries.launchId })
      .from(yearTournamentEntries)
      .where(
        and(
          eq(yearTournamentEntries.productId, productId),
          isNotNull(yearTournamentEntries.launchId),
        ),
      )
      .orderBy(asc(yearTournamentEntries.launchId));
    return rows.flatMap(({ launchId }) =>
      launchId === null ? [] : [launchId],
    );
  }

  // ブラケットは凍結後の同じ候補で作り直すため、紐付けを解除した枠も候補から外さない
  async listDrawn(year: number): Promise<readonly YearEntryRecord[]> {
    const rows = await this.db
      .select(ENTRY_COLUMNS)
      .from(yearTournamentEntries)
      .where(
        and(
          eq(yearTournamentEntries.classifiedYear, year),
          eq(yearTournamentEntries.status, 'drawn'),
        ),
      )
      .orderBy(asc(yearTournamentEntries.id));
    return rows.map(entryRecordOf);
  }

  // 凍結と同時の加入の知らせが凍結後の資格を変えないよう、凍結の対象外の条件を読み取りでなく更新の文に含める
  async grantByUltras(
    entryIds: readonly string[],
    at: Date,
  ): Promise<readonly string[]> {
    const granted: string[] = [];
    for (const page of chunk([...new Set(entryIds)], IDS_PER_STATEMENT)) {
      const rows = await this.db
        .update(yearTournamentEntries)
        .set({
          status: 'entitled',
          entitlementSource: 'ultras',
          entitledAt: at,
          updatedAt: at,
        })
        .where(
          and(
            inArray(yearTournamentEntries.id, page),
            inArray(yearTournamentEntries.status, GRANTABLE_STATUSES),
            this.notFrozen(),
          ),
        )
        .returning({ entryId: yearTournamentEntries.id });
      granted.push(...rows.map(({ entryId }) => entryId));
    }
    return granted.toSorted();
  }

  forfeitByProduct(productId: string, at: Date): Promise<readonly string[]> {
    return this.forfeit(
      eq(yearTournamentEntries.productId, productId),
      'deleted',
      at,
    );
  }

  forfeitByOwner(userId: string, at: Date): Promise<readonly string[]> {
    return this.forfeit(
      eq(yearTournamentEntries.ownerUserId, userId),
      'withdrawn',
      at,
    );
  }

  async classify(
    year: number,
    updates: readonly YearEntryClassification[],
    at: Date,
  ): Promise<void> {
    const statements = updates.map((update) =>
      this.classifyStatement(year, update, at),
    );
    for (const part of chunk(statements, CLASSIFICATIONS_PER_BATCH)) {
      const batch = batchOf(part);
      if (batch !== undefined) {
        await this.db.batch(batch);
      }
    }
  }

  // 組み合わせ決定の再実行で除外を重ねないよう、その年の組み合わせの対象の条件を更新の文に含める
  async excludeOverCapacity(
    year: number,
    entryIds: readonly string[],
    at: Date,
  ): Promise<void> {
    for (const page of chunk([...new Set(entryIds)], IDS_PER_STATEMENT)) {
      await this.db
        .update(yearTournamentEntries)
        .set({
          status: 'excluded',
          closeReason: 'over_capacity',
          closedAt: at,
          refundStatus: REFUND_ON_CLOSE,
          updatedAt: at,
        })
        .where(
          and(
            inArray(yearTournamentEntries.id, page),
            eq(yearTournamentEntries.classifiedYear, year),
            eq(yearTournamentEntries.status, 'drawn'),
          ),
        );
    }
  }

  // 処理中の枠を再処理で重ねて扱わないよう、基準の時刻より前に更新した枠だけを返す
  async listPendingFollowUps(
    olderThan: Date,
    limit: number,
  ): Promise<readonly YearEntryRecord[]> {
    const rows = await this.db
      .select(ENTRY_COLUMNS)
      .from(yearTournamentEntries)
      .where(
        and(PENDING_FOLLOW_UP, lt(yearTournamentEntries.updatedAt, olderThan)),
      )
      .orderBy(
        asc(yearTournamentEntries.updatedAt),
        asc(yearTournamentEntries.id),
      )
      .limit(limit);
    return rows.map(entryRecordOf);
  }

  // 重複の処理で返金の知らせを送り直さないよう、返金待ちの条件を更新の文に含める
  async markRefundRequested(entryId: string, at: Date): Promise<void> {
    await this.db
      .update(yearTournamentEntries)
      .set({
        refundStatus: 'requested',
        refundRequestedAt: at,
        refundNoticeStatus: 'pending',
        updatedAt: at,
      })
      .where(
        and(
          eq(yearTournamentEntries.id, entryId),
          eq(yearTournamentEntries.refundStatus, 'pending'),
        ),
      );
  }

  async markRefundClosed(
    entryId: string,
    status: YearRefundClosedStatus,
    at: Date,
  ): Promise<void> {
    await this.db
      .update(yearTournamentEntries)
      .set({ refundStatus: status, updatedAt: at })
      .where(
        and(
          eq(yearTournamentEntries.id, entryId),
          eq(yearTournamentEntries.refundStatus, 'pending'),
        ),
      );
  }

  async markNotice(
    entryId: string,
    status: 'sent' | 'skipped',
    at: Date,
  ): Promise<void> {
    await this.db
      .update(yearTournamentEntries)
      .set({ refundNoticeStatus: status, updatedAt: at })
      .where(
        and(
          eq(yearTournamentEntries.id, entryId),
          eq(yearTournamentEntries.refundNoticeStatus, 'pending'),
        ),
      );
  }

  // ブラケットの参加者と年の優勝が組み合わせに入った枠を参照し続けるため、その枠は残す。
  // 投稿者の列も外部キーのため、解除しないと利用者の物理削除が失敗する
  async unlinkOrDeleteByProduct(
    productId: string,
  ): Promise<{ readonly unlinked: number; readonly deleted: number }> {
    const ofProduct = eq(yearTournamentEntries.productId, productId);
    const [unlinked, deleted] = await this.db.batch([
      this.db
        .update(yearTournamentEntries)
        .set({ launchId: null, productId: null, ownerUserId: null })
        .where(and(ofProduct, eq(yearTournamentEntries.status, 'drawn'))),
      this.db
        .delete(yearTournamentEntries)
        .where(and(ofProduct, ne(yearTournamentEntries.status, 'drawn'))),
    ]);
    return {
      unlinked: unlinked.meta.changes,
      deleted: deleted.meta.changes,
    };
  }

  // 決済で得た資格の出どころと日時は、組み合わせ決定の時点のUltrasの判定で書き換えない
  private classifyStatement(
    year: number,
    {
      entryId,
      status,
      closeReason,
      entitlementSource,
    }: YearEntryClassification,
    at: Date,
  ) {
    return this.db
      .update(yearTournamentEntries)
      .set({
        status,
        closeReason,
        ...(entitlementSource === undefined
          ? {}
          : {
              entitlementSource: sql`coalesce(${yearTournamentEntries.entitlementSource}, ${entitlementSource})`,
              entitledAt: sql`coalesce(${yearTournamentEntries.entitledAt}, ${at.getTime()})`,
            }),
        closedAt: at,
        classifiedYear: year,
        ...(status === 'forfeited' || status === 'excluded'
          ? { refundStatus: REFUND_ON_CLOSE }
          : {}),
        updatedAt: at,
      })
      .where(
        and(
          eq(yearTournamentEntries.id, entryId),
          inArray(yearTournamentEntries.status, OPEN_ENTRY_STATUSES),
        ),
      );
  }

  // 凍結と同時の削除・退会が凍結後の資格を変えないよう、凍結の対象外の条件を読み取りでなく更新の文に含める
  private async forfeit(
    target: SQL,
    reason: 'deleted' | 'withdrawn',
    at: Date,
  ): Promise<readonly string[]> {
    const rows = await this.db
      .update(yearTournamentEntries)
      .set({
        status: 'forfeited',
        closeReason: reason,
        closedAt: at,
        refundStatus: REFUND_ON_CLOSE,
        updatedAt: at,
      })
      .where(
        and(
          target,
          inArray(yearTournamentEntries.status, OPEN_ENTRY_STATUSES),
          this.notFrozen(),
        ),
      )
      .returning({ entryId: yearTournamentEntries.id });
    return rows.map(({ entryId }) => entryId).toSorted();
  }

  private notFrozen(): SQL {
    return yearEntryNotFrozen(this.db);
  }
}
