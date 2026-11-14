import { describe, expect, test } from 'bun:test';

import { fallbackLaunchSummary, groupAwards } from './launch-summary.ts';

describe('fallbackLaunchSummary', () => {
  test.each([
    ['予定', 'scheduled', null, 'キックオフ予定', false],
    ['ペアリング済み', 'paired', null, 'キックオフ予定', false],
    ['マッチ中', 'in_progress', null, '予選マッチ中', true],
    ['勝利で終了', 'finished', 'won', 'ディレクトリ掲載', false],
    ['敗北で終了', 'finished', 'lost', '予選敗北', false],
    ['取消', 'canceled', null, '取消', false],
  ] as const)(
    '%sのローンチの要約は%s・%sから「%s」で、マッチ中の印は%sである',
    (_label, status, outcome, label, inMatch) => {
      expect(fallbackLaunchSummary({ status, outcome })).toEqual({
        label,
        inMatch,
      });
    },
  );

  test('ローンチの記録をそのまま渡せ、他の項目を要約に含めない', () => {
    const record = {
      launchId: '01JD0LAUNCH000000000000001',
      status: 'finished',
      outcome: 'won',
      number: 2,
    } as const;

    expect(fallbackLaunchSummary(record)).toEqual({
      label: 'ディレクトリ掲載',
      inMatch: false,
    });
  });

  test('終了したローンチの結果が欠けていれば例外にする', () => {
    expect(() =>
      fallbackLaunchSummary({ status: 'finished', outcome: null }),
    ).toThrow(RangeError);
  });
});

describe('groupAwards', () => {
  test('受賞が無ければ空の並びを返す', () => {
    expect(groupAwards([])).toEqual([]);
  });

  test('Yearを先頭にWeekを続け、種類ごとの数とラベルを受け取った順で返す', () => {
    expect(
      groupAwards([
        { kind: 'week', label: 'Product of the Week 2026-W37' },
        { kind: 'year', label: 'Product of the Year 2026' },
        { kind: 'week', label: 'Product of the Week 2026-W12' },
        { kind: 'week', label: 'Product of the Week 2026-W40' },
      ]),
    ).toEqual([
      { kind: 'year', count: 1, labels: ['Product of the Year 2026'] },
      {
        kind: 'week',
        count: 3,
        labels: [
          'Product of the Week 2026-W37',
          'Product of the Week 2026-W12',
          'Product of the Week 2026-W40',
        ],
      },
    ]);
  });

  test('受賞の無い種類は並びに含めない', () => {
    expect(
      groupAwards([{ kind: 'week', label: 'Product of the Week 2026-W37' }]),
    ).toEqual([
      { kind: 'week', count: 1, labels: ['Product of the Week 2026-W37'] },
    ]);
  });

  test('同じラベルの受賞もまとめずに数える', () => {
    expect(
      groupAwards([
        { kind: 'year', label: 'Product of the Year 2026' },
        { kind: 'year', label: 'Product of the Year 2026' },
      ]),
    ).toEqual([
      {
        kind: 'year',
        count: 2,
        labels: ['Product of the Year 2026', 'Product of the Year 2026'],
      },
    ]);
  });

  test('返す並びは凍結されていて、受け取った配列を変えない', () => {
    const awards = [
      { kind: 'week', label: 'Product of the Week 2026-W37' },
      { kind: 'year', label: 'Product of the Year 2026' },
    ] as const;

    const grouped = groupAwards(awards);

    expect(Object.isFrozen(grouped)).toBe(true);
    expect(grouped.every((group) => Object.isFrozen(group.labels))).toBe(true);
    expect(awards.map(({ kind }) => kind)).toEqual(['week', 'year']);
  });
});
