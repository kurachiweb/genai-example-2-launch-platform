import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  max,
  ne,
  type SQL,
} from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import { chunk, IDS_PER_STATEMENT } from '../../core/d1/statement-chunks.ts';
import type { Database } from '../../../db/client.ts';
import { yearTournamentEntries } from '../../../db/schema/tournament/year-tournament-entries.ts';
import { yearTournaments } from '../../../db/schema/tournament/year-tournaments.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import {
  type BusinessDate,
  parseBusinessDate,
} from '../../core/time/business-time.ts';
import type {
  YearAwardedProduct,
  YearDrawRecord,
  YearProductAward,
  YearTournamentFinish,
  YearTournamentRecord,
  YearTournamentStore,
} from '../../core/year-tournament/ports.ts';
import type { YearSchedule } from '../../core/year-tournament/year-schedule.ts';

const DRAWABLE_STATUSES = ['open', 'drawing'] as const;

// 受賞の照会が優勝の枠を引けなくならないよう、受賞と優勝の枠の有無の食い違いを書き込む前に止める
function finishColumns(
  outcome: YearTournamentFinish['outcome'],
  championEntryId: string | null,
  at: Date,
) {
  if ((outcome === 'awarded') !== (championEntryId !== null)) {
    throw new RangeError(
      `受賞の結果と優勝の枠が食い違っています: ${outcome}, ${String(championEntryId)}`,
    );
  }
  return {
    status: 'finished',
    outcome,
    championEntryId,
    awardedAt: outcome === 'awarded' ? at : null,
    finishedAt: at,
  } as const;
}

const TOURNAMENT_COLUMNS = {
  yearTournamentId: yearTournaments.id,
  year: yearTournaments.year,
  finalDate: yearTournaments.finalDate,
  deadlineDate: yearTournaments.deadlineDate,
  acceptUntil: yearTournaments.acceptUntil,
  deadlineAt: yearTournaments.deadlineAt,
  drawAt: yearTournaments.drawAt,
  changeLockAt: yearTournaments.changeLockAt,
  source: yearTournaments.finalDateSource,
  version: yearTournaments.finalDateVersion,
  updatedAt: yearTournaments.finalDateUpdatedAt,
  updatedByAdminId: yearTournaments.finalDateUpdatedByAdminId,
  status: yearTournaments.status,
  drawStartedAt: yearTournaments.drawStartedAt,
  bracketId: yearTournaments.bracketId,
  firstRoundDate: yearTournaments.firstRoundDate,
  participantCount: yearTournaments.participantCount,
  outcome: yearTournaments.outcome,
  championEntryId: yearTournaments.championEntryId,
  awardedAt: yearTournaments.awardedAt,
};

type TournamentRow = Omit<
  YearTournamentRecord,
  'schedule' | 'firstRoundDate'
> & {
  readonly finalDate: string;
  readonly deadlineDate: string;
  readonly acceptUntil: Date;
  readonly deadlineAt: Date;
  readonly drawAt: Date;
  readonly changeLockAt: Date;
  readonly firstRoundDate: string | null;
};

function tournamentRecordOf({
  finalDate,
  deadlineDate,
  acceptUntil,
  deadlineAt,
  drawAt,
  changeLockAt,
  firstRoundDate,
  ...row
}: TournamentRow): YearTournamentRecord {
  return {
    ...row,
    schedule: {
      year: row.year,
      finalDate: parseBusinessDate(finalDate),
      deadlineDate: parseBusinessDate(deadlineDate),
      acceptUntil,
      deadlineAt,
      drawAt,
      changeLockAt,
    },
    firstRoundDate:
      firstRoundDate === null ? null : parseBusinessDate(firstRoundDate),
  };
}

@injectable()
export class D1YearTournamentStore implements YearTournamentStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  // 同時の用意でも行が1つにそろうよう、年の一意索引で重複を無視し、保存した行を読み直す。
  // 決勝日を保存済みの年を既定の日で上書きしないよう、既存の行は変えない
  async ensureYear(
    year: number,
    schedule: YearSchedule,
    at: Date,
  ): Promise<YearTournamentRecord> {
    if (schedule.year !== year) {
      throw new RangeError(
        `日程の対象年(${String(schedule.year)}年)が年(${String(year)}年)と食い違っています`,
      );
    }
    await this.db
      .insert(yearTournaments)
      .values({
        year,
        finalDate: schedule.finalDate,
        finalDateSource: 'default',
        finalDateVersion: 0,
        deadlineDate: schedule.deadlineDate,
        acceptUntil: schedule.acceptUntil,
        deadlineAt: schedule.deadlineAt,
        drawAt: schedule.drawAt,
        changeLockAt: schedule.changeLockAt,
        status: 'open',
        createdAt: at,
        updatedAt: at,
      })
      .onConflictDoNothing();
    const [record] = await this.selectTournaments(
      eq(yearTournaments.year, year),
    );
    if (record === undefined) {
      throw new Error(
        `年のトーナメントを記録できませんでした: ${String(year)}`,
      );
    }
    return record;
  }

  async findByYears(
    years: readonly number[],
  ): Promise<ReadonlyMap<number, YearTournamentRecord>> {
    const pages = await Promise.all(
      chunk([...new Set(years)], IDS_PER_STATEMENT).map(async (page) =>
        this.selectTournaments(inArray(yearTournaments.year, page)),
      ),
    );
    return new Map(pages.flat().map((record) => [record.year, record]));
  }

  async findById(
    yearTournamentId: string,
  ): Promise<YearTournamentRecord | undefined> {
    const [record] = await this.selectTournaments(
      eq(yearTournaments.id, yearTournamentId),
    );
    return record;
  }

  listDue(now: Date, limit: number): Promise<readonly YearTournamentRecord[]> {
    return this.selectTournaments(
      and(
        inArray(yearTournaments.status, DRAWABLE_STATUSES),
        lte(yearTournaments.drawAt, now),
      ),
      [asc(yearTournaments.year)],
      limit,
    );
  }

  listInProgress(limit: number): Promise<readonly YearTournamentRecord[]> {
    return this.selectTournaments(
      eq(yearTournaments.status, 'in_progress'),
      [asc(yearTournaments.year)],
      limit,
    );
  }

  async latestFrozenDeadlineDate(): Promise<BusinessDate | null> {
    const [row] = await this.db
      .select({ deadlineDate: max(yearTournaments.deadlineDate) })
      .from(yearTournaments)
      .where(isNotNull(yearTournaments.drawStartedAt));
    const deadlineDate = row?.deadlineDate ?? null;
    return deadlineDate === null ? null : parseBusinessDate(deadlineDate);
  }

  // 凍結の後は資格を変える書き込みが条件の不一致で何もしなくなるため、凍結前の条件を更新の文に含めて凍結を1回にする
  async freeze(
    yearTournamentId: string,
    at: Date,
  ): Promise<'frozen' | 'already'> {
    const rows = await this.db
      .update(yearTournaments)
      .set({ status: 'drawing', drawStartedAt: at, updatedAt: at })
      .where(
        and(
          eq(yearTournaments.id, yearTournamentId),
          isNull(yearTournaments.drawStartedAt),
        ),
      )
      .returning({ yearTournamentId: yearTournaments.id });
    return rows.length > 0 ? 'frozen' : 'already';
  }

  // 回復で呼び直しても記録済みのブラケットと結果を書き換えないよう、組み合わせ決定中の条件を更新の文に含める
  async markDrawn(
    yearTournamentId: string,
    { bracketId, firstRoundDate, participantCount, finished }: YearDrawRecord,
    at: Date,
  ): Promise<void> {
    await this.db
      .update(yearTournaments)
      .set({
        bracketId,
        firstRoundDate,
        participantCount,
        drawnAt: at,
        ...(finished === null
          ? { status: 'in_progress' }
          : finishColumns(finished.outcome, finished.championEntryId, at)),
        updatedAt: at,
      })
      .where(
        and(
          eq(yearTournaments.id, yearTournamentId),
          eq(yearTournaments.status, 'drawing'),
        ),
      );
  }

  // イベントの処理と23:45のジョブが同時に終了を確定させても受賞が1回になるよう、終了していない条件を更新の文に含める
  async recordFinish(
    yearTournamentId: string,
    outcome: YearTournamentFinish['outcome'],
    championEntryId: string | null,
    at: Date,
  ): Promise<boolean> {
    const rows = await this.db
      .update(yearTournaments)
      .set({ ...finishColumns(outcome, championEntryId, at), updatedAt: at })
      .where(
        and(
          eq(yearTournaments.id, yearTournamentId),
          ne(yearTournaments.status, 'finished'),
        ),
      )
      .returning({ yearTournamentId: yearTournaments.id });
    return rows.length > 0;
  }

  async listAwardedBetween(
    from: Date,
    to: Date,
  ): Promise<readonly YearAwardedProduct[]> {
    const rows = await this.db
      .select({
        yearTournamentId: yearTournaments.id,
        year: yearTournaments.year,
        productId: yearTournamentEntries.productId,
      })
      .from(yearTournaments)
      .innerJoin(
        yearTournamentEntries,
        eq(yearTournamentEntries.id, yearTournaments.championEntryId),
      )
      .where(
        and(
          eq(yearTournaments.outcome, 'awarded'),
          gte(yearTournaments.awardedAt, from),
          lt(yearTournaments.awardedAt, to),
          isNotNull(yearTournamentEntries.productId),
        ),
      )
      .orderBy(asc(yearTournaments.awardedAt), asc(yearTournaments.year));
    return rows.flatMap(({ productId, ...row }) =>
      productId === null ? [] : [{ ...row, productId }],
    );
  }

  async listAwardsByProducts(
    productIds: readonly string[],
  ): Promise<readonly YearProductAward[]> {
    const pages = await Promise.all(
      chunk([...new Set(productIds)], IDS_PER_STATEMENT).map((page) =>
        this.db
          .select({
            productId: yearTournamentEntries.productId,
            launchId: yearTournamentEntries.launchId,
            year: yearTournaments.year,
            awardedAt: yearTournaments.awardedAt,
          })
          .from(yearTournaments)
          .innerJoin(
            yearTournamentEntries,
            eq(yearTournamentEntries.id, yearTournaments.championEntryId),
          )
          .where(
            and(
              eq(yearTournaments.outcome, 'awarded'),
              inArray(yearTournamentEntries.productId, page),
            ),
          ),
      ),
    );
    return pages
      .flat()
      .flatMap(({ productId, launchId, year, awardedAt }) =>
        productId === null || launchId === null || awardedAt === null
          ? []
          : [{ productId, launchId, year, awardedAt }],
      )
      .toSorted(
        (left, right) =>
          left.awardedAt.getTime() - right.awardedAt.getTime() ||
          left.year - right.year,
      );
  }

  private async selectTournaments(
    condition: SQL | undefined,
    order: readonly SQL[] = [],
    limit?: number,
  ): Promise<YearTournamentRecord[]> {
    const query = this.db
      .select(TOURNAMENT_COLUMNS)
      .from(yearTournaments)
      .where(condition)
      .orderBy(...order);
    const rows = await (limit === undefined ? query : query.limit(limit));
    return rows.map(tournamentRecordOf);
  }
}
