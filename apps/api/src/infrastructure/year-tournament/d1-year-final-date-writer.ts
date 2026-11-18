import { eq, gt, isNull, type SQL, sql } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { yearTournaments } from '../../../db/schema/tournament/year-tournaments.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { YearSchedule } from '../../../lib/core/year-tournament/year-schedule.ts';
import type {
  YearFinalDateSave,
  YearFinalDateWriter,
} from '../../application/year-tournament/ports.ts';
import {
  buildAuditLogStatements,
  isAuditGuardRejection,
} from '../admin/audit-log-statements.ts';

type SaveResult = Awaited<ReturnType<YearFinalDateWriter['save']>>;

function scheduleColumnsOf(schedule: YearSchedule) {
  return {
    finalDate: schedule.finalDate,
    deadlineDate: schedule.deadlineDate,
    acceptUntil: schedule.acceptUntil,
    deadlineAt: schedule.deadlineAt,
    drawAt: schedule.drawAt,
    changeLockAt: schedule.changeLockAt,
  };
}

// 行の無い年は版0として比べる。年の値は定数で渡し、外側の文の行と取り違えないようにする
function yearVersionIs(year: number, version: number): SQL {
  return sql`COALESCE((SELECT ${yearTournaments.finalDateVersion} FROM ${yearTournaments} WHERE ${yearTournaments.year} = ${year}), 0) = ${version}`;
}

// 年の行が読み取った版のままで、凍結しておらず、変更前の変更期限より前であり、
// 64週の間隔の検証に使った前年と翌年の版も読み取ったままであること。
// 監査ログの条件は書き込みの時点で評価され、偽なら行の用意と決勝日の更新も含めて一括の書き込み全体が取り消される
function stillChangeable(input: YearFinalDateSave): SQL {
  const { year } = input.schedule;
  return sql.join(
    [
      eq(yearTournaments.year, year),
      eq(yearTournaments.finalDateVersion, input.expectedVersion),
      isNull(yearTournaments.drawStartedAt),
      gt(yearTournaments.changeLockAt, input.now),
      yearVersionIs(year - 1, input.previousYearVersion),
      yearVersionIs(year + 1, input.nextYearVersion),
    ],
    sql` AND `,
  );
}

const rowExists = (condition: SQL): SQL =>
  sql`EXISTS (SELECT 1 FROM ${yearTournaments} WHERE ${condition})`;

@injectable()
export class D1YearFinalDateWriter implements YearFinalDateWriter {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async save(input: YearFinalDateSave): Promise<SaveResult> {
    const { schedule, defaultSchedule, now } = input;
    if (schedule.year !== defaultSchedule.year) {
      throw new RangeError(
        `日程の対象年(${String(schedule.year)}年)が既定の日程の対象年(${String(defaultSchedule.year)}年)と食い違っています`,
      );
    }
    const changeable = stillChangeable(input);
    try {
      // 監査ログの条件が年の行を見るため、行の用意を先頭に置く
      await this.db.batch([
        this.db
          .insert(yearTournaments)
          .values({
            id: input.yearTournamentId,
            year: defaultSchedule.year,
            ...scheduleColumnsOf(defaultSchedule),
            finalDateSource: 'default',
            finalDateVersion: 0,
            status: 'open',
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing({ target: yearTournaments.year }),
        ...buildAuditLogStatements(this.db, input.audit, {
          kind: 'condition',
          condition: rowExists(changeable),
        }),
        this.db
          .update(yearTournaments)
          .set({
            ...scheduleColumnsOf(schedule),
            finalDateSource: 'explicit',
            finalDateVersion: sql`${yearTournaments.finalDateVersion} + 1`,
            finalDateUpdatedAt: now,
            finalDateUpdatedByAdminId: input.adminId,
            updatedAt: now,
          })
          .where(changeable),
      ]);
      return 'saved';
    } catch (error) {
      if (isAuditGuardRejection(error)) {
        return this.rejectionOf(input);
      }
      throw error;
    }
  }

  // 取り消された後の行を読み直し、凍結済みか変更期限以降なら自分の年と隣の年の版に関わらずlockedにする
  private async rejectionOf({
    schedule,
    defaultSchedule,
    now,
  }: YearFinalDateSave): Promise<SaveResult> {
    const [row] = await this.db
      .select({
        changeLockAt: yearTournaments.changeLockAt,
        drawStartedAt: yearTournaments.drawStartedAt,
      })
      .from(yearTournaments)
      .where(eq(yearTournaments.year, schedule.year));
    const { changeLockAt, drawStartedAt } = row ?? {
      changeLockAt: defaultSchedule.changeLockAt,
      drawStartedAt: null,
    };
    return drawStartedAt !== null || changeLockAt.getTime() <= now.getTime()
      ? 'locked'
      : 'version_conflict';
  }
}
