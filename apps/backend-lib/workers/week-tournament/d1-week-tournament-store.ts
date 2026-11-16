import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { weekTournamentEntries } from '../../../db/schema/tournament/week-tournament-entries.ts';
import { weekTournaments } from '../../../db/schema/tournament/week-tournaments.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import {
  type BusinessDate,
  parseBusinessDate,
} from '../../core/time/business-time.ts';
import type {
  NewWeekEntry,
  WeekEntryClassification,
  WeekEntryRecord,
  WeekTournamentRecord,
  WeekTournamentStore,
} from '../../core/week-tournament/ports.ts';
import { GRANTABLE_STATUSES } from '../../core/week-tournament/week-entry-rules.ts';
import { entryWindowFor } from '../../core/week-tournament/week-schedule.ts';

// D1のバインド変数の上限(100)から、IDの一覧以外に使う変数の分を残す
const IDS_PER_STATEMENT = 90;

const DRAWABLE_STATUSES = ['open', 'drawing'] as const;

// 喪失と分類の対象になる、組み合わせ決定の前の状態
const OPEN_ENTRY_STATUSES = ['awaiting_payment', 'entitled'] as const;

// 分類の書き込みを、ブラケットの書き込みと同じ50件ずつの一括にそろえる
const CLASSIFICATIONS_PER_BATCH = 50;

// 決済の無い枠は返金の依頼が要らないため、返金の再処理の対象にしない
const REFUND_ON_CLOSE = sql<
  'pending' | 'not_needed'
>`case when ${weekTournamentEntries.purchaseId} is not null then 'pending' else 'not_needed' end`;

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

const TOURNAMENT_COLUMNS = {
  tournamentId: weekTournaments.id,
  weekStart: weekTournaments.weekStart,
  acceptUntil: weekTournaments.acceptUntil,
  deadlineAt: weekTournaments.deadlineAt,
  drawAt: weekTournaments.drawAt,
  status: weekTournaments.status,
  drawStartedAt: weekTournaments.drawStartedAt,
  bracketId: weekTournaments.bracketId,
  outcome: weekTournaments.outcome,
  championEntryId: weekTournaments.championEntryId,
  awardedAt: weekTournaments.awardedAt,
};

const ENTRY_COLUMNS = {
  entryId: weekTournamentEntries.id,
  tournamentId: weekTournamentEntries.tournamentId,
  launchId: weekTournamentEntries.launchId,
  productId: weekTournamentEntries.productId,
  ownerUserId: weekTournamentEntries.ownerUserId,
  launchDate: weekTournamentEntries.launchDate,
  qualifierUpvoteCount: weekTournamentEntries.qualifierUpvoteCount,
  qualifierLastUpvoteElapsedMs:
    weekTournamentEntries.qualifierLastUpvoteElapsedMs,
  wonAt: weekTournamentEntries.wonAt,
  status: weekTournamentEntries.status,
  entitlementSource: weekTournamentEntries.entitlementSource,
  purchaseId: weekTournamentEntries.purchaseId,
  closeReason: weekTournamentEntries.closeReason,
  refundStatus: weekTournamentEntries.refundStatus,
  refundNoticeStatus: weekTournamentEntries.refundNoticeStatus,
};

type TournamentRow = Omit<WeekTournamentRecord, 'window'> & {
  readonly weekStart: string;
  readonly acceptUntil: Date;
  readonly deadlineAt: Date;
  readonly drawAt: Date;
};

type EntryRow = Omit<WeekEntryRecord, 'launchDate'> & {
  readonly launchDate: string;
};

function tournamentRecordOf({
  weekStart,
  acceptUntil,
  deadlineAt,
  drawAt,
  ...row
}: TournamentRow): WeekTournamentRecord {
  return {
    ...row,
    window: {
      weekStart: parseBusinessDate(weekStart),
      acceptUntil,
      deadlineAt,
      drawAt,
    },
  };
}

function entryRecordOf({ launchDate, ...row }: EntryRow): WeekEntryRecord {
  return { ...row, launchDate: parseBusinessDate(launchDate) };
}

@injectable()
export class D1WeekTournamentStore implements WeekTournamentStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  // 同時の作成でも行が1つにそろうよう、週の初日の一意索引で重複を無視し、保存した行を読み直す
  async ensureTournament(
    weekStart: BusinessDate,
    at: Date,
  ): Promise<WeekTournamentRecord> {
    const window = entryWindowFor(weekStart);
    await this.db
      .insert(weekTournaments)
      .values({
        weekStart: window.weekStart,
        acceptUntil: window.acceptUntil,
        deadlineAt: window.deadlineAt,
        drawAt: window.drawAt,
        status: 'open',
        createdAt: at,
        updatedAt: at,
      })
      .onConflictDoNothing();
    const record = await this.findTournamentByWeek(weekStart);
    if (record === undefined) {
      throw new Error(`週のトーナメントを記録できませんでした: ${weekStart}`);
    }
    return record;
  }

  async findTournament(
    tournamentId: string,
  ): Promise<WeekTournamentRecord | undefined> {
    const [record] = await this.selectTournaments(
      eq(weekTournaments.id, tournamentId),
    );
    return record;
  }

  async findTournamentByWeek(
    weekStart: BusinessDate,
  ): Promise<WeekTournamentRecord | undefined> {
    const [record] = await this.selectTournaments(
      eq(weekTournaments.weekStart, weekStart),
    );
    return record;
  }

  listDue(now: Date, limit: number): Promise<readonly WeekTournamentRecord[]> {
    return this.selectTournaments(
      and(
        inArray(weekTournaments.status, DRAWABLE_STATUSES),
        lte(weekTournaments.drawAt, now),
      ),
      [asc(weekTournaments.drawAt), asc(weekTournaments.weekStart)],
      limit,
    );
  }

  listInProgress(limit: number): Promise<readonly WeekTournamentRecord[]> {
    return this.selectTournaments(
      eq(weekTournaments.status, 'in_progress'),
      [asc(weekTournaments.weekStart)],
      limit,
    );
  }

  async findEntriesByLaunch(
    launchIds: readonly string[],
  ): Promise<ReadonlyMap<string, WeekEntryRecord>> {
    const pages = await Promise.all(
      chunk([...new Set(launchIds)], IDS_PER_STATEMENT).map((page) =>
        this.db
          .select(ENTRY_COLUMNS)
          .from(weekTournamentEntries)
          .where(inArray(weekTournamentEntries.launchId, page)),
      ),
    );
    return new Map(
      pages.flat().flatMap((row) => {
        const record = entryRecordOf(row);
        return record.launchId === null ? [] : [[record.launchId, record]];
      }),
    );
  }

  async findEntry(entryId: string): Promise<WeekEntryRecord | undefined> {
    const [row] = await this.db
      .select(ENTRY_COLUMNS)
      .from(weekTournamentEntries)
      .where(eq(weekTournamentEntries.id, entryId));
    return row === undefined ? undefined : entryRecordOf(row);
  }

  // 同じ勝利の知らせが重ねて届いても枠が1つにそろうよう、ローンチと週ごとのプロダクトの一意索引で重複を無視する
  async insertEntry({
    entryId,
    at,
    ...entry
  }: NewWeekEntry): Promise<'inserted' | 'exists'> {
    const result = await this.db
      .insert(weekTournamentEntries)
      .values({
        ...entry,
        id: entryId,
        entitledAt: entry.status === 'entitled' ? at : null,
        closedAt: entry.status === 'expired' ? at : null,
        createdAt: at,
        updatedAt: at,
      })
      .onConflictDoNothing();
    return result.meta.changes > 0 ? 'inserted' : 'exists';
  }

  // 凍結と同時の加入の知らせが凍結後の資格を変えないよう、凍結前の条件と期間の条件を読み取りでなく更新の文に含める
  async grantByUltras(
    userId: string,
    activatedAt: Date,
    at: Date,
  ): Promise<readonly string[]> {
    const rows = await this.db
      .update(weekTournamentEntries)
      .set({
        status: 'entitled',
        entitlementSource: 'ultras',
        entitledAt: at,
        updatedAt: at,
      })
      .where(
        and(
          eq(weekTournamentEntries.ownerUserId, userId),
          inArray(weekTournamentEntries.status, GRANTABLE_STATUSES),
          lte(weekTournamentEntries.wonAt, activatedAt),
          inArray(
            weekTournamentEntries.tournamentId,
            this.unfrozenTournamentIds(
              gte(weekTournaments.deadlineAt, activatedAt),
            ),
          ),
        ),
      )
      .returning({ entryId: weekTournamentEntries.id });
    return rows.map(({ entryId }) => entryId).toSorted();
  }

  forfeitByProduct(
    productId: string,
    reason: 'deleted',
    at: Date,
  ): Promise<readonly string[]> {
    return this.forfeit(
      eq(weekTournamentEntries.productId, productId),
      reason,
      at,
    );
  }

  forfeitByOwner(
    userId: string,
    reason: 'withdrawn',
    at: Date,
  ): Promise<readonly string[]> {
    return this.forfeit(
      eq(weekTournamentEntries.ownerUserId, userId),
      reason,
      at,
    );
  }

  async classify(
    updates: readonly WeekEntryClassification[],
    at: Date,
  ): Promise<void> {
    const statements = updates.map((update) =>
      this.classifyStatement(update, at),
    );
    for (const part of chunk(statements, CLASSIFICATIONS_PER_BATCH)) {
      const batch = batchOf(part);
      if (batch !== undefined) {
        await this.db.batch(batch);
      }
    }
  }

  // 決済で得た資格の出どころと日時は、組み合わせ決定の時点のUltrasの判定で書き換えない
  private classifyStatement(
    {
      entryId,
      status,
      closeReason,
      entitlementSource,
    }: WeekEntryClassification,
    at: Date,
  ) {
    return this.db
      .update(weekTournamentEntries)
      .set({
        status,
        closeReason,
        ...(entitlementSource === undefined
          ? {}
          : {
              entitlementSource: sql`coalesce(${weekTournamentEntries.entitlementSource}, ${entitlementSource})`,
              entitledAt: sql`coalesce(${weekTournamentEntries.entitledAt}, ${at.getTime()})`,
            }),
        ...(status === 'entitled' ? {} : { closedAt: at }),
        ...(status === 'forfeited' || status === 'excluded'
          ? { refundStatus: REFUND_ON_CLOSE }
          : {}),
        updatedAt: at,
      })
      .where(
        and(
          eq(weekTournamentEntries.id, entryId),
          inArray(weekTournamentEntries.status, OPEN_ENTRY_STATUSES),
        ),
      );
  }

  // 凍結と同時の削除・退会が凍結後の資格を変えないよう、凍結前の条件を読み取りでなく更新の文に含める
  private async forfeit(
    target: SQL,
    reason: 'deleted' | 'withdrawn',
    at: Date,
  ): Promise<readonly string[]> {
    const rows = await this.db
      .update(weekTournamentEntries)
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
          inArray(weekTournamentEntries.status, OPEN_ENTRY_STATUSES),
          inArray(
            weekTournamentEntries.tournamentId,
            this.unfrozenTournamentIds(),
          ),
        ),
      )
      .returning({ entryId: weekTournamentEntries.id });
    return rows.map(({ entryId }) => entryId).toSorted();
  }

  private unfrozenTournamentIds(condition?: SQL) {
    return this.db
      .select({ id: weekTournaments.id })
      .from(weekTournaments)
      .where(and(isNull(weekTournaments.drawStartedAt), condition));
  }

  private async selectTournaments(
    condition: SQL | undefined,
    order: readonly SQL[] = [],
    limit?: number,
  ): Promise<WeekTournamentRecord[]> {
    const query = this.db
      .select(TOURNAMENT_COLUMNS)
      .from(weekTournaments)
      .where(condition)
      .orderBy(...order);
    const rows = await (limit === undefined ? query : query.limit(limit));
    return rows.map(tournamentRecordOf);
  }
}
