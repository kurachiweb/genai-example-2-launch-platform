import { describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';

import type { PeriodRange } from '../../../common-lib/directory/directory-period.ts';
import { PeriodLabel } from './period-label.tsx';

// 2026-09-17は木曜日
const TODAY = '2026-09-17';

const timesIn = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('time'), (time) => ({
    dateTime: time.dateTime,
    text: time.textContent,
  }));

describe('PeriodLabel', () => {
  test.each([
    [{}, '全期間'],
    [{ from: '2026-09-16', to: '2026-09-16' }, '昨日'],
    [{ from: '2026-09-14', to: '2026-09-20' }, '今週'],
    [{ from: '2026-09-01', to: '2026-09-30' }, '今月'],
    [{ from: '2026-01-01', to: '2026-12-31' }, '今年'],
  ] satisfies [PeriodRange, string][])(
    'プリセットと一致する期間はプリセットの名前を文字のまま示し、<time>要素を使わない(%o)',
    async (range, text) => {
      const { container } = await render(
        <p>
          <PeriodLabel range={range} businessToday={TODAY} />
        </p>,
      );

      expect(container.textContent).toBe(text);
      expect(timesIn(container)).toStrictEqual([]);
    },
  );

  test.each([
    [
      { from: '2026-09-14', to: '2026-09-19' },
      '9月14日〜9月19日',
      [
        { dateTime: '2026-09-14', text: '9月14日' },
        { dateTime: '2026-09-19', text: '9月19日' },
      ],
    ],
    [
      { from: '2026-09-01' },
      '9月1日以降',
      [{ dateTime: '2026-09-01', text: '9月1日' }],
    ],
    [
      { to: '2026-09-20' },
      '9月20日以前',
      [{ dateTime: '2026-09-20', text: '9月20日' }],
    ],
    [
      { from: '2026-09-14', to: '2026-09-14' },
      '9月14日',
      [{ dateTime: '2026-09-14', text: '9月14日' }],
    ],
    [
      { from: '2025-09-14', to: '2026-09-20' },
      '2025年9月14日〜9月20日',
      [
        { dateTime: '2025-09-14', text: '2025年9月14日' },
        { dateTime: '2026-09-20', text: '9月20日' },
      ],
    ],
  ] satisfies [PeriodRange, string, { dateTime: string; text: string }[]][])(
    'プリセットに一致しない期間は、両端の業務日付をdatetime属性付きの<time>要素で示す(%o)',
    async (range, text, times) => {
      const { container } = await render(
        <p>
          <PeriodLabel range={range} businessToday={TODAY} />
        </p>,
      );

      expect(container.textContent).toBe(text);
      expect(timesIn(container)).toStrictEqual(times);
    },
  );
});
