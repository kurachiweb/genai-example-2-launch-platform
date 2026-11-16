import { and, asc, eq, inArray, lte, type SQL } from 'drizzle-orm';
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
  WeekEntryRecord,
  WeekTournamentRecord,
  WeekTournamentStore,
} from '../../core/week-tournament/ports.ts';
import { entryWindowFor } from '../../core/week-tournament/week-schedule.ts';

// D1のバインド変数の上限(100)から、IDの一覧以外に使う変数の分を残す
const IDS_PER_STATEMENT = 90;

const DRAWABLE_STATUSES = ['open', 'drawing'] as const;

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
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
