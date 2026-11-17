import {
  and,
  asc,
  gt,
  inArray,
  isNotNull,
  lt,
  min,
  type SQL,
  sql,
} from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { yearTournamentEntries } from '../../../db/schema/tournament/year-tournament-entries.ts';
import { yearTournaments } from '../../../db/schema/tournament/year-tournaments.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import {
  type BusinessDate,
  parseBusinessDate,
} from '../../core/time/business-time.ts';
import type {
  NewYearEntry,
  YearEntryRecord,
  YearEntryStore,
} from '../../core/year-tournament/ports.ts';
import { OPEN_ENTRY_STATUSES } from '../../core/year-tournament/year-entry-rules.ts';

// D1のバインド変数の上限(100)から、IDの一覧以外に使う変数の分を残す
const IDS_PER_STATEMENT = 90;

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

@injectable()
export class D1YearEntryStore implements Pick<
  YearEntryStore,
  | 'insertFromChampion'
  | 'findByWeekTournaments'
  | 'findByLaunches'
  | 'listCandidates'
> {
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
    deadlineDate: BusinessDate,
    afterEntryId: string | undefined,
    limit: number,
  ): Promise<readonly YearEntryRecord[]> {
    const rows = await this.db
      .select(ENTRY_COLUMNS)
      .from(yearTournamentEntries)
      .where(
        and(
          inArray(yearTournamentEntries.status, OPEN_ENTRY_STATUSES),
          lt(yearTournamentEntries.awardedDate, deadlineDate),
          afterEntryId === undefined
            ? undefined
            : gt(yearTournamentEntries.id, afterEntryId),
        ),
      )
      .orderBy(asc(yearTournamentEntries.id))
      .limit(limit);
    return rows.map(entryRecordOf);
  }
}
