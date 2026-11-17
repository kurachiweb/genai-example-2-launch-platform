import { inject, injectable } from 'inversify';

import { YEAR_FINAL_DATE_UPDATE_ACTION } from '../../../common-lib/admin/audit-actions/tournament-year.ts';
import type { AuditLogRecorder } from '../../../lib/core/admin/audit-log.ts';
import { ADMIN_PLATFORM_TYPES } from '../../../lib/core/admin/identifiers.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import type { BusinessDate } from '../../../lib/core/time/business-time.ts';
import {
  checkFinalDateChoice,
  editableYears,
  type FinalDateContext,
  finalDateChoices,
  isFinalDateChangeable,
  nextYearGapWarning,
} from '../../../lib/core/year-tournament/final-date-choice.ts';
import { YEAR_TOURNAMENT_TYPES } from '../../../lib/core/year-tournament/identifiers.ts';
import type {
  YearCalendar,
  YearCalendarEntry,
  YearFinalDateSource,
} from '../../../lib/core/year-tournament/ports.ts';
import {
  defaultFinalDate,
  type YearSchedule,
  yearScheduleFor,
} from '../../../lib/core/year-tournament/year-schedule.ts';
import { isPreviousYearSet } from '../../../lib/core/year-tournament/year-target-rules.ts';
import type { YearFinalDateWriter } from './ports.ts';
import {
  finalDateValidationError,
  yearFinalDateError,
} from './year-final-date-errors.ts';
import { YEAR_TOURNAMENT_API_TYPES } from './year-tournament-api-types.ts';

export interface YearFinalDateView {
  readonly year: number;
  readonly schedule: YearSchedule;
  readonly source: YearFinalDateSource;
  readonly changeable: boolean;
  // 変更期限以降・凍結済み
  readonly lockReason: 'locked' | null;
  readonly choices: readonly BusinessDate[];
  // 前年を設定済みと扱う場合だけ
  readonly previousFinalDate: BusinessDate | null;
  readonly nextFinalDate: {
    readonly date: BusinessDate;
    readonly source: YearFinalDateSource;
  } | null;
  readonly nextYearGapWarning: BusinessDate | null;
  // 行が無い年・未設定の年は0
  readonly version: number;
  readonly updatedAt: Date | null;
  readonly updatedByAdminId: string | null;
}

export interface YearFinalDateUpdateInput {
  // リゾルバが最上位管理者であることを確かめた管理者
  readonly adminId: string;
  readonly year: number;
  readonly finalDate: BusinessDate;
  readonly expectedVersion: number;
  readonly reason?: string | undefined;
  readonly now: Date;
}

// 認可と変更者のニックネームの照会はリゾルバが行う
export interface YearFinalDateService {
  // 現在の年と翌年
  read(now: Date): Promise<readonly [YearFinalDateView, YearFinalDateView]>;
  // 選択の違反はAppError(bad_request, validation_error)と理由、競合はAppError(conflict, version_conflict)、
  // 変更期限以降・凍結済みはAppError(unprocessable, final_date_locked)
  update(input: YearFinalDateUpdateInput): Promise<YearFinalDateView>;
}

interface YearFinalDateSnapshot {
  readonly entry: YearCalendarEntry;
  readonly context: FinalDateContext;
  readonly next: YearCalendarEntry;
}

function entryOf(
  entries: ReadonlyMap<number, YearCalendarEntry>,
  year: number,
): YearCalendarEntry {
  const entry = entries.get(year);
  if (entry === undefined) {
    throw new RangeError(`照会していない年です: ${String(year)}`);
  }
  return entry;
}

function snapshotOf(
  entries: ReadonlyMap<number, YearCalendarEntry>,
  year: number,
  now: Date,
): YearFinalDateSnapshot {
  const previous = entryOf(entries, year - 1);
  const entry = entryOf(entries, year);
  const next = entryOf(entries, year + 1);
  return {
    entry,
    next,
    context: {
      year,
      now,
      current: entry.schedule,
      drawStarted: entry.state === 'frozen',
      previousFinalDate: isPreviousYearSet(previous)
        ? previous.schedule.finalDate
        : null,
      nextExplicitFinalDate:
        next.source === 'explicit' ? next.schedule.finalDate : null,
    },
  };
}

function viewOf({
  entry,
  context,
  next,
}: YearFinalDateSnapshot): YearFinalDateView {
  const changeable = isFinalDateChangeable(context);
  return {
    year: entry.year,
    schedule: entry.schedule,
    source: entry.source,
    changeable,
    lockReason: changeable ? null : 'locked',
    choices: finalDateChoices(context),
    previousFinalDate: context.previousFinalDate,
    nextFinalDate: { date: next.schedule.finalDate, source: next.source },
    nextYearGapWarning: nextYearGapWarning({
      finalDate: entry.schedule.finalDate,
      nextYearDefault:
        next.source === 'default' ? next.schedule.finalDate : null,
    }),
    version: entry.record?.version ?? 0,
    updatedAt: entry.record?.updatedAt ?? null,
    updatedByAdminId: entry.record?.updatedByAdminId ?? null,
  };
}

@injectable()
export class DefaultYearFinalDateService implements YearFinalDateService {
  constructor(
    @inject(YEAR_TOURNAMENT_TYPES.YearCalendar)
    private readonly calendar: YearCalendar,
    @inject(YEAR_TOURNAMENT_API_TYPES.YearFinalDateWriter)
    private readonly writer: YearFinalDateWriter,
    @inject(ADMIN_PLATFORM_TYPES.AuditLogRecorder)
    private readonly auditLog: AuditLogRecorder,
    @inject(PLATFORM_TYPES.IdGenerator) private readonly ids: IdGenerator,
  ) {}

  async read(
    now: Date,
  ): Promise<readonly [YearFinalDateView, YearFinalDateView]> {
    const [currentYear, nextYear] = editableYears(now);
    const entries = await this.describeEditable(now);
    return [
      viewOf(snapshotOf(entries, currentYear, now)),
      viewOf(snapshotOf(entries, nextYear, now)),
    ];
  }

  async update(input: YearFinalDateUpdateInput): Promise<YearFinalDateView> {
    const { year, finalDate, now } = input;
    if (!editableYears(now).includes(year)) {
      throw finalDateValidationError('year_not_editable', {
        previousFinalDate: null,
        nextExplicitFinalDate: null,
      });
    }
    const { entry, context } = snapshotOf(
      await this.describeEditable(now),
      year,
      now,
    );
    const violation = checkFinalDateChoice(finalDate, context);
    if (violation === 'locked') {
      throw yearFinalDateError('final_date_locked');
    }
    if (violation !== null) {
      throw finalDateValidationError(violation, {
        previousFinalDate: context.previousFinalDate,
        nextExplicitFinalDate: context.nextExplicitFinalDate,
      });
    }
    const audit = this.auditLog.prepare({
      operatorAdminId: input.adminId,
      action: YEAR_FINAL_DATE_UPDATE_ACTION.name,
      targetIds: [`year-final-date:${String(year)}`],
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      detail: {
        year: String(year),
        fromDate: entry.schedule.finalDate,
        toDate: finalDate,
        fromSource: entry.source,
      },
      occurredAt: now,
    });
    const result = await this.writer.save({
      yearTournamentId: this.ids.generate(),
      schedule: yearScheduleFor(year, finalDate),
      defaultSchedule: yearScheduleFor(year, defaultFinalDate(year)),
      expectedVersion: input.expectedVersion,
      adminId: input.adminId,
      audit,
      now,
    });
    if (result === 'locked') {
      throw yearFinalDateError('final_date_locked');
    }
    if (result === 'version_conflict') {
      throw yearFinalDateError('version_conflict');
    }
    const views = await this.read(now);
    return views[0].year === year ? views[0] : views[1];
  }

  // 前年は前年の決勝日、翌々年は翌年の64週の注意と検証に使う
  private async describeEditable(
    now: Date,
  ): Promise<ReadonlyMap<number, YearCalendarEntry>> {
    await this.calendar.ensureUpcoming(now);
    const [currentYear, nextYear] = editableYears(now);
    return this.calendar.describe(
      [currentYear - 1, currentYear, nextYear, nextYear + 1],
      now,
    );
  }
}
