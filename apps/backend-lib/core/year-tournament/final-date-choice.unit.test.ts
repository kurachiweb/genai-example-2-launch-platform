import { describe, expect, test } from 'bun:test';

import {
  addBusinessDays,
  type BusinessDate,
  businessWeekdayOf,
  fromBusinessDateTime,
  parseBusinessDate,
} from '../time/business-time.ts';
import {
  checkFinalDateChoice,
  editableYears,
  type FinalDateContext,
  finalDateChoices,
  isFinalDateChangeable,
  nextYearGapWarning,
} from './final-date-choice.ts';
import { defaultFinalDate, yearScheduleFor } from './year-schedule.ts';

const MILLISECONDS_PER_DAY = 86_400_000;

function date(value: string): BusinessDate {
  return parseBusinessDate(value);
}

function at(value: string, clock: string): Date {
  const [hour = 0, minute = 0] = clock.split(':').map(Number);
  return fromBusinessDateTime(date(value), { hour, minute });
}

function contextOf(
  overrides: Partial<FinalDateContext> = {},
): FinalDateContext {
  const year = overrides.year ?? 2027;
  return {
    year,
    now: at('2027-03-01', '10:00'),
    current: yearScheduleFor(year, defaultFinalDate(year)),
    drawStarted: false,
    previousFinalDate: date('2026-05-31'),
    nextExplicitFinalDate: null,
    ...overrides,
  };
}

describe('editableYears', () => {
  test('現在の業務日付の年と翌年を返す', () => {
    expect(editableYears(at('2027-03-01', '10:00'))).toEqual([2027, 2028]);
  });

  test('UTCで年が明けても業務日付の大晦日の間は前の年を現在の年とする', () => {
    const lastMinute = at('2026-12-31', '23:59');
    expect(lastMinute.getUTCFullYear()).toBe(2027);
    expect(editableYears(lastMinute)).toEqual([2026, 2027]);
    expect(editableYears(at('2027-01-01', '00:00'))).toEqual([2027, 2028]);
  });
});

describe('isFinalDateChangeable', () => {
  const changeLockAt = yearScheduleFor(2027, date('2027-05-30')).changeLockAt;

  test('変更期限の1ミリ秒前は変更でき、変更期限ちょうど以降は変更できない', () => {
    expect(
      isFinalDateChangeable(
        contextOf({ now: new Date(changeLockAt.getTime() - 1) }),
      ),
    ).toBe(true);
    expect(isFinalDateChangeable(contextOf({ now: changeLockAt }))).toBe(false);
  });

  test('組み合わせ決定が始まった年は変更期限より前でも変更できない', () => {
    expect(isFinalDateChangeable(contextOf({ drawStarted: true }))).toBe(false);
  });
});

describe('checkFinalDateChoice', () => {
  test('現在の年と翌年の日曜日で、8日後以降・前後の年との間隔の内なら受け付ける', () => {
    expect(checkFinalDateChoice(date('2027-06-06'), contextOf())).toBeNull();
    expect(
      checkFinalDateChoice(
        date('2028-05-28'),
        contextOf({ year: 2028, previousFinalDate: date('2027-05-30') }),
      ),
    ).toBeNull();
  });

  test.each([2026, 2029])(
    '現在の年と翌年以外の対象年(%d)はyear_not_editableで拒否する',
    (year) => {
      expect(
        checkFinalDateChoice(
          defaultFinalDate(year),
          contextOf({ year, previousFinalDate: null }),
        ),
      ).toBe('year_not_editable');
    },
  );

  test('日曜日でない日付はnot_sundayで拒否する', () => {
    expect(businessWeekdayOf(date('2027-06-05'))).toBe(6);
    expect(checkFinalDateChoice(date('2027-06-05'), contextOf())).toBe(
      'not_sunday',
    );
  });

  test('対象年の外の日曜日はout_of_yearで拒否する', () => {
    expect(checkFinalDateChoice(date('2028-01-02'), contextOf())).toBe(
      'out_of_year',
    );
  });

  describe('8日後の境界', () => {
    const sunday = date('2027-03-14');
    const startOfSunday = fromBusinessDateTime(sunday, { hour: 0, minute: 0 });
    const exactlyEightDaysBefore = new Date(
      startOfSunday.getTime() - 8 * MILLISECONDS_PER_DAY,
    );

    test('その日の0:00がちょうど8日後なら受け付ける', () => {
      expect(
        checkFinalDateChoice(
          sunday,
          contextOf({ now: exactlyEightDaysBefore }),
        ),
      ).toBeNull();
    });

    test('その日の0:00が8日後に1ミリ秒足りなければtoo_soonで拒否する', () => {
      expect(
        checkFinalDateChoice(
          sunday,
          contextOf({ now: new Date(exactlyEightDaysBefore.getTime() + 1) }),
        ),
      ).toBe('too_soon');
    });
  });

  describe('前年の決勝日からの間隔', () => {
    test('前年の決勝日の441日後の日曜日は受け付け、448日後(64週後)はtoo_far_from_previousで拒否する', () => {
      expect(checkFinalDateChoice(date('2027-08-15'), contextOf())).toBeNull();
      expect(checkFinalDateChoice(date('2027-08-22'), contextOf())).toBe(
        'too_far_from_previous',
      );
    });

    test('前年の決勝日から447日後は受け付け、448日後は拒否する', () => {
      const chosen = date('2027-08-22');
      expect(
        checkFinalDateChoice(
          chosen,
          contextOf({ previousFinalDate: addBusinessDays(chosen, -447) }),
        ),
      ).toBeNull();
      expect(
        checkFinalDateChoice(
          chosen,
          contextOf({ previousFinalDate: addBusinessDays(chosen, -448) }),
        ),
      ).toBe('too_far_from_previous');
    });

    test('前年の決勝日が設定されていない(初年度)なら間隔を検査しない', () => {
      expect(
        checkFinalDateChoice(
          date('2027-12-26'),
          contextOf({ previousFinalDate: null }),
        ),
      ).toBeNull();
    });
  });

  describe('翌年の設定済みの決勝日との間隔', () => {
    const now = at('2027-01-01', '12:00');
    const chosen = date('2027-03-14');

    test('翌年の決勝日が447日後なら受け付け、448日後ならtoo_far_from_nextで拒否する', () => {
      expect(
        checkFinalDateChoice(
          chosen,
          contextOf({
            now,
            nextExplicitFinalDate: addBusinessDays(chosen, 447),
          }),
        ),
      ).toBeNull();
      expect(
        checkFinalDateChoice(
          chosen,
          contextOf({
            now,
            nextExplicitFinalDate: addBusinessDays(chosen, 448),
          }),
        ),
      ).toBe('too_far_from_next');
    });

    test('翌年の設定済みの決勝日の448日前の日曜日は拒否し、441日前は受け付ける', () => {
      const context = contextOf({
        now,
        nextExplicitFinalDate: date('2028-05-28'),
      });
      expect(checkFinalDateChoice(date('2027-03-07'), context)).toBe(
        'too_far_from_next',
      );
      expect(checkFinalDateChoice(date('2027-03-14'), context)).toBeNull();
    });

    test('翌年が未設定なら既定の日との間隔では拒否しない', () => {
      expect(
        checkFinalDateChoice(
          date('2027-03-07'),
          contextOf({ now, nextExplicitFinalDate: null }),
        ),
      ).toBeNull();
    });
  });

  describe('変更期限と凍結', () => {
    const changeLockAt = yearScheduleFor(2027, date('2027-05-30')).changeLockAt;

    test('変更前の変更期限の1ミリ秒前は受け付け、変更期限ちょうどはlockedで拒否する', () => {
      expect(
        checkFinalDateChoice(
          date('2027-06-06'),
          contextOf({ now: new Date(changeLockAt.getTime() - 1) }),
        ),
      ).toBeNull();
      expect(
        checkFinalDateChoice(
          date('2027-06-06'),
          contextOf({ now: changeLockAt }),
        ),
      ).toBe('locked');
    });

    test('変更期限は変更後の日付でなく変更前の実効の日程で判定する', () => {
      expect(
        checkFinalDateChoice(
          date('2027-12-26'),
          contextOf({ now: changeLockAt }),
        ),
      ).toBe('locked');
    });

    test('組み合わせ決定が始まった年はlockedで拒否する', () => {
      expect(
        checkFinalDateChoice(
          date('2027-06-06'),
          contextOf({ drawStarted: true }),
        ),
      ).toBe('locked');
    });
  });

  describe('拒否の理由の順', () => {
    test('対象年の誤りは変更不可より先に返す', () => {
      expect(
        checkFinalDateChoice(
          date('2029-06-05'),
          contextOf({ year: 2029, drawStarted: true }),
        ),
      ).toBe('year_not_editable');
    });

    test('変更不可は日曜日でないことより先に返す', () => {
      expect(
        checkFinalDateChoice(
          date('2027-06-05'),
          contextOf({ drawStarted: true }),
        ),
      ).toBe('locked');
    });

    test('日曜日でないことは対象年の外より先に返す', () => {
      expect(checkFinalDateChoice(date('2028-01-01'), contextOf())).toBe(
        'not_sunday',
      );
    });

    test('対象年の外は8日後より前より先に返す', () => {
      expect(checkFinalDateChoice(date('2026-12-27'), contextOf())).toBe(
        'out_of_year',
      );
    });

    test('8日後より前は前年の決勝日の間隔の超過より先に返す', () => {
      expect(
        checkFinalDateChoice(
          date('2027-03-28'),
          contextOf({
            now: at('2027-03-25', '00:00'),
            previousFinalDate: date('2026-01-04'),
          }),
        ),
      ).toBe('too_soon');
    });

    test('前年の決勝日の間隔の超過は翌年の決勝日の間隔の超過より先に返す', () => {
      expect(
        checkFinalDateChoice(
          date('2027-08-22'),
          contextOf({ nextExplicitFinalDate: date('2028-11-12') }),
        ),
      ).toBe('too_far_from_previous');
    });
  });
});

describe('finalDateChoices', () => {
  test('対象年の日曜日のうち検証を通る日を昇順に返す', () => {
    const choices = finalDateChoices(contextOf());
    expect(choices[0]).toBe(date('2027-03-14'));
    expect(choices.at(-1)).toBe(date('2027-08-15'));
    expect(choices).toHaveLength(23);
    expect(choices.every((choice) => businessWeekdayOf(choice) === 7)).toBe(
      true,
    );
    expect([...choices].sort()).toEqual([...choices]);
    expect(choices).toContain(date('2027-05-30'));
  });

  test('初年度で翌年が未設定なら8日後以降の対象年の最後の日曜日まで返す', () => {
    const choices = finalDateChoices(
      contextOf({ year: 2028, previousFinalDate: null }),
    );
    expect(choices[0]).toBe(date('2028-01-02'));
    expect(choices.at(-1)).toBe(date('2028-12-31'));
    expect(choices).toHaveLength(53);
  });

  test('翌年の設定済みの決勝日の448日前以前を除く', () => {
    const choices = finalDateChoices(
      contextOf({
        now: at('2027-01-01', '12:00'),
        nextExplicitFinalDate: date('2028-05-28'),
      }),
    );
    expect(choices[0]).toBe(date('2027-03-14'));
  });

  test.each<[string, Partial<FinalDateContext>]>([
    [
      '変更期限以降',
      {
        now: yearScheduleFor(2027, date('2027-05-30')).changeLockAt,
      },
    ],
    ['組み合わせ決定の開始後', { drawStarted: true }],
    ['現在の年と翌年以外の対象年', { year: 2029, previousFinalDate: null }],
  ])('%sは変更できないため空を返す', (_label, overrides) => {
    expect(finalDateChoices(contextOf(overrides))).toEqual([]);
  });
});

describe('nextYearGapWarning', () => {
  const finalDate = date('2027-03-14');

  test('翌年の既定の日が448日後以降ならその日を返す', () => {
    expect(
      nextYearGapWarning({
        finalDate,
        nextYearDefault: addBusinessDays(finalDate, 448),
      }),
    ).toBe(date('2028-06-04'));
    expect(
      nextYearGapWarning({
        finalDate: date('2027-03-07'),
        nextYearDefault: defaultFinalDate(2028),
      }),
    ).toBe(date('2028-05-28'));
  });

  test('翌年の既定の日が447日後までならnullを返す', () => {
    expect(
      nextYearGapWarning({
        finalDate,
        nextYearDefault: addBusinessDays(finalDate, 447),
      }),
    ).toBeNull();
    expect(
      nextYearGapWarning({
        finalDate: date('2027-05-30'),
        nextYearDefault: defaultFinalDate(2028),
      }),
    ).toBeNull();
  });

  test('翌年が設定済み(既定の日が無い)ならnullを返す', () => {
    expect(nextYearGapWarning({ finalDate, nextYearDefault: null })).toBeNull();
  });
});
