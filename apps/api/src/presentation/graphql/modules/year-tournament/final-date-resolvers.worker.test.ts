import { describe, expect, test } from 'vitest';

import { AUDIT_REASON_MAX } from '../../../../../common-lib/admin/admin-input-rules.ts';
import { YEAR_FINAL_DATE_UPDATE_ACTION } from '../../../../../common-lib/admin/audit-actions/tournament-year.ts';
import {
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../../../../lib/core/time/business-time.ts';
import { formatFinalDateLabel } from '../../../../../lib/core/year-tournament/final-date-label.ts';
import {
  type YearSchedule,
  yearScheduleFor,
} from '../../../../../lib/core/year-tournament/year-schedule.ts';
import {
  defaultScheduleOf,
  insertYearTournaments,
} from '../../../../../lib/workers/year-tournament/testing/year-tournament-fixtures.ts';
import type {
  GatewayCallOptions,
  GatewayResponse,
} from '../../../../../test/support/graphql-gateway.ts';
import {
  asYearFinalDateAdmin,
  codesOf,
  detailsOf,
  fetchYearFinalDateSettings,
  installYearFinalDateGraphQLTest,
  markYearFinalDateUpdatedBy,
  readAuditLogReasons,
  readYearTournamentRow,
  setYearFinalDateTestNow,
  signInYearFinalDateAdmins,
  updateYearFinalDate,
  YEAR_FINAL_DATE_ADMINS,
  YEAR_FINAL_DATE_TEST_NOW,
  type YearFinalDateSettingFields,
} from '../../../../../test/support/year-final-date-graphql-operations.ts';
import { YEAR_FINAL_DATE_ERRORS } from '../../../../application/year-tournament/year-final-date-errors.ts';
import {
  adminIdOf,
  insertInvitedAdmin,
  readAuditLogSummaries,
  readAuditLogTargetIds,
} from '../../../../infrastructure/admin/testing/admin-store-fixtures.ts';

const VALIDATION_ERROR_MESSAGE = '入力内容を確認してください。';

const { superAdmin, moderator, viewer, secondSuperAdmin, invited, deleted } =
  YEAR_FINAL_DATE_ADMINS;

// 2027年の既定の決勝日は5/30(日)、2028年は5/28(日)
const SCHEDULE_2026 = defaultScheduleOf(2026);
const SCHEDULE_2027 = defaultScheduleOf(2027);
const DEFAULT_2028 = defaultScheduleOf(2028).finalDate;

const EARLIER_2027 = parseBusinessDate('2027-05-16');

// 監査ログのIDは発生の時刻の順に振られるため、続けて保存するテストは時計を進める
const MINUTE_MS = 60_000;

// 2027年の日曜日は1/3から12/26までの52日
const SUNDAYS_2027_COUNT = 52;

installYearFinalDateGraphQLTest();

const nicknameOf = (adminIndex: number): string =>
  `管理者${String(adminIndex)}`;

const OPERATIONS: readonly {
  readonly name: string;
  readonly call: (options: GatewayCallOptions) => Promise<GatewayResponse>;
}[] = [
  {
    name: 'yearFinalDateSettings',
    call: (options) => fetchYearFinalDateSettings(options),
  },
  {
    name: 'updateYearFinalDate',
    call: (options) =>
      updateYearFinalDate(
        { year: 2027, finalDate: EARLIER_2027, expectedVersion: 0 },
        options,
      ),
  },
];

function scheduleFieldsOf(schedule: YearSchedule) {
  return {
    year: schedule.year,
    finalDate: schedule.finalDate,
    acceptUntil: schedule.acceptUntil.toISOString(),
    deadlineAt: schedule.deadlineAt.toISOString(),
    drawAt: schedule.drawAt.toISOString(),
    changeLockAt: schedule.changeLockAt.toISOString(),
  };
}

async function expectNothingWritten(): Promise<void> {
  const row = await readYearTournamentRow(2027);
  expect(row?.finalDateSource ?? 'default').toBe('default');
  expect(row?.finalDateVersion ?? 0).toBe(0);
  await expect(readAuditLogSummaries()).resolves.toEqual([]);
}

describe('呼び出し元とログイン', () => {
  test.each(OPERATIONS)(
    '$nameは、最上位管理者のセッションでも利用者側の呼び出し元からならforbiddenで拒否し、決勝実施日を変えない',
    async ({ name, call }) => {
      const response = await call({
        ...asYearFinalDateAdmin(superAdmin),
        caller: 'client',
      });

      expect(codesOf(response)).toEqual(['forbidden']);
      expect(response.data?.[name] ?? null).toBeNull();
      await expectNothingWritten();
    },
  );

  test.each(OPERATIONS)(
    '$nameは、管理者側の呼び出し元でも未ログインならunauthenticatedで拒否し、決勝実施日を変えない',
    async ({ name, call }) => {
      const response = await call({ caller: 'admin' });

      expect(codesOf(response)).toEqual(['unauthenticated']);
      expect(response.data?.[name] ?? null).toBeNull();
      await expectNothingWritten();
    },
  );
});

describe('yearFinalDateSettings', () => {
  test.each([
    ['閲覧のみ', viewer],
    ['モデレーター', moderator],
    ['最上位管理者', superAdmin],
  ])(
    '%sの管理者に、現在の年(変更期限の後)と翌年(既定の日・選べる日曜日)の設定を照会の時刻とともに返す',
    async (_, adminIndex) => {
      const response = await fetchYearFinalDateSettings(
        asYearFinalDateAdmin(adminIndex),
      );

      expect(response.errors).toBeUndefined();
      const settings = response.data?.yearFinalDateSettings;
      expect(settings?.serverTime).toBe(YEAR_FINAL_DATE_TEST_NOW.toISOString());
      expect(settings?.settings).toEqual([
        {
          ...scheduleFieldsOf(SCHEDULE_2026),
          source: 'DEFAULT',
          changeable: false,
          choices: [],
          previousYearFinalDate: null,
          nextYearFinalDate: SCHEDULE_2027.finalDate,
          nextYearSource: 'DEFAULT',
          nextYearGapWarningDate: null,
          version: 0,
          updatedAt: null,
          updatedBy: null,
        },
        {
          ...scheduleFieldsOf(SCHEDULE_2027),
          source: 'DEFAULT',
          changeable: true,
          choices: expect.any(Array) as string[],
          previousYearFinalDate: null,
          nextYearFinalDate: DEFAULT_2028,
          nextYearSource: 'DEFAULT',
          nextYearGapWarningDate: null,
          version: 0,
          updatedAt: null,
          updatedBy: null,
        },
      ]);
      const choices = settings?.settings[1]?.choices ?? [];
      expect(choices).toHaveLength(SUNDAYS_2027_COUNT);
      expect(choices[0]).toBe('2027-01-03');
      expect(choices.at(-1)).toBe('2027-12-26');
    },
  );

  test('前年の行があれば前年の決勝実施日を返し、その64週間後以降の日曜日を選べる日付から除く', async () => {
    await insertYearTournaments([{ index: 1, year: 2026 }]);

    const response = await fetchYearFinalDateSettings(
      asYearFinalDateAdmin(viewer),
    );

    expect(response.errors).toBeUndefined();
    const setting = response.data?.yearFinalDateSettings?.settings[1];
    expect(setting?.previousYearFinalDate).toBe(SCHEDULE_2026.finalDate);
    expect(setting?.choices.at(-1)).toBe('2027-08-15');
  });

  test('決勝実施日を早めて翌年の既定の日まで64週以上空くなら、翌年の既定の日を注意として返す', async () => {
    const saved = await updateYearFinalDate(
      { year: 2027, finalDate: '2027-01-17', expectedVersion: 0 },
      asYearFinalDateAdmin(superAdmin),
    );
    expect(saved.errors).toBeUndefined();

    const response = await fetchYearFinalDateSettings(
      asYearFinalDateAdmin(viewer),
    );

    expect(response.errors).toBeUndefined();
    expect(
      response.data?.yearFinalDateSettings?.settings[1]?.nextYearGapWarningDate,
    ).toBe(DEFAULT_2028);
  });

  test('最上位管理者が保存した後は、閲覧のみの管理者にも設定済みの日・進んだ版・変更の日時と変更した管理者のニックネームを返す', async () => {
    const saved = await updateYearFinalDate(
      { year: 2027, finalDate: EARLIER_2027, expectedVersion: 0 },
      asYearFinalDateAdmin(superAdmin),
    );
    expect(saved.errors).toBeUndefined();

    const response = await fetchYearFinalDateSettings(
      asYearFinalDateAdmin(viewer),
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.yearFinalDateSettings?.settings[1]).toMatchObject({
      ...scheduleFieldsOf(yearScheduleFor(2027, EARLIER_2027)),
      source: 'EXPLICIT',
      version: 1,
      updatedAt: YEAR_FINAL_DATE_TEST_NOW.toISOString(),
      updatedBy: { nickname: nicknameOf(superAdmin) },
    });
    expect(response.data?.yearFinalDateSettings?.settings[0]).toMatchObject({
      nextYearFinalDate: EARLIER_2027,
      nextYearSource: 'EXPLICIT',
    });
  });

  test.each([
    ['削除済み', deleted, () => Promise.resolve()],
    ['招待中', invited, () => insertInvitedAdmin(invited)],
  ])(
    '最後に保存した管理者が%sなら、変更の日時を返し、ニックネームだけをnullにする',
    async (_, adminIndex, arrange) => {
      await arrange();
      await insertYearTournaments([{ index: 2, year: 2027 }]);
      const at = new Date('2026-11-20T03:00:00.000Z');
      await markYearFinalDateUpdatedBy(2027, adminIdOf(adminIndex), at);

      const response = await fetchYearFinalDateSettings(
        asYearFinalDateAdmin(viewer),
      );

      expect(response.errors).toBeUndefined();
      expect(response.data?.yearFinalDateSettings?.settings[1]).toMatchObject({
        source: 'EXPLICIT',
        version: 1,
        updatedAt: at.toISOString(),
        updatedBy: { nickname: null },
      });
    },
  );
});

describe('updateYearFinalDate', () => {
  test.each([
    ['閲覧のみ', viewer],
    ['モデレーター', moderator],
  ])(
    '%sの管理者はforbiddenで拒否し、決勝実施日も監査ログも変えない',
    async (_, adminIndex) => {
      const response = await updateYearFinalDate(
        {
          year: 2027,
          finalDate: EARLIER_2027,
          expectedVersion: 0,
          reason: '権限の無い変更',
        },
        asYearFinalDateAdmin(adminIndex),
      );

      expect(codesOf(response)).toEqual(['forbidden']);
      expect(response.data?.updateYearFinalDate ?? null).toBeNull();
      await expectNothingWritten();
    },
  );

  test('最上位管理者は読み取った版と一致すれば保存し、新しい日程・進んだ版・自分のニックネームを返し、監査ログへ変更前後の日付と理由を記録する', async () => {
    const reason = '欧州リーグの最終節に合わせる';

    const response = await updateYearFinalDate(
      { year: 2027, finalDate: EARLIER_2027, expectedVersion: 0, reason },
      asYearFinalDateAdmin(superAdmin),
    );

    expect(response.errors).toBeUndefined();
    const expected: YearFinalDateSettingFields = {
      ...scheduleFieldsOf(yearScheduleFor(2027, EARLIER_2027)),
      source: 'EXPLICIT',
      changeable: true,
      choices: expect.any(Array) as string[],
      previousYearFinalDate: null,
      nextYearFinalDate: DEFAULT_2028,
      nextYearSource: 'DEFAULT',
      nextYearGapWarningDate: null,
      version: 1,
      updatedAt: YEAR_FINAL_DATE_TEST_NOW.toISOString(),
      updatedBy: { nickname: nicknameOf(superAdmin) },
    };
    expect(response.data?.updateYearFinalDate).toEqual(expected);
    await expect(readYearTournamentRow(2027)).resolves.toEqual({
      finalDate: EARLIER_2027,
      finalDateSource: 'explicit',
      finalDateVersion: 1,
      finalDateUpdatedByAdminId: adminIdOf(superAdmin),
    });
    await expect(readAuditLogSummaries()).resolves.toEqual([
      {
        id: expect.any(String) as string,
        operatorAdminId: adminIdOf(superAdmin),
        action: YEAR_FINAL_DATE_UPDATE_ACTION.name,
        detail: {
          year: '2027',
          fromDate: SCHEDULE_2027.finalDate,
          toDate: EARLIER_2027,
          fromSource: 'default',
        },
      },
    ]);
    await expect(readAuditLogTargetIds()).resolves.toEqual([
      'year-final-date:2027',
    ]);
    await expect(readAuditLogReasons()).resolves.toEqual([reason]);
  });

  test('保存した版から続けて保存すると版を進め、理由を省いても保存できる', async () => {
    const first = await updateYearFinalDate(
      { year: 2027, finalDate: EARLIER_2027, expectedVersion: 0 },
      asYearFinalDateAdmin(superAdmin),
    );
    expect(first.errors).toBeUndefined();
    const later = new Date(YEAR_FINAL_DATE_TEST_NOW.getTime() + MINUTE_MS);
    setYearFinalDateTestNow(later);

    const response = await updateYearFinalDate(
      { year: 2027, finalDate: '2027-06-06', expectedVersion: 1 },
      asYearFinalDateAdmin(secondSuperAdmin),
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.updateYearFinalDate).toMatchObject({
      finalDate: '2027-06-06',
      version: 2,
      updatedAt: later.toISOString(),
      updatedBy: { nickname: nicknameOf(secondSuperAdmin) },
    });
    await expect(readAuditLogSummaries()).resolves.toEqual([
      expect.objectContaining({ operatorAdminId: adminIdOf(superAdmin) }),
      expect.objectContaining({
        operatorAdminId: adminIdOf(secondSuperAdmin),
        detail: {
          year: '2027',
          fromDate: EARLIER_2027,
          toDate: '2027-06-06',
          fromSource: 'explicit',
        },
      }),
    ]);
    await expect(readAuditLogReasons()).resolves.toEqual([null, null]);
  });

  describe('選べない日付', () => {
    test.each([
      {
        name: '現在の年と翌年以外の対象年',
        input: { year: 2028, finalDate: DEFAULT_2028 },
        field: 'input.year',
        code: 'year_not_editable',
        message: '現在の年か翌年を選んでください。',
      },
      {
        name: '日曜日でない日付',
        input: { year: 2027, finalDate: '2027-05-29' },
        field: 'input.finalDate',
        code: 'not_sunday',
        message: '日曜日を選んでください。',
      },
      {
        name: '対象年の外の日付',
        input: { year: 2027, finalDate: '2028-01-02' },
        field: 'input.finalDate',
        code: 'out_of_year',
        message: '対象年の日付を選んでください。',
      },
    ])(
      '$nameは理由$codeのvalidation_errorで拒否し、何も書かない',
      async ({ input, field, code, message }) => {
        const response = await updateYearFinalDate(
          { ...input, expectedVersion: 0 },
          asYearFinalDateAdmin(superAdmin),
        );

        expect(codesOf(response)).toEqual(['validation_error']);
        expect(response.errors?.[0]?.message).toBe(VALIDATION_ERROR_MESSAGE);
        expect(detailsOf(response)).toEqual([{ field, code, message }]);
        expect(response.data?.updateYearFinalDate ?? null).toBeNull();
        await expectNothingWritten();
      },
    );

    test('その日の0:00が現在から8日後より前の日付は理由too_soonのvalidation_errorで拒否する', async () => {
      setYearFinalDateTestNow(
        fromBusinessDateTime(parseBusinessDate('2027-05-01'), {
          hour: 12,
          minute: 0,
        }),
      );
      await signInYearFinalDateAdmins();

      const response = await updateYearFinalDate(
        { year: 2027, finalDate: '2027-05-09', expectedVersion: 0 },
        asYearFinalDateAdmin(superAdmin),
      );

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(detailsOf(response)).toEqual([
        {
          field: 'input.finalDate',
          code: 'too_soon',
          message: '現在から8日後以降の日付を選んでください。',
        },
      ]);
      await expectNothingWritten();
    });

    test('前年の決勝実施日の64週間後の日付は理由too_far_from_previousのvalidation_errorで拒否する', async () => {
      await insertYearTournaments([{ index: 1, year: 2026 }]);

      const response = await updateYearFinalDate(
        { year: 2027, finalDate: '2027-08-22', expectedVersion: 0 },
        asYearFinalDateAdmin(superAdmin),
      );

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(detailsOf(response)).toEqual([
        {
          field: 'input.finalDate',
          code: 'too_far_from_previous',
          message: `前年の決勝実施日(${formatFinalDateLabel(SCHEDULE_2026.finalDate)})から64週以上空く日付は選べません。`,
        },
      ]);
      await expectNothingWritten();
    });

    test('設定済みの翌年の決勝実施日まで64週以上空く日付は理由too_far_from_nextのvalidation_errorで拒否する', async () => {
      const next = yearScheduleFor(2028, parseBusinessDate('2028-08-20'));
      await insertYearTournaments([
        {
          index: 3,
          year: 2028,
          columns: {
            finalDate: next.finalDate,
            finalDateSource: 'explicit',
            finalDateVersion: 1,
            deadlineDate: next.deadlineDate,
            acceptUntil: next.acceptUntil,
            deadlineAt: next.deadlineAt,
            drawAt: next.drawAt,
            changeLockAt: next.changeLockAt,
          },
        },
      ]);

      const response = await updateYearFinalDate(
        { year: 2027, finalDate: '2027-05-23', expectedVersion: 0 },
        asYearFinalDateAdmin(superAdmin),
      );

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(detailsOf(response)).toEqual([
        {
          field: 'input.finalDate',
          code: 'too_far_from_next',
          message: `翌年の決勝実施日(${formatFinalDateLabel(next.finalDate)})まで64週以上空く日付は選べません。`,
        },
      ]);
      await expectNothingWritten();
    });
  });

  describe('入力の形式', () => {
    test('理由が501書記素ならvalidation_errorで拒否し、何も書かない', async () => {
      const response = await updateYearFinalDate(
        {
          year: 2027,
          finalDate: EARLIER_2027,
          expectedVersion: 0,
          reason: 'あ'.repeat(AUDIT_REASON_MAX + 1),
        },
        asYearFinalDateAdmin(superAdmin),
      );

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(detailsOf(response)).toEqual([
        {
          field: 'input.reason',
          code: 'custom',
          message: `理由は${String(AUDIT_REASON_MAX)}文字以内で入力してください。`,
        },
      ]);
      await expectNothingWritten();
    });

    test('理由が500書記素なら保存する', async () => {
      const reason = '👨‍👩‍👧'.repeat(AUDIT_REASON_MAX);

      const response = await updateYearFinalDate(
        { year: 2027, finalDate: EARLIER_2027, expectedVersion: 0, reason },
        asYearFinalDateAdmin(superAdmin),
      );

      expect(response.errors).toBeUndefined();
      await expect(readAuditLogReasons()).resolves.toEqual([reason]);
    });

    test('業務日付の形式でない決勝実施日と負の版はvalidation_errorで拒否し、何も書かない', async () => {
      const response = await updateYearFinalDate(
        { year: 2027, finalDate: '2027-5-16', expectedVersion: -1 },
        asYearFinalDateAdmin(superAdmin),
      );

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(detailsOf(response)).toEqual([
        {
          field: 'input.finalDate',
          code: 'custom',
          message: '日付の指定が正しくありません。',
        },
        {
          field: 'input.expectedVersion',
          code: 'too_small',
          message: '版は0以上の整数で指定してください。',
        },
      ]);
      await expectNothingWritten();
    });
  });

  describe('変更期限と競合', () => {
    test('変更期限を過ぎた現在の年はfinal_date_lockedで拒否し、何も書かない', async () => {
      const response = await updateYearFinalDate(
        { year: 2026, finalDate: '2026-12-27', expectedVersion: 0 },
        asYearFinalDateAdmin(superAdmin),
      );

      expect(codesOf(response)).toEqual(['final_date_locked']);
      expect(response.errors?.[0]?.message).toBe(
        YEAR_FINAL_DATE_ERRORS.final_date_locked.message,
      );
      expect(response.data?.updateYearFinalDate ?? null).toBeNull();
      await expect(readAuditLogSummaries()).resolves.toEqual([]);
    });

    test('組み合わせ決定が始まった年は変更期限の前でもfinal_date_lockedで拒否し、何も書かない', async () => {
      await insertYearTournaments([
        {
          index: 2,
          year: 2027,
          columns: {
            status: 'drawing',
            drawStartedAt: YEAR_FINAL_DATE_TEST_NOW,
          },
        },
      ]);

      const response = await updateYearFinalDate(
        { year: 2027, finalDate: EARLIER_2027, expectedVersion: 0 },
        asYearFinalDateAdmin(superAdmin),
      );

      expect(codesOf(response)).toEqual(['final_date_locked']);
      await expectNothingWritten();
    });

    test('他の最上位管理者が同じ版から先に保存していたらversion_conflictで拒否し、決勝実施日も監査ログも変えない', async () => {
      const first = await updateYearFinalDate(
        { year: 2027, finalDate: EARLIER_2027, expectedVersion: 0 },
        asYearFinalDateAdmin(secondSuperAdmin),
      );
      expect(first.errors).toBeUndefined();
      const before = await readYearTournamentRow(2027);

      const response = await updateYearFinalDate(
        { year: 2027, finalDate: '2027-06-06', expectedVersion: 0 },
        asYearFinalDateAdmin(superAdmin),
      );

      expect(response.status).toBe(200);
      expect(codesOf(response)).toEqual(['version_conflict']);
      expect(response.errors?.[0]?.message).toBe(
        YEAR_FINAL_DATE_ERRORS.version_conflict.message,
      );
      expect(response.data?.updateYearFinalDate ?? null).toBeNull();
      await expect(readYearTournamentRow(2027)).resolves.toEqual(before);
      await expect(readAuditLogSummaries()).resolves.toHaveLength(1);
    });

    test('翌年が保存された後の古い画面からの現在の年の保存は、自分の年の版が一致しても保存した翌年の日で検証し直す', async () => {
      const currentYearStart = fromBusinessDateTime(
        parseBusinessDate('2027-03-01'),
        { hour: 12, minute: 0 },
      );
      setYearFinalDateTestNow(currentYearStart);
      await signInYearFinalDateAdmins();
      const stale = await fetchYearFinalDateSettings(
        asYearFinalDateAdmin(superAdmin),
      );
      expect(stale.data?.yearFinalDateSettings?.settings[0]).toMatchObject({
        year: 2027,
        version: 0,
        choices: expect.arrayContaining([EARLIER_2027]) as string[],
      });
      const nextYear = await updateYearFinalDate(
        { year: 2028, finalDate: '2028-08-13', expectedVersion: 0 },
        asYearFinalDateAdmin(secondSuperAdmin),
      );
      expect(nextYear.errors).toBeUndefined();
      setYearFinalDateTestNow(new Date(currentYearStart.getTime() + MINUTE_MS));
      await signInYearFinalDateAdmins();

      const tooEarly = await updateYearFinalDate(
        { year: 2027, finalDate: EARLIER_2027, expectedVersion: 0 },
        asYearFinalDateAdmin(superAdmin),
      );
      const accepted = await updateYearFinalDate(
        { year: 2027, finalDate: '2027-06-06', expectedVersion: 0 },
        asYearFinalDateAdmin(superAdmin),
      );

      expect(detailsOf(tooEarly)).toEqual([
        expect.objectContaining({ code: 'too_far_from_next' }),
      ]);
      expect(accepted.errors).toBeUndefined();
      expect(accepted.data?.updateYearFinalDate).toMatchObject({
        year: 2027,
        finalDate: '2027-06-06',
        version: 1,
        nextYearFinalDate: '2028-08-13',
      });
    });
  });
});
