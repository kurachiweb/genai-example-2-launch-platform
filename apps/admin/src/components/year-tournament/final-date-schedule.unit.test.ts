import { describe, expect, test } from 'bun:test';

import { NEXT_YEAR_SETTING, settingOf } from './final-date-fixtures.ts';
import { scheduleOfChoice } from './final-date-schedule.ts';

describe('選んだ決勝実施日の受付期限と組み合わせ決定', () => {
  test('後の日曜日を選ぶと、現在の受付期限と組み合わせ決定を同じ日数だけ後へずらす', () => {
    expect(scheduleOfChoice(NEXT_YEAR_SETTING, '2027-06-06')).toStrictEqual({
      acceptUntil: new Date('2027-06-01T07:00:00.000Z'),
      drawAt: new Date('2027-06-01T07:45:00.000Z'),
    });
  });

  test('前の日曜日を選ぶと、同じ日数だけ前へずらす', () => {
    expect(scheduleOfChoice(NEXT_YEAR_SETTING, '2027-05-23')).toStrictEqual({
      acceptUntil: new Date('2027-05-18T07:00:00.000Z'),
      drawAt: new Date('2027-05-18T07:45:00.000Z'),
    });
  });

  test('現在の決勝実施日を選ぶと、現在の受付期限と組み合わせ決定のまま', () => {
    expect(scheduleOfChoice(NEXT_YEAR_SETTING, '2027-05-30')).toStrictEqual({
      acceptUntil: new Date(NEXT_YEAR_SETTING.acceptUntil),
      drawAt: new Date(NEXT_YEAR_SETTING.drawAt),
    });
  });

  test('年をまたいで選んでも暦日の差だけずらす', () => {
    const setting = settingOf({
      finalDate: '2027-12-26',
      acceptUntil: '2027-12-21T07:00:00.000Z',
      drawAt: '2027-12-21T07:45:00.000Z',
    });

    expect(scheduleOfChoice(setting, '2027-01-03')).toStrictEqual({
      acceptUntil: new Date('2026-12-29T07:00:00.000Z'),
      drawAt: new Date('2026-12-29T07:45:00.000Z'),
    });
  });

  test('業務日付の形でない値は例外にする', () => {
    expect(() => scheduleOfChoice(NEXT_YEAR_SETTING, '2027-6-6')).toThrow(
      RangeError,
    );
  });
});
