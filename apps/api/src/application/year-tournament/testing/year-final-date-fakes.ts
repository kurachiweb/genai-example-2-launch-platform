import type {
  AuditEntryInput,
  AuditLogRecorder,
  PreparedAuditEntry,
} from '../../../../lib/core/admin/audit-log.ts';
import type { IdGenerator } from '../../../../lib/core/ids/id-generator.ts';
import {
  type BusinessDate,
  parseBusinessDate,
  toBusinessDateTime,
} from '../../../../lib/core/time/business-time.ts';
import type {
  YearCalendar,
  YearCalendarEntry,
  YearTournamentRecord,
} from '../../../../lib/core/year-tournament/ports.ts';
import {
  defaultFinalDate,
  type YearSchedule,
  yearScheduleFor,
} from '../../../../lib/core/year-tournament/year-schedule.ts';
import type { YearFinalDateSave, YearFinalDateWriter } from '../ports.ts';

export const NEW_YEAR_TOURNAMENT_ID = '01JF0YNEWY0000000000000001';
export const AUDIT_LOG_ID = '01JF0YAUDT0000000000000001';
export const SUPER_ADMIN_ID = '01JF0YADMN0000000000000001';
export const OTHER_ADMIN_ID = '01JF0YADMN0000000000000002';

export function scheduleOf(year: number, finalDate: string): YearSchedule {
  return yearScheduleFor(year, parseBusinessDate(finalDate));
}

export function defaultScheduleOf(year: number): YearSchedule {
  return yearScheduleFor(year, defaultFinalDate(year));
}

export function yearRowOf(
  year: number,
  overrides: Partial<YearTournamentRecord> = {},
): YearTournamentRecord {
  return {
    yearTournamentId: `01JF0YYEAR${String(year).padStart(16, '0')}`,
    year,
    schedule: defaultScheduleOf(year),
    source: 'default',
    version: 0,
    updatedAt: null,
    updatedByAdminId: null,
    status: 'open',
    drawStartedAt: null,
    bracketId: null,
    firstRoundDate: null,
    participantCount: null,
    outcome: null,
    championEntryId: null,
    awardedAt: null,
    ...overrides,
  };
}

function yearOf(date: BusinessDate): number {
  return Number(date.slice(0, 4));
}

// 行の無い年は既定の日から求め、組み合わせ決定の時刻を過ぎていれば開催しなかった年とする(YearCalendarの契約)
function calendarEntryOf(
  rows: ReadonlyMap<number, YearTournamentRecord>,
  year: number,
  now: Date,
): YearCalendarEntry {
  const record = rows.get(year);
  if (record !== undefined) {
    return {
      year,
      schedule: record.schedule,
      source: record.source,
      state: record.drawStartedAt === null ? 'open' : 'frozen',
      record,
    };
  }
  const schedule = defaultScheduleOf(year);
  return {
    year,
    schedule,
    source: 'default',
    state: schedule.drawAt.getTime() > now.getTime() ? 'planned' : 'not_held',
    record: null,
  };
}

const unused = (name: string) => (): never => {
  throw new Error(`決勝実施日の照会と保存は${name}を呼ばない`);
};

export interface YearFinalDateFakeOptions {
  readonly rows?: readonly YearTournamentRecord[];
  readonly saveResult?: 'saved' | 'version_conflict' | 'locked';
  readonly prepareError?: Error;
}

// 年の照会・書き込み・監査ログを偽物にし、呼び出しの順と渡された値を記録する。
// 保存に成功した書き込みは年の行を書き換え、保存の後の読み直しを再現する
export function createYearFinalDateFakes(
  options: YearFinalDateFakeOptions = {},
): {
  readonly calendar: YearCalendar;
  readonly writer: YearFinalDateWriter;
  readonly auditLog: AuditLogRecorder;
  readonly ids: IdGenerator;
  readonly calls: string[];
  readonly described: {
    readonly years: readonly number[];
    readonly now: Date;
  }[];
  readonly ensured: Date[];
  readonly prepared: AuditEntryInput[];
  readonly saved: YearFinalDateSave[];
} {
  const rows = new Map(
    (options.rows ?? []).map((row): [number, YearTournamentRecord] => [
      row.year,
      row,
    ]),
  );
  const calls: string[] = [];
  const described: { readonly years: readonly number[]; readonly now: Date }[] =
    [];
  const ensured: Date[] = [];
  const prepared: AuditEntryInput[] = [];
  const saved: YearFinalDateSave[] = [];

  const calendar: YearCalendar = {
    describe(years, now) {
      calls.push('describe');
      described.push({ years, now });
      return Promise.resolve(
        new Map(
          [...new Set(years)].map((year) => [
            year,
            calendarEntryOf(rows, year, now),
          ]),
        ),
      );
    },
    ensureUpcoming(now) {
      calls.push('ensureUpcoming');
      ensured.push(now);
      const currentYear = yearOf(toBusinessDateTime(now).date);
      const upcoming = [currentYear, currentYear + 1, currentYear + 2]
        .map((year) => calendarEntryOf(rows, year, now))
        .find(({ state }) => state === 'planned' || state === 'open');
      if (upcoming === undefined) {
        return Promise.reject(new RangeError('開催予定の年がありません'));
      }
      const record = upcoming.record ?? yearRowOf(upcoming.year);
      rows.set(record.year, record);
      return Promise.resolve(record);
    },
    resolveAward: unused('resolveAward'),
    upcoming: unused('upcoming'),
    openPeriodStart: unused('openPeriodStart'),
  };

  const writer: YearFinalDateWriter = {
    save(input) {
      calls.push('save');
      saved.push(input);
      const result = options.saveResult ?? 'saved';
      if (result === 'saved') {
        const current =
          rows.get(input.schedule.year) ??
          yearRowOf(input.schedule.year, {
            yearTournamentId: input.yearTournamentId,
            schedule: input.defaultSchedule,
          });
        rows.set(input.schedule.year, {
          ...current,
          schedule: input.schedule,
          source: 'explicit',
          version: current.version + 1,
          updatedAt: input.now,
          updatedByAdminId: input.adminId,
        });
      }
      return Promise.resolve(result);
    },
  };

  const auditLog: AuditLogRecorder = {
    prepare(entry) {
      calls.push('prepare');
      prepared.push(entry);
      if (options.prepareError !== undefined) {
        throw options.prepareError;
      }
      return {
        id: AUDIT_LOG_ID,
        operatorAdminId: entry.operatorAdminId,
        action: entry.action,
        targetKind: 'setting',
        targetIds: entry.targetIds,
        reason: entry.reason ?? null,
        detail: entry.detail ?? {},
        occurredAt: entry.occurredAt,
      } as PreparedAuditEntry;
    },
    record: unused('record'),
  };

  const ids: IdGenerator = { generate: () => NEW_YEAR_TOURNAMENT_ID };

  return {
    calendar,
    writer,
    auditLog,
    ids,
    calls,
    described,
    ensured,
    prepared,
    saved,
  };
}
