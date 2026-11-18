import { describe, expect, test } from 'bun:test';

import { YEAR_FINAL_DATE_UPDATE_ACTION } from '../../../common-lib/admin/audit-actions/tournament-year.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import {
  addBusinessDays,
  type BusinessDate,
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../../lib/core/time/business-time.ts';
import type { YearTournamentRecord } from '../../../lib/core/year-tournament/ports.ts';
import {
  AUDIT_LOG_ID,
  createYearFinalDateFakes,
  defaultScheduleOf,
  NEW_YEAR_TOURNAMENT_ID,
  OTHER_ADMIN_ID,
  scheduleOf,
  SUPER_ADMIN_ID,
  type YearFinalDateFakeOptions,
  yearRowOf,
} from './testing/year-final-date-fakes.ts';
import {
  DefaultYearFinalDateService,
  type YearFinalDateView,
} from './year-final-date-service.ts';

const START_OF_DAY = Object.freeze({ hour: 0, minute: 0 });

// 2027-03-01(月)の0:00。8日後以降の最初の日曜日は2027-03-14
const NOW = fromBusinessDateTime(parseBusinessDate('2027-03-01'), START_OF_DAY);
const UPDATED_AT = new Date('2027-02-01T03:00:00.000Z');
const NEXT_UPDATED_AT = new Date('2027-02-10T03:00:00.000Z');

// 前年は既定の日(2026-05-31)で開催済み
const PREVIOUS_ROW = yearRowOf(2026, {
  status: 'finished',
  drawStartedAt: defaultScheduleOf(2026).drawAt,
  outcome: 'no_award',
});

const CURRENT_ROW = yearRowOf(2027, {
  schedule: scheduleOf(2027, '2027-06-13'),
  source: 'explicit',
  version: 2,
  updatedAt: UPDATED_AT,
  updatedByAdminId: OTHER_ADMIN_ID,
});

const NEXT_ROW = yearRowOf(2028, {
  schedule: scheduleOf(2028, '2028-08-27'),
  source: 'explicit',
  version: 1,
  updatedAt: NEXT_UPDATED_AT,
  updatedByAdminId: SUPER_ADMIN_ID,
});

const ALL_ROWS: readonly YearTournamentRecord[] = [
  PREVIOUS_ROW,
  CURRENT_ROW,
  NEXT_ROW,
];

function sundaysBetween(first: string, last: string): readonly BusinessDate[] {
  const sundays: BusinessDate[] = [];
  for (
    let sunday = parseBusinessDate(first);
    sunday <= parseBusinessDate(last);
    sunday = addBusinessDays(sunday, 7)
  ) {
    sundays.push(sunday);
  }
  return sundays;
}

function setup(options: YearFinalDateFakeOptions = {}) {
  const fakes = createYearFinalDateFakes(options);
  const service = new DefaultYearFinalDateService(
    fakes.calendar,
    fakes.writer,
    fakes.auditLog,
    fakes.ids,
  );
  return { service, ...fakes };
}

function missing(): never {
  throw new Error('保存の入力がありません');
}

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('拒否される想定です');
}

function shapeOf(error: unknown) {
  if (!(error instanceof AppError)) {
    throw error;
  }
  return {
    kind: error.kind,
    code: error.code,
    message: error.message,
    details: error.details,
  };
}

function viewOf(
  views: readonly YearFinalDateView[],
  year: number,
): YearFinalDateView {
  const view = views.find((candidate) => candidate.year === year);
  if (view === undefined) {
    throw new Error(`${String(year)}年の表示がありません`);
  }
  return view;
}

describe('DefaultYearFinalDateService.read', () => {
  test('照会の前に次に開催する年の行を用意し、前年〜2年後を1回で読む', async () => {
    const { service, calls, ensured, described } = setup({ rows: ALL_ROWS });

    await service.read(NOW);

    expect(calls).toStrictEqual(['ensureUpcoming', 'describe']);
    expect(ensured).toStrictEqual([NOW]);
    expect(described).toStrictEqual([
      { years: [2026, 2027, 2028, 2029], now: NOW },
    ]);
  });

  test('現在の年と翌年の実効の日・出どころ・期限・変更の可否・候補・前年と翌年・変更の記録を返す', async () => {
    const { service } = setup({ rows: ALL_ROWS });

    const views = await service.read(NOW);

    expect(views.map(({ year }) => year)).toStrictEqual([2027, 2028]);
    // 前年(2026-05-31)の64週後の2027-08-22以降と、翌年(2028-08-27)の64週前の2027-06-06以前を除く
    expect(views[0]).toStrictEqual({
      year: 2027,
      schedule: scheduleOf(2027, '2027-06-13'),
      source: 'explicit',
      changeable: true,
      lockReason: null,
      choices: sundaysBetween('2027-06-13', '2027-08-15'),
      previousFinalDate: parseBusinessDate('2026-05-31'),
      nextFinalDate: {
        date: parseBusinessDate('2028-08-27'),
        source: 'explicit',
      },
      nextYearGapWarning: null,
      version: 2,
      updatedAt: UPDATED_AT,
      updatedByAdminId: OTHER_ADMIN_ID,
    });
    // 前年(2027-06-13)の64週後の2028-09-03以降を除き、翌々年は既定の日のため除かない
    expect(views[1]).toStrictEqual({
      year: 2028,
      schedule: scheduleOf(2028, '2028-08-27'),
      source: 'explicit',
      changeable: true,
      lockReason: null,
      choices: sundaysBetween('2028-01-02', '2028-08-27'),
      previousFinalDate: parseBusinessDate('2027-06-13'),
      nextFinalDate: {
        date: parseBusinessDate('2029-05-27'),
        source: 'default',
      },
      nextYearGapWarning: null,
      version: 1,
      updatedAt: NEXT_UPDATED_AT,
      updatedByAdminId: SUPER_ADMIN_ID,
    });
  });

  test('行の無い年は既定の日の版0で示し、開催しなかった前年の決勝日を前年の日として扱わない', async () => {
    const { service } = setup();

    const views = await service.read(NOW);

    expect(views[0]).toStrictEqual({
      year: 2027,
      schedule: defaultScheduleOf(2027),
      source: 'default',
      changeable: true,
      lockReason: null,
      choices: sundaysBetween('2027-03-14', '2027-12-26'),
      previousFinalDate: null,
      nextFinalDate: {
        date: parseBusinessDate('2028-05-28'),
        source: 'default',
      },
      nextYearGapWarning: null,
      version: 0,
      updatedAt: null,
      updatedByAdminId: null,
    });
    expect(viewOf(views, 2028)).toMatchObject({
      source: 'default',
      previousFinalDate: parseBusinessDate('2027-05-30'),
      version: 0,
      updatedAt: null,
      updatedByAdminId: null,
    });
  });

  test('翌年が未設定で既定の日まで64週以上空くときだけ翌年の既定の日を注意として示す', async () => {
    // 2028-01-09の64週後は2029-04-01で、2029年の既定の日(2029-05-27)はそれ以降になる
    const { service } = setup({
      rows: [
        yearRowOf(2028, {
          schedule: scheduleOf(2028, '2028-01-09'),
          source: 'explicit',
          version: 1,
        }),
      ],
    });

    const views = await service.read(NOW);

    expect(viewOf(views, 2028).nextYearGapWarning).toBe(
      parseBusinessDate('2029-05-27'),
    );
    expect(viewOf(views, 2027).nextYearGapWarning).toBeNull();
  });

  test('変更期限の時刻からは変更できず、理由をlockedにして候補を空にする', async () => {
    const changeLockAt = defaultScheduleOf(2027).changeLockAt;
    const { service } = setup();

    const before = await service.read(new Date(changeLockAt.getTime() - 1));
    const at = await service.read(changeLockAt);

    expect(viewOf(before, 2027)).toMatchObject({
      changeable: true,
      lockReason: null,
    });
    expect(viewOf(at, 2027)).toMatchObject({
      changeable: false,
      lockReason: 'locked',
      choices: [],
    });
    expect(viewOf(at, 2028).changeable).toBe(true);
  });

  test('組み合わせ決定が始まった年は変更期限の前でも変更できない', async () => {
    const { service } = setup({
      rows: [
        yearRowOf(2027, {
          status: 'drawing',
          drawStartedAt: new Date(NOW.getTime() - 1),
        }),
      ],
    });

    const views = await service.read(NOW);

    expect(viewOf(views, 2027)).toMatchObject({
      changeable: false,
      lockReason: 'locked',
      choices: [],
    });
  });
});

describe('DefaultYearFinalDateService.update', () => {
  const REASON = '欧州リーグの最終節に合わせる';

  test('監査ログを準備して書き込みへ渡し、保存の後に読み直した対象年の表示を返す', async () => {
    const { service, calls, prepared, saved } = setup({ rows: ALL_ROWS });

    const view = await service.update({
      adminId: SUPER_ADMIN_ID,
      year: 2027,
      finalDate: parseBusinessDate('2027-07-04'),
      expectedVersion: 2,
      reason: REASON,
      now: NOW,
    });

    expect(calls).toStrictEqual([
      'ensureUpcoming',
      'describe',
      'prepare',
      'save',
      'ensureUpcoming',
      'describe',
    ]);
    expect(prepared).toStrictEqual([
      {
        operatorAdminId: SUPER_ADMIN_ID,
        action: YEAR_FINAL_DATE_UPDATE_ACTION.name,
        targetIds: ['year-final-date:2027'],
        reason: REASON,
        detail: {
          year: '2027',
          fromDate: '2027-06-13',
          toDate: '2027-07-04',
          fromSource: 'explicit',
        },
        occurredAt: NOW,
      },
    ]);
    expect(saved).toHaveLength(1);
    const { audit, ...save } = saved[0] ?? missing();
    expect(save).toStrictEqual({
      yearTournamentId: NEW_YEAR_TOURNAMENT_ID,
      schedule: scheduleOf(2027, '2027-07-04'),
      defaultSchedule: defaultScheduleOf(2027),
      expectedVersion: 2,
      previousYearVersion: 0,
      nextYearVersion: 1,
      adminId: SUPER_ADMIN_ID,
      now: NOW,
    });
    expect(audit).toMatchObject({
      id: AUDIT_LOG_ID,
      targetIds: ['year-final-date:2027'],
    });
    expect(view).toStrictEqual({
      year: 2027,
      schedule: scheduleOf(2027, '2027-07-04'),
      source: 'explicit',
      changeable: true,
      lockReason: null,
      choices: sundaysBetween('2027-06-13', '2027-08-15'),
      previousFinalDate: parseBusinessDate('2026-05-31'),
      nextFinalDate: {
        date: parseBusinessDate('2028-08-27'),
        source: 'explicit',
      },
      nextYearGapWarning: null,
      version: 3,
      updatedAt: NOW,
      updatedByAdminId: SUPER_ADMIN_ID,
    });
  });

  test('行の無い年は既定の日を変更前として記録し、版0と新しい行のIDと既定の日程で保存する', async () => {
    const { service, prepared, saved } = setup();

    const view = await service.update({
      adminId: SUPER_ADMIN_ID,
      year: 2028,
      finalDate: parseBusinessDate('2028-06-04'),
      expectedVersion: 0,
      now: NOW,
    });

    expect(prepared).toStrictEqual([
      {
        operatorAdminId: SUPER_ADMIN_ID,
        action: 'year-final-date.update',
        targetIds: ['year-final-date:2028'],
        detail: {
          year: '2028',
          fromDate: '2028-05-28',
          toDate: '2028-06-04',
          fromSource: 'default',
        },
        occurredAt: NOW,
      },
    ]);
    expect(saved[0]).toMatchObject({
      yearTournamentId: NEW_YEAR_TOURNAMENT_ID,
      schedule: scheduleOf(2028, '2028-06-04'),
      defaultSchedule: defaultScheduleOf(2028),
      expectedVersion: 0,
      previousYearVersion: 0,
      nextYearVersion: 0,
    });
    expect(view).toMatchObject({
      year: 2028,
      schedule: scheduleOf(2028, '2028-06-04'),
      source: 'explicit',
      version: 1,
      updatedAt: NOW,
      updatedByAdminId: SUPER_ADMIN_ID,
    });
  });

  test.each([
    {
      name: '現在の年',
      rows: [{ ...PREVIOUS_ROW, version: 5 }, CURRENT_ROW, NEXT_ROW],
      year: 2027,
      finalDate: '2027-07-04',
      expectedVersion: 2,
      previousYearVersion: 5,
      nextYearVersion: 1,
    },
    {
      name: '行の無い翌々年を隣に持つ翌年',
      rows: ALL_ROWS,
      year: 2028,
      finalDate: '2028-08-20',
      expectedVersion: 1,
      previousYearVersion: 2,
      nextYearVersion: 0,
    },
  ])(
    '$nameは、検証に使った読み取りの前年と翌年の版(行の無い年は0)を保存の条件へ渡す',
    async ({
      rows,
      year,
      finalDate,
      expectedVersion,
      previousYearVersion,
      nextYearVersion,
    }) => {
      const { service, saved } = setup({ rows });

      await service.update({
        adminId: SUPER_ADMIN_ID,
        year,
        finalDate: parseBusinessDate(finalDate),
        expectedVersion,
        now: NOW,
      });

      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({
        expectedVersion,
        previousYearVersion,
        nextYearVersion,
      });
    },
  );

  const VALIDATION_MESSAGE = '入力内容を確認してください。';

  test.each([
    {
      name: '現在の年と翌年以外の年',
      year: 2029,
      finalDate: '2029-05-27',
      field: 'year',
      code: 'year_not_editable',
      message: '現在の年か翌年を選んでください。',
    },
    {
      name: '前年',
      year: 2026,
      finalDate: '2026-05-31',
      field: 'year',
      code: 'year_not_editable',
      message: '現在の年か翌年を選んでください。',
    },
    {
      name: '日曜日でない日',
      year: 2027,
      finalDate: '2027-07-05',
      field: 'finalDate',
      code: 'not_sunday',
      message: '日曜日を選んでください。',
    },
    {
      name: '対象年の外の日',
      year: 2027,
      finalDate: '2028-01-02',
      field: 'finalDate',
      code: 'out_of_year',
      message: '対象年の日付を選んでください。',
    },
    {
      name: '0:00が8日後より前の日',
      year: 2027,
      finalDate: '2027-03-07',
      field: 'finalDate',
      code: 'too_soon',
      message: '現在から8日後以降の日付を選んでください。',
    },
    {
      name: '前年の決勝日から64週以上空く日',
      year: 2027,
      finalDate: '2027-08-22',
      field: 'finalDate',
      code: 'too_far_from_previous',
      message:
        '前年の決勝実施日(2026年5月31日(日))から64週以上空く日付は選べません。',
    },
    {
      name: '設定済みの翌年の決勝日まで64週以上空く日',
      year: 2027,
      finalDate: '2027-06-06',
      field: 'finalDate',
      code: 'too_far_from_next',
      message:
        '翌年の決勝実施日(2028年8月27日(日))まで64週以上空く日付は選べません。',
    },
  ])(
    '$nameはvalidation_errorと理由を返し、監査ログの準備も保存もしない',
    async ({ year, finalDate, field, code, message }) => {
      const { service, prepared, saved } = setup({ rows: ALL_ROWS });

      const error = await errorOf(
        service.update({
          adminId: SUPER_ADMIN_ID,
          year,
          finalDate: parseBusinessDate(finalDate),
          expectedVersion: 1,
          now: NOW,
        }),
      );

      expect(shapeOf(error)).toStrictEqual({
        kind: 'bad_request',
        code: 'validation_error',
        message: VALIDATION_MESSAGE,
        details: [{ field, code, message }],
      });
      expect(prepared).toStrictEqual([]);
      expect(saved).toStrictEqual([]);
    },
  );

  test('参照する決勝日が現在の年にあっても年と曜日を付けて示す', async () => {
    const { service } = setup({ rows: ALL_ROWS });

    const error = await errorOf(
      service.update({
        adminId: SUPER_ADMIN_ID,
        year: 2028,
        finalDate: parseBusinessDate('2028-09-03'),
        expectedVersion: 1,
        now: NOW,
      }),
    );

    expect(shapeOf(error).details).toStrictEqual([
      {
        field: 'finalDate',
        code: 'too_far_from_previous',
        message:
          '前年の決勝実施日(2027年6月13日(日))から64週以上空く日付は選べません。',
      },
    ]);
  });

  const LOCKED_ERROR = {
    kind: 'unprocessable' as const,
    code: 'final_date_locked',
    message: '決勝実施日の7日前を過ぎたため変更できません。',
    details: undefined,
  };

  test('読み取った変更前の日の変更期限以降はfinal_date_lockedで拒否し、監査ログの準備も保存もしない', async () => {
    const { service, prepared, saved } = setup({ rows: ALL_ROWS });

    const error = await errorOf(
      service.update({
        adminId: SUPER_ADMIN_ID,
        year: 2027,
        finalDate: parseBusinessDate('2027-07-04'),
        expectedVersion: 2,
        now: CURRENT_ROW.schedule.changeLockAt,
      }),
    );

    expect(shapeOf(error)).toStrictEqual(LOCKED_ERROR);
    expect(prepared).toStrictEqual([]);
    expect(saved).toStrictEqual([]);
  });

  test('組み合わせ決定が始まった年はfinal_date_lockedで拒否する', async () => {
    const { service, saved } = setup({
      rows: [
        yearRowOf(2027, {
          status: 'drawing',
          drawStartedAt: new Date(NOW.getTime() - 1),
        }),
      ],
    });

    const error = await errorOf(
      service.update({
        adminId: SUPER_ADMIN_ID,
        year: 2027,
        finalDate: parseBusinessDate('2027-07-04'),
        expectedVersion: 0,
        now: NOW,
      }),
    );

    expect(shapeOf(error)).toStrictEqual(LOCKED_ERROR);
    expect(saved).toStrictEqual([]);
  });

  test('書き込みのlockedはfinal_date_lockedにし、読み直さない', async () => {
    const { service, calls } = setup({ rows: ALL_ROWS, saveResult: 'locked' });

    const error = await errorOf(
      service.update({
        adminId: SUPER_ADMIN_ID,
        year: 2027,
        finalDate: parseBusinessDate('2027-07-04'),
        expectedVersion: 2,
        now: NOW,
      }),
    );

    expect(shapeOf(error)).toStrictEqual(LOCKED_ERROR);
    expect(calls.at(-1)).toBe('save');
  });

  test('書き込みのversion_conflictはconflictのversion_conflictにし、最新の読み直しを案内する', async () => {
    const { service, calls } = setup({
      rows: ALL_ROWS,
      saveResult: 'version_conflict',
    });

    const error = await errorOf(
      service.update({
        adminId: SUPER_ADMIN_ID,
        year: 2027,
        finalDate: parseBusinessDate('2027-07-04'),
        expectedVersion: 1,
        now: NOW,
      }),
    );

    expect(shapeOf(error)).toStrictEqual({
      kind: 'conflict',
      code: 'version_conflict',
      message:
        '他の管理者が設定を変更しました。最新の内容を読み込んでから操作してください。',
      details: undefined,
    });
    expect(calls.at(-1)).toBe('save');
  });

  test('監査ログの準備の違反はそのまま投げ、保存しない', async () => {
    const failure = new AppError({
      kind: 'bad_request',
      code: 'validation_error',
      message: VALIDATION_MESSAGE,
    });
    const { service, saved } = setup({
      rows: ALL_ROWS,
      prepareError: failure,
    });

    const error = await errorOf(
      service.update({
        adminId: SUPER_ADMIN_ID,
        year: 2027,
        finalDate: parseBusinessDate('2027-07-04'),
        expectedVersion: 2,
        reason: 'あ'.repeat(501),
        now: NOW,
      }),
    );

    expect(error).toBe(failure);
    expect(saved).toStrictEqual([]);
  });
});
