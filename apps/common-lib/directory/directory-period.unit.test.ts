import { describe, expect, test } from 'bun:test';

import {
  PERIOD_PRESETS,
  type PeriodPreset,
  formatPeriodLabel,
  isBusinessDateString,
  periodKeyOf,
  presetRange,
  validateCustomRange,
} from './directory-period.ts';

describe('PERIOD_PRESETS', () => {
  test('昨日・今週・今月・今年・全期間の順に並べる', () => {
    expect(PERIOD_PRESETS).toEqual([
      'yesterday',
      'week',
      'month',
      'year',
      'all',
    ]);
    expect(Object.isFrozen(PERIOD_PRESETS)).toBe(true);
  });
});

describe('isBusinessDateString', () => {
  test.each(['2026-09-14', '2028-02-29', '2026-12-31', '0001-01-01'])(
    '実在する日付%sを業務日付の文字列とみなす',
    (value) => {
      expect(isBusinessDateString(value)).toBe(true);
    },
  );

  test.each([
    '2026-02-29',
    '2100-02-29',
    '2026-04-31',
    '2026-9-14',
    '20260914',
    '2026-09-14 ',
    '0000-01-01',
    '',
  ])('実在しない日付や形の違う値%sを業務日付の文字列とみなさない', (value) => {
    expect(isBusinessDateString(value)).toBe(false);
  });

  test('文字列でない値を業務日付の文字列とみなさない', () => {
    expect(isBusinessDateString(20260914)).toBe(false);
    expect(isBusinessDateString(undefined)).toBe(false);
  });
});

describe('presetRange', () => {
  describe('昨日', () => {
    test.each([
      ['月の途中', '2026-09-17', '2026-09-16'],
      ['月初', '2026-03-01', '2026-02-28'],
      ['閏年の3月1日', '2028-03-01', '2028-02-29'],
      ['年初', '2026-01-01', '2025-12-31'],
    ])('%sの今日から前日の1日を返す', (_, today, yesterday) => {
      expect(presetRange('yesterday', today)).toStrictEqual({
        from: yesterday,
        to: yesterday,
      });
    });
  });

  describe('今週', () => {
    test.each([
      ['月曜日', '2026-09-14'],
      ['木曜日', '2026-09-17'],
      ['日曜日', '2026-09-20'],
    ])('今日が%sなら月曜日から日曜日までの週全体を返す', (_, today) => {
      expect(presetRange('week', today)).toStrictEqual({
        from: '2026-09-14',
        to: '2026-09-20',
      });
    });

    test('年をまたぐ週は前年の月曜日から今年の日曜日までにする', () => {
      expect(presetRange('week', '2026-01-01')).toStrictEqual({
        from: '2025-12-29',
        to: '2026-01-04',
      });
    });
  });

  describe('今月', () => {
    test.each([
      ['30日の月の月末', '2026-09-30', '2026-09-01', '2026-09-30'],
      ['31日の月の月初', '2026-10-01', '2026-10-01', '2026-10-31'],
      ['平年の2月', '2026-02-10', '2026-02-01', '2026-02-28'],
      ['閏年の2月', '2028-02-10', '2028-02-01', '2028-02-29'],
      ['年末', '2026-12-31', '2026-12-01', '2026-12-31'],
    ])('%sの今日から月の初日から末日までを返す', (_, today, from, to) => {
      expect(presetRange('month', today)).toStrictEqual({ from, to });
    });
  });

  describe('今年', () => {
    test.each(['2026-01-01', '2026-09-17', '2026-12-31'])(
      '今日が%sなら1月1日から12月31日までを返す',
      (today) => {
        expect(presetRange('year', today)).toStrictEqual({
          from: '2026-01-01',
          to: '2026-12-31',
        });
      },
    );
  });

  test('全期間は開始日も終了日も持たない', () => {
    expect(presetRange('all', '2026-09-17')).toStrictEqual({});
  });

  test('業務日付の形でない今日を受け取らない', () => {
    expect(() => presetRange('week', '2026-02-30')).toThrow(RangeError);
  });
});

describe('periodKeyOf', () => {
  const today = '2026-09-17';

  test.each(PERIOD_PRESETS.map((preset): [PeriodPreset] => [preset]))(
    '%sの範囲をそのプリセットと判定する',
    (preset) => {
      expect(periodKeyOf(presetRange(preset, today), today)).toBe(preset);
    },
  );

  test('開始日も終了日も無ければ全期間と判定する', () => {
    expect(periodKeyOf({ from: undefined, to: undefined }, today)).toBe('all');
  });

  test.each<[string, { from?: string; to?: string }]>([
    [
      '先週の範囲(過去に共有された今週のリンク)',
      { from: '2026-09-07', to: '2026-09-13' },
    ],
    ['週の途中までの範囲', { from: '2026-09-14', to: '2026-09-17' }],
    ['開始日だけ', { from: '2026-09-01' }],
    ['終了日だけ', { to: '2026-09-30' }],
    ['今日だけ', { from: today, to: today }],
    ['前年の範囲', { from: '2025-01-01', to: '2025-12-31' }],
  ])('プリセットと一致しない%sを指定の期間と判定する', (_, range) => {
    expect(periodKeyOf(range, today)).toBe('custom');
  });
});

describe('validateCustomRange', () => {
  const today = '2026-09-17';

  test('今日以前で開始日が終了日以前なら誤りを返さない', () => {
    expect(
      validateCustomRange({ from: '2026-09-01', to: today, today }),
    ).toStrictEqual({});
  });

  test('片方だけの指定と、どちらも無い指定を許す', () => {
    expect(validateCustomRange({ from: '2026-09-01', today })).toStrictEqual(
      {},
    );
    expect(validateCustomRange({ to: '2026-09-01', today })).toStrictEqual({});
    expect(validateCustomRange({ today })).toStrictEqual({});
  });

  test('空の入力欄を指定の無い側として扱う', () => {
    expect(
      validateCustomRange({ from: '', to: '2026-09-01', today }),
    ).toStrictEqual({});
  });

  test('未来の開始日を示す', () => {
    expect(validateCustomRange({ from: '2026-09-18', today })).toStrictEqual({
      from: 'future',
    });
  });

  test('未来の終了日を示す', () => {
    expect(
      validateCustomRange({ from: '2026-09-01', to: '2027-01-01', today }),
    ).toStrictEqual({ to: 'future' });
  });

  test('開始日と終了日が同じ日なら逆順としない', () => {
    expect(
      validateCustomRange({ from: '2026-09-10', to: '2026-09-10', today }),
    ).toStrictEqual({});
  });

  test('開始日が終了日より後なら逆順を示す', () => {
    expect(
      validateCustomRange({ from: '2026-09-10', to: '2026-09-09', today }),
    ).toStrictEqual({ order: 'reversed' });
  });

  test('未来と逆順を同時に示す', () => {
    expect(
      validateCustomRange({ from: '2026-12-01', to: '2026-11-01', today }),
    ).toStrictEqual({ from: 'future', to: 'future', order: 'reversed' });
  });
});

describe('formatPeriodLabel', () => {
  const today = '2026-09-17';

  test('開始日と終了日の期間を「9月14日〜9月20日」と示す', () => {
    expect(
      formatPeriodLabel({ from: '2026-09-14', to: '2026-09-20' }, today),
    ).toBe('9月14日〜9月20日');
  });

  test('開始日だけの期間を「9月1日以降」と示す', () => {
    expect(formatPeriodLabel({ from: '2026-09-01' }, today)).toBe('9月1日以降');
  });

  test('終了日だけの期間を「9月20日以前」と示す', () => {
    expect(formatPeriodLabel({ to: '2026-09-20' }, today)).toBe('9月20日以前');
  });

  test('開始日と終了日が同じ日の期間はその日だけを示す', () => {
    expect(
      formatPeriodLabel({ from: '2026-09-10', to: '2026-09-10' }, today),
    ).toBe('9月10日');
  });

  test('今年でない日付だけに年を付ける', () => {
    expect(
      formatPeriodLabel({ from: '2025-12-29', to: '2026-01-04' }, today),
    ).toBe('2025年12月29日〜1月4日');
    expect(
      formatPeriodLabel({ from: '2025-01-01', to: '2025-12-31' }, today),
    ).toBe('2025年1月1日〜2025年12月31日');
    expect(formatPeriodLabel({ to: '2027-01-05' }, today)).toBe(
      '2027年1月5日以前',
    );
  });

  test('開始日も終了日も無ければ全期間と示す', () => {
    expect(formatPeriodLabel({}, today)).toBe('全期間');
  });

  test('業務日付の形でない日付を受け取らない', () => {
    expect(() => formatPeriodLabel({ from: '2026-02-30' }, today)).toThrow(
      RangeError,
    );
  });
});
