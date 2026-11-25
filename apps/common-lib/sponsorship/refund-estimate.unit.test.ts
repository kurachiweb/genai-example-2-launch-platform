import { describe, expect, test } from 'bun:test';

import {
  computeRefundEstimate,
  computeUnexposedDays,
  countStoppedDays,
} from './refund-estimate.ts';

const STARTS_ON = '2026-12-01';
const ENDS_ON = '2026-12-10';

describe('computeUnexposedDays', () => {
  test.each([
    ['掲載前', '2026-11-20', 10],
    ['初日', STARTS_ON, 10],
    ['期間の途中', '2026-12-04', 7],
    ['最終日', ENDS_ON, 1],
    ['終了日の翌日', '2026-12-11', 0],
    ['終了日より後', '2027-01-01', 0],
  ])('今日が%sなら未掲載日数は%s日', (_, today, expected) => {
    expect(
      computeUnexposedDays({ startsOn: STARTS_ON, endsOn: ENDS_ON, today }),
    ).toBe(expected);
  });

  test('月と年をまたぐ期間も両端を含めて数える', () => {
    expect(
      computeUnexposedDays({
        startsOn: '2027-12-30',
        endsOn: '2028-03-01',
        today: '2028-02-28',
      }),
    ).toBe(3);
  });
});

describe('computeRefundEstimate', () => {
  test('支払った金額×未掲載日数÷掲載期間の日数のセント未満を切り捨てる', () => {
    expect(
      computeRefundEstimate({ amountTotal: 1000, days: 3, unexposedDays: 1 }),
    ).toBe(333);
    expect(
      computeRefundEstimate({ amountTotal: 1000, days: 3, unexposedDays: 2 }),
    ).toBe(666);
  });

  test('割り切れる金額はそのまま返す', () => {
    expect(
      computeRefundEstimate({ amountTotal: 30000, days: 10, unexposedDays: 7 }),
    ).toBe(21000);
  });

  test('全ての日が未掲載なら支払った金額の全額', () => {
    expect(
      computeRefundEstimate({ amountTotal: 12345, days: 7, unexposedDays: 7 }),
    ).toBe(12345);
  });

  test('未掲載日数が0なら0', () => {
    expect(
      computeRefundEstimate({ amountTotal: 12345, days: 7, unexposedDays: 0 }),
    ).toBe(0);
  });

  test('浮動小数点の誤差を作らずに掛けてから割る', () => {
    expect(
      computeRefundEstimate({
        amountTotal: 36_600_000,
        days: 366,
        unexposedDays: 183,
      }),
    ).toBe(18_300_000);
    expect(
      computeRefundEstimate({ amountTotal: 700, days: 100, unexposedDays: 29 }),
    ).toBe(203);
  });

  test.each([
    ['日数が0', { amountTotal: 1000, days: 0, unexposedDays: 0 }],
    ['日数が整数でない', { amountTotal: 1000, days: 1.5, unexposedDays: 1 }],
    ['金額が負', { amountTotal: -1, days: 3, unexposedDays: 1 }],
    ['金額が整数でない', { amountTotal: 10.5, days: 3, unexposedDays: 1 }],
    ['未掲載日数が負', { amountTotal: 1000, days: 3, unexposedDays: -1 }],
    [
      '未掲載日数が日数より多い',
      { amountTotal: 1000, days: 3, unexposedDays: 4 },
    ],
  ])('%sならRangeErrorを投げる', (_, input) => {
    expect(() => computeRefundEstimate(input)).toThrow(RangeError);
  });
});

describe('countStoppedDays', () => {
  test('停止の区間が無ければ0', () => {
    expect(
      countStoppedDays({ startsOn: STARTS_ON, until: ENDS_ON, stops: [] }),
    ).toBe(0);
  });

  test('日の途中に停止して日の途中に解除した区間は、停止の日と解除の日の両方を数える', () => {
    expect(
      countStoppedDays({
        startsOn: STARTS_ON,
        until: ENDS_ON,
        stops: [{ fromDate: '2026-12-03', toDate: '2026-12-05' }],
      }),
    ).toBe(3);
  });

  test('同じ日の途中に停止して解除した区間は1日と数える', () => {
    expect(
      countStoppedDays({
        startsOn: STARTS_ON,
        until: ENDS_ON,
        stops: [{ fromDate: '2026-12-03', toDate: '2026-12-03' }],
      }),
    ).toBe(1);
  });

  test('0:00ちょうどの解除は解除の日を含まない(区間の最後の瞬間を含む日を前日として渡す)', () => {
    expect(
      countStoppedDays({
        startsOn: STARTS_ON,
        until: ENDS_ON,
        stops: [{ fromDate: '2026-12-03', toDate: '2026-12-04' }],
      }),
    ).toBe(2);
  });

  test('掲載前に始まった停止は開始日から数える', () => {
    expect(
      countStoppedDays({
        startsOn: STARTS_ON,
        until: ENDS_ON,
        stops: [{ fromDate: '2026-11-20', toDate: '2026-12-02' }],
      }),
    ).toBe(2);
  });

  test('掲載前に終わった停止は数えない', () => {
    expect(
      countStoppedDays({
        startsOn: STARTS_ON,
        until: ENDS_ON,
        stops: [{ fromDate: '2026-11-20', toDate: '2026-11-30' }],
      }),
    ).toBe(0);
  });

  test('数え終わりの日より後に始まった停止は数えない', () => {
    expect(
      countStoppedDays({
        startsOn: STARTS_ON,
        until: ENDS_ON,
        stops: [{ fromDate: '2026-12-11', toDate: null }],
      }),
    ).toBe(0);
  });

  test('継続中の区間は数え終わりの日まで数える', () => {
    expect(
      countStoppedDays({
        startsOn: STARTS_ON,
        until: ENDS_ON,
        stops: [{ fromDate: '2026-12-08', toDate: null }],
      }),
    ).toBe(3);
  });

  test('数え終わりの日より後まで続く区間は数え終わりの日で打ち切る', () => {
    expect(
      countStoppedDays({
        startsOn: STARTS_ON,
        until: '2026-12-05',
        stops: [{ fromDate: '2026-12-04', toDate: '2026-12-08' }],
      }),
    ).toBe(2);
  });

  test('非公開化と停止が重なった日は1日と数える', () => {
    expect(
      countStoppedDays({
        startsOn: STARTS_ON,
        until: ENDS_ON,
        stops: [
          { fromDate: '2026-12-02', toDate: '2026-12-05' },
          { fromDate: '2026-12-04', toDate: '2026-12-07' },
          { fromDate: '2026-12-03', toDate: '2026-12-03' },
        ],
      }),
    ).toBe(6);
  });

  test('一方が他方を含む区間は外側の区間の日数だけ数える', () => {
    expect(
      countStoppedDays({
        startsOn: STARTS_ON,
        until: ENDS_ON,
        stops: [
          { fromDate: '2026-12-04', toDate: '2026-12-05' },
          { fromDate: '2026-12-02', toDate: null },
        ],
      }),
    ).toBe(9);
  });

  test('何度も始まり終わる区間は含まれる日を合計し、同じ日に解除と再びの停止があれば1日と数える', () => {
    expect(
      countStoppedDays({
        startsOn: STARTS_ON,
        until: ENDS_ON,
        stops: [
          { fromDate: '2026-12-01', toDate: '2026-12-02' },
          { fromDate: '2026-12-02', toDate: '2026-12-03' },
          { fromDate: '2026-12-09', toDate: '2026-12-09' },
        ],
      }),
    ).toBe(4);
  });

  test('数え終わりの日が開始日より前なら0', () => {
    expect(
      countStoppedDays({
        startsOn: STARTS_ON,
        until: '2026-11-30',
        stops: [{ fromDate: '2026-11-20', toDate: null }],
      }),
    ).toBe(0);
  });

  test('数え終わりの日が開始日なら開始日の1日だけを数える', () => {
    expect(
      countStoppedDays({
        startsOn: STARTS_ON,
        until: STARTS_ON,
        stops: [{ fromDate: '2026-11-20', toDate: null }],
      }),
    ).toBe(1);
  });
});
