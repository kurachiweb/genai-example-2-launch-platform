import { env } from 'cloudflare:workers';
import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { YEAR_FINAL_DATE_UPDATE_ACTION } from '../../../common-lib/admin/audit-actions/tournament-year.ts';
import { createDatabase } from '../../../db/client.ts';
import { adminAuditLogs } from '../../../db/schema/admin/admin-audit-logs.ts';
import { yearTournaments } from '../../../db/schema/tournament/year-tournaments.ts';
import type { PreparedAuditEntry } from '../../../lib/core/admin/audit-log.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import {
  type BusinessDate,
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../../lib/core/time/business-time.ts';
import {
  type YearSchedule,
  yearScheduleFor,
} from '../../../lib/core/year-tournament/year-schedule.ts';
import { D1YearTournamentStore } from '../../../lib/workers/year-tournament/d1-year-tournament-store.ts';
import {
  clearYearTournamentTables,
  defaultScheduleOf,
  insertYearTournaments,
  YEAR,
  YEAR_SCHEDULE,
  type YearTournamentFixture,
  yearTournamentIdOf,
} from '../../../lib/workers/year-tournament/testing/year-tournament-fixtures.ts';
import { YearTournamentCalendar } from '../../../lib/workers/year-tournament/year-calendar.ts';
import { createBatchRecordingD1 } from '../../../test/support/batch-recording-d1.ts';
import {
  createFailingD1,
  FAILING_D1_MESSAGE,
} from '../../../test/support/failing-d1.ts';
import type { YearFinalDateSave } from '../../application/year-tournament/ports.ts';
import {
  adminIdOf,
  auditLogIdOf,
  clearAdminTables,
  createAuditLogRecorder,
  createSequentialAuditLogIds,
  db,
  readAuditLogTargetIds,
} from '../admin/testing/admin-store-fixtures.ts';
import { D1YearFinalDateWriter } from './d1-year-final-date-writer.ts';

// 業務時刻の2026-12-01 12:00。2027年の変更期限より前
const NOW = fromBusinessDateTime(parseBusinessDate('2026-12-01'), {
  hour: 12,
  minute: 0,
});

const LATER = fromBusinessDateTime(parseBusinessDate('2026-12-02'), {
  hour: 12,
  minute: 0,
});

// 2027年の既定の決勝日5/30(日)の変更期限は5/23 0:00(業務時刻)
const EIGHT_DAYS_BEFORE_LAST_MINUTE = fromBusinessDateTime(
  parseBusinessDate('2027-05-22'),
  { hour: 23, minute: 59 },
);
const SEVEN_DAYS_BEFORE_START = fromBusinessDateTime(
  parseBusinessDate('2027-05-23'),
  { hour: 0, minute: 0 },
);

// 決済期限日は5/10(月)で、既定の決勝日の決済期限日5/24(月)より前
const EARLIER_FINAL_DATE = parseBusinessDate('2027-05-16');
const EARLIER_SCHEDULE = yearScheduleFor(YEAR, EARLIER_FINAL_DATE);

const LATER_FINAL_DATE = parseBusinessDate('2027-06-06');
const LATER_SCHEDULE = yearScheduleFor(YEAR, LATER_FINAL_DATE);

const NEW_ROW_ID = yearTournamentIdOf(99);

// 1つのテストの中で準備する監査ログの識別子を1から順に振る
let auditLogIds: IdGenerator = createSequentialAuditLogIds();

function auditOf(
  operator: number,
  toDate: BusinessDate,
  options: {
    readonly fromDate?: BusinessDate;
    readonly fromSource?: 'explicit' | 'default';
    readonly reason?: string;
    readonly occurredAt?: Date;
  } = {},
): PreparedAuditEntry {
  return createAuditLogRecorder({ ids: auditLogIds }).prepare({
    operatorAdminId: adminIdOf(operator),
    action: YEAR_FINAL_DATE_UPDATE_ACTION.name,
    targetIds: [`year-final-date:${String(YEAR)}`],
    ...(options.reason === undefined ? {} : { reason: options.reason }),
    detail: {
      year: String(YEAR),
      fromDate: options.fromDate ?? YEAR_SCHEDULE.finalDate,
      toDate,
      fromSource: options.fromSource ?? 'default',
    },
    occurredAt: options.occurredAt ?? NOW,
  });
}

function saveOf(
  operator: number,
  schedule: YearSchedule,
  expectedVersion: number,
  now: Date,
  audit: PreparedAuditEntry = auditOf(operator, schedule.finalDate, {
    occurredAt: now,
  }),
): YearFinalDateSave {
  return {
    yearTournamentId: NEW_ROW_ID,
    schedule,
    defaultSchedule: defaultScheduleOf(schedule.year),
    expectedVersion,
    previousYearVersion: 0,
    nextYearVersion: 0,
    adminId: adminIdOf(operator),
    audit,
    now,
  };
}

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

async function readYearRows() {
  return db.select().from(yearTournaments).orderBy(asc(yearTournaments.year));
}

async function readYearRow() {
  const [row] = await db
    .select()
    .from(yearTournaments)
    .where(eq(yearTournaments.year, YEAR));
  return row;
}

async function readAuditLogRows() {
  return db
    .select({
      id: adminAuditLogs.id,
      operatorAdminId: adminAuditLogs.operatorAdminId,
      action: adminAuditLogs.action,
      targetKind: adminAuditLogs.targetKind,
      reason: adminAuditLogs.reason,
      detail: adminAuditLogs.detail,
      occurredAt: adminAuditLogs.occurredAt,
    })
    .from(adminAuditLogs)
    .orderBy(asc(adminAuditLogs.id));
}

// Drizzleの失敗はD1のエラーをcauseに持つため、原因をたどって文言を集める
async function failureMessagesOf(write: Promise<unknown>): Promise<string[]> {
  const messages: string[] = [];
  try {
    await write;
  } catch (error) {
    for (
      let current = error;
      current instanceof Error;
      current = current.cause
    ) {
      messages.push(current.message);
    }
  }
  return messages;
}

async function insertDefaultYear(
  columns: Partial<typeof yearTournaments.$inferInsert> = {},
): Promise<void> {
  await insertYearTournaments([{ index: 1, columns }]);
}

async function expectNothingWritten(
  before: Awaited<ReturnType<typeof readYearRows>>,
): Promise<void> {
  await expect(readYearRows()).resolves.toEqual(before);
  await expect(readAuditLogRows()).resolves.toEqual([]);
  await expect(readAuditLogTargetIds()).resolves.toEqual([]);
}

beforeEach(async () => {
  await clearAdminTables();
  await clearYearTournamentTables();
  auditLogIds = createSequentialAuditLogIds();
});

describe('D1YearFinalDateWriter', () => {
  describe('保存', () => {
    test('既定の日の行(版0)へ保存すると、決勝日と期限の列・明示の出どころ・版1・変更した管理者と日時を書き、監査ログと対象を同じ1つの一括の書き込みで確定させる', async () => {
      await insertDefaultYear();
      const before = await readYearRow();
      const recording = createBatchRecordingD1(env.DB);
      const writer = new D1YearFinalDateWriter(createDatabase(recording.d1));

      await expect(
        writer.save(
          saveOf(
            1,
            EARLIER_SCHEDULE,
            0,
            NOW,
            auditOf(1, EARLIER_FINAL_DATE, { reason: '会場の都合' }),
          ),
        ),
      ).resolves.toBe('saved');

      await expect(readYearRows()).resolves.toEqual([
        {
          ...before,
          ...scheduleColumnsOf(EARLIER_SCHEDULE),
          finalDateSource: 'explicit',
          finalDateVersion: 1,
          finalDateUpdatedAt: NOW,
          finalDateUpdatedByAdminId: adminIdOf(1),
          updatedAt: NOW,
        },
      ]);
      await expect(readAuditLogRows()).resolves.toEqual([
        {
          id: auditLogIdOf(1),
          operatorAdminId: adminIdOf(1),
          action: YEAR_FINAL_DATE_UPDATE_ACTION.name,
          targetKind: 'setting',
          reason: '会場の都合',
          detail: {
            year: String(YEAR),
            fromDate: YEAR_SCHEDULE.finalDate,
            toDate: EARLIER_FINAL_DATE,
            fromSource: 'default',
          },
          occurredAt: NOW,
        },
      ]);
      await expect(readAuditLogTargetIds()).resolves.toEqual([
        `year-final-date:${String(YEAR)}`,
      ]);
      expect(recording.batches).toHaveLength(1);
      expect(recording.batches[0]).toHaveLength(4);
      expect(recording.statementsOutsideBatches()).toEqual([]);
    });

    test('行の無い年は、渡したIDで行を用意して同じ一括の書き込みで保存し、受付中の行を明示の出どころ・版1で作る', async () => {
      const recording = createBatchRecordingD1(env.DB);
      const writer = new D1YearFinalDateWriter(createDatabase(recording.d1));

      await expect(
        writer.save(saveOf(1, LATER_SCHEDULE, 0, NOW)),
      ).resolves.toBe('saved');

      await expect(readYearRows()).resolves.toEqual([
        expect.objectContaining({
          id: NEW_ROW_ID,
          year: YEAR,
          ...scheduleColumnsOf(LATER_SCHEDULE),
          finalDateSource: 'explicit',
          finalDateVersion: 1,
          finalDateUpdatedAt: NOW,
          finalDateUpdatedByAdminId: adminIdOf(1),
          status: 'open',
          drawStartedAt: null,
          createdAt: NOW,
          updatedAt: NOW,
        }),
      ]);
      await expect(readAuditLogRows()).resolves.toEqual([
        {
          id: auditLogIdOf(1),
          operatorAdminId: adminIdOf(1),
          action: YEAR_FINAL_DATE_UPDATE_ACTION.name,
          targetKind: 'setting',
          reason: null,
          detail: {
            year: String(YEAR),
            fromDate: YEAR_SCHEDULE.finalDate,
            toDate: LATER_FINAL_DATE,
            fromSource: 'default',
          },
          occurredAt: NOW,
        },
      ]);
      expect(recording.batches).toHaveLength(1);
      expect(recording.statementsOutsideBatches()).toEqual([]);
    });

    test('続く保存は進んだ版を求めて版を2へ進め、監査ログを順に残す', async () => {
      const writer = new D1YearFinalDateWriter(db);
      await writer.save(saveOf(1, EARLIER_SCHEDULE, 0, NOW));

      await expect(
        writer.save(
          saveOf(
            2,
            LATER_SCHEDULE,
            1,
            LATER,
            auditOf(2, LATER_FINAL_DATE, {
              fromDate: EARLIER_FINAL_DATE,
              fromSource: 'explicit',
              occurredAt: LATER,
            }),
          ),
        ),
      ).resolves.toBe('saved');

      await expect(readYearRow()).resolves.toEqual(
        expect.objectContaining({
          id: NEW_ROW_ID,
          ...scheduleColumnsOf(LATER_SCHEDULE),
          finalDateVersion: 2,
          finalDateUpdatedAt: LATER,
          finalDateUpdatedByAdminId: adminIdOf(2),
          createdAt: NOW,
          updatedAt: LATER,
        }),
      );
      await expect(readAuditLogRows()).resolves.toEqual([
        expect.objectContaining({ id: auditLogIdOf(1), occurredAt: NOW }),
        expect.objectContaining({
          id: auditLogIdOf(2),
          operatorAdminId: adminIdOf(2),
          occurredAt: LATER,
        }),
      ]);
    });

    test('日程と既定の日程の対象年が食い違えば、何も書かずにRangeErrorを投げる', async () => {
      await expect(
        new D1YearFinalDateWriter(db).save({
          ...saveOf(1, EARLIER_SCHEDULE, 0, NOW),
          defaultSchedule: defaultScheduleOf(YEAR + 1),
        }),
      ).rejects.toThrow(RangeError);

      await expectNothingWritten([]);
    });
  });

  describe('版の不一致', () => {
    test('読み取った版と現在の版が違えばversion_conflictを返し、行も監査ログも変えない', async () => {
      await insertDefaultYear({
        ...scheduleColumnsOf(EARLIER_SCHEDULE),
        finalDateSource: 'explicit',
        finalDateVersion: 2,
      });
      const before = await readYearRows();

      await expect(
        new D1YearFinalDateWriter(db).save(saveOf(1, LATER_SCHEDULE, 1, NOW)),
      ).resolves.toBe('version_conflict');

      await expectNothingWritten(before);
    });

    test('行の無い年で版0以外を求めればversion_conflictを返し、行の用意も取り消す', async () => {
      await expect(
        new D1YearFinalDateWriter(db).save(saveOf(1, LATER_SCHEDULE, 1, NOW)),
      ).resolves.toBe('version_conflict');

      await expectNothingWritten([]);
    });
  });

  describe('隣の年の版', () => {
    function neighborYearOf(
      index: number,
      year: number,
      version: number,
    ): YearTournamentFixture {
      return {
        index,
        year,
        columns: {
          finalDateSource: version === 0 ? 'default' : 'explicit',
          finalDateVersion: version,
        },
      };
    }

    test('読み取った後に前年の版が進んでいればversion_conflictを返し、年の行も監査ログも変えない', async () => {
      await insertYearTournaments([
        { index: 1 },
        neighborYearOf(2, YEAR - 1, 2),
      ]);
      const before = await readYearRows();

      await expect(
        new D1YearFinalDateWriter(db).save({
          ...saveOf(1, LATER_SCHEDULE, 0, NOW),
          previousYearVersion: 1,
        }),
      ).resolves.toBe('version_conflict');

      await expectNothingWritten(before);
    });

    test('読み取った後に翌年の行が作られて保存されていればversion_conflictを返し、年の行も監査ログも変えない', async () => {
      await insertYearTournaments([
        { index: 1 },
        neighborYearOf(3, YEAR + 1, 1),
      ]);
      const before = await readYearRows();

      await expect(
        new D1YearFinalDateWriter(db).save(saveOf(1, LATER_SCHEDULE, 0, NOW)),
      ).resolves.toBe('version_conflict');

      await expectNothingWritten(before);
    });

    test('読み取った後に翌年の版が進んでいれば、行の無い年の保存もversion_conflictを返し、行の用意を取り消す', async () => {
      await insertYearTournaments([neighborYearOf(3, YEAR + 1, 4)]);
      const before = await readYearRows();

      await expect(
        new D1YearFinalDateWriter(db).save({
          ...saveOf(1, LATER_SCHEDULE, 0, NOW),
          nextYearVersion: 3,
        }),
      ).resolves.toBe('version_conflict');

      await expectNothingWritten(before);
    });

    test('前年と翌年の版が読み取ったままなら保存し、隣の年の行は変えない', async () => {
      await insertYearTournaments([
        { index: 1 },
        neighborYearOf(2, YEAR - 1, 2),
        neighborYearOf(3, YEAR + 1, 1),
      ]);
      const [previousBefore, , nextBefore] = await readYearRows();

      await expect(
        new D1YearFinalDateWriter(db).save({
          ...saveOf(1, LATER_SCHEDULE, 0, NOW),
          previousYearVersion: 2,
          nextYearVersion: 1,
        }),
      ).resolves.toBe('saved');

      await expect(readYearRows()).resolves.toEqual([
        previousBefore,
        expect.objectContaining({
          year: YEAR,
          ...scheduleColumnsOf(LATER_SCHEDULE),
          finalDateVersion: 1,
        }),
        nextBefore,
      ]);
      await expect(readAuditLogRows()).resolves.toHaveLength(1);
    });

    test('読み取った後に隣の年の行が既定の日の版0で作られただけなら、行の無い年として読んだ版0のまま保存できる', async () => {
      await insertYearTournaments([
        { index: 1 },
        neighborYearOf(2, YEAR - 1, 0),
        neighborYearOf(3, YEAR + 1, 0),
      ]);

      await expect(
        new D1YearFinalDateWriter(db).save(saveOf(1, LATER_SCHEDULE, 0, NOW)),
      ).resolves.toBe('saved');
    });

    test('隣の年の版が違っても、凍結済みの年はversion_conflictでなくlockedを返す', async () => {
      await insertYearTournaments([
        { index: 1, columns: { status: 'drawing', drawStartedAt: NOW } },
        neighborYearOf(3, YEAR + 1, 1),
      ]);
      const before = await readYearRows();

      await expect(
        new D1YearFinalDateWriter(db).save(saveOf(1, LATER_SCHEDULE, 0, NOW)),
      ).resolves.toBe('locked');

      await expectNothingWritten(before);
    });
  });

  describe('変更期限と凍結', () => {
    test('決勝日の8日前の23:59は保存できる', async () => {
      await insertDefaultYear();

      await expect(
        new D1YearFinalDateWriter(db).save(
          saveOf(1, LATER_SCHEDULE, 0, EIGHT_DAYS_BEFORE_LAST_MINUTE),
        ),
      ).resolves.toBe('saved');

      await expect(readYearRow()).resolves.toEqual(
        expect.objectContaining({
          ...scheduleColumnsOf(LATER_SCHEDULE),
          finalDateVersion: 1,
        }),
      );
    });

    test('決勝日の7日前の0:00は、版が一致してもlockedを返し、行も監査ログも変えない', async () => {
      expect(SEVEN_DAYS_BEFORE_START).toEqual(YEAR_SCHEDULE.changeLockAt);
      await insertDefaultYear();
      const before = await readYearRows();

      await expect(
        new D1YearFinalDateWriter(db).save(
          saveOf(1, LATER_SCHEDULE, 0, SEVEN_DAYS_BEFORE_START),
        ),
      ).resolves.toBe('locked');

      await expectNothingWritten(before);
    });

    test('凍結済みの年は、変更期限の前で版が一致してもlockedを返し、行も監査ログも変えない', async () => {
      await insertDefaultYear({ status: 'drawing', drawStartedAt: NOW });
      const before = await readYearRows();

      await expect(
        new D1YearFinalDateWriter(db).save(saveOf(1, LATER_SCHEDULE, 0, NOW)),
      ).resolves.toBe('locked');

      await expectNothingWritten(before);
    });

    test('版も違う凍結済みの年は、version_conflictでなくlockedを返す', async () => {
      await insertDefaultYear({ status: 'drawing', drawStartedAt: NOW });
      const before = await readYearRows();

      await expect(
        new D1YearFinalDateWriter(db).save(saveOf(1, LATER_SCHEDULE, 3, NOW)),
      ).resolves.toBe('locked');

      await expectNothingWritten(before);
    });

    test('行の無い年は既定の日程の変更期限以降ならlockedを返し、行を作らない', async () => {
      await expect(
        new D1YearFinalDateWriter(db).save(
          saveOf(1, LATER_SCHEDULE, 0, SEVEN_DAYS_BEFORE_START),
        ),
      ).resolves.toBe('locked');

      await expectNothingWritten([]);
    });
  });

  test('保存の後は、年の照会と枠の対象年の判定と組み合わせ決定の到来が新しい列から求まる', async () => {
    const store = new D1YearTournamentStore(db);
    const calendar = new YearTournamentCalendar(store);
    // 既定の決勝日の決済期限日5/24より前で、新しい決済期限日5/10より後のWeek優勝の日
    const awardedDate = parseBusinessDate('2027-05-17');
    const targetYearOf = async (date: BusinessDate) => {
      const resolution = await calendar.resolveAward(date, NOW);
      return resolution.kind === 'open' ? resolution.year.year : null;
    };
    await insertDefaultYear();
    await expect(targetYearOf(awardedDate)).resolves.toBe(YEAR);

    await new D1YearFinalDateWriter(db).save(
      saveOf(1, EARLIER_SCHEDULE, 0, NOW),
    );

    const entries = await calendar.describe([YEAR], NOW);
    expect(entries.get(YEAR)).toEqual(
      expect.objectContaining({
        schedule: EARLIER_SCHEDULE,
        source: 'explicit',
        state: 'open',
      }),
    );
    await expect(targetYearOf(awardedDate)).resolves.toBe(YEAR + 1);
    await expect(store.listDue(EARLIER_SCHEDULE.drawAt, 10)).resolves.toEqual([
      expect.objectContaining({ year: YEAR, schedule: EARLIER_SCHEDULE }),
    ]);
  });

  test('版と期限の照合以外の失敗はそのまま投げ直す', async () => {
    const writer = new D1YearFinalDateWriter(createDatabase(createFailingD1()));

    await expect(
      failureMessagesOf(writer.save(saveOf(1, LATER_SCHEDULE, 0, NOW))),
    ).resolves.toContain(FAILING_D1_MESSAGE);
  });
});
