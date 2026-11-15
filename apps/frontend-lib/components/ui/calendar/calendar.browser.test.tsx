import { useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../../styles/base.css';
import { runAxe } from '../../../test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
  outlineOf,
  ringOutline,
} from '../../../test/computed-style.ts';
import { TooltipProvider } from '../tooltip/tooltip-provider.tsx';
import { Calendar } from './calendar.tsx';

const NOVEMBER = new Date(2026, 10, 1);
const TODAY = new Date(2026, 10, 9);
const FIRST_AVAILABLE = new Date(2026, 10, 11);
const INTERVAL_START = new Date(2026, 10, 14);
const INTERVAL_END = new Date(2026, 10, 16);

const DEADLINE_REASON = 'ペアリングの締め切りを過ぎています';
const INTERVAL_REASON = '敗北後の間隔のため選べません';

function unavailableReasonOf(date: Date): string | undefined {
  if (date < FIRST_AVAILABLE) {
    return DEADLINE_REASON;
  }
  if (date >= INTERVAL_START && date <= INTERVAL_END) {
    return INTERVAL_REASON;
  }
  return undefined;
}

interface LaunchCalendarProps {
  readonly onSelect?: (date: Date | undefined) => void;
}

function LaunchCalendar({ onSelect }: LaunchCalendarProps) {
  const [selected, setSelected] = useState<Date>();

  return (
    <TooltipProvider>
      <div className="p-12">
        <Calendar
          mode="single"
          defaultMonth={NOVEMBER}
          today={TODAY}
          selected={selected}
          onSelect={(date) => {
            setSelected(date);
            onSelect?.(date);
          }}
          unavailableReasonOf={unavailableReasonOf}
        />
      </div>
    </TooltipProvider>
  );
}

const grid = (name: string) => page.getByRole('grid', { name });
const day = (name: string) => page.getByRole('button', { name, exact: true });
const tooltip = () => page.getByRole('tooltip');

const TODAY_LABEL = `今日、2026年11月9日月曜日、${DEADLINE_REASON}`;
const NOV_10_LABEL = `2026年11月10日火曜日、${DEADLINE_REASON}`;
const NOV_12_LABEL = '2026年11月12日木曜日';
const NOV_13_LABEL = '2026年11月13日金曜日';
const NOV_15_LABEL = `2026年11月15日日曜日、${INTERVAL_REASON}`;
const NOV_16_LABEL = `2026年11月16日月曜日、${INTERVAL_REASON}`;
const NOV_17_LABEL = '2026年11月17日火曜日';

async function focusToday(): Promise<void> {
  await userEvent.tab();
  await userEvent.tab();
  await userEvent.tab();
  await expect.element(day(TODAY_LABEL)).toHaveFocus();
}

afterEach(() => {
  applyColorScheme('light');
});

describe('Calendar', () => {
  test('前の月・次の月のボタンで、表示する月を切り替える', async () => {
    await render(<LaunchCalendar />);
    await expect.element(grid('2026年11月')).toBeInTheDocument();

    await page.getByRole('button', { name: '次の月へ' }).click();
    await expect.element(grid('2026年12月')).toBeInTheDocument();

    await page.getByRole('button', { name: '前の月へ' }).click();
    await page.getByRole('button', { name: '前の月へ' }).click();
    await expect.element(grid('2026年10月')).toBeInTheDocument();
  });

  test('矢印キーで日を移動し、選べない日にもフォーカスが移る', async () => {
    await render(<LaunchCalendar />);
    await focusToday();

    await userEvent.keyboard('{ArrowRight}');
    await expect.element(day(NOV_10_LABEL)).toHaveFocus();

    await userEvent.keyboard('{ArrowDown}');
    await expect.element(day(NOV_17_LABEL)).toHaveFocus();

    await userEvent.keyboard('{ArrowLeft}');
    await expect.element(day(NOV_16_LABEL)).toHaveFocus();
  });

  test('矢印キーで月の境を越えると、表示する月も切り替わる', async () => {
    await render(<LaunchCalendar />);
    await focusToday();

    for (let week = 0; week < 4; week += 1) {
      await userEvent.keyboard('{ArrowDown}');
    }

    await expect.element(day('2026年12月7日月曜日')).toHaveFocus();
    await expect.element(grid('2026年12月')).toBeInTheDocument();
  });

  test('選べない日は、支援技術へ無効と理由を伝え、EnterとSpaceとクリックで選ばれない', async () => {
    const onSelect = vi.fn();
    await render(<LaunchCalendar onSelect={onSelect} />);
    await focusToday();
    for (let step = 0; step < 6; step += 1) {
      await userEvent.keyboard('{ArrowRight}');
    }
    const unavailable = day(NOV_15_LABEL);
    await expect.element(unavailable).toHaveFocus();

    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    // 操作できない要素を押さない既定の待ち合わせを外し、実際にポインターで押す
    await unavailable.click({ force: true });

    await expect.element(unavailable).toHaveAttribute('aria-disabled', 'true');
    expect(onSelect).not.toHaveBeenCalled();
    expect(
      unavailable.element().closest('[role="gridcell"]'),
    ).not.toHaveAttribute('aria-selected');
  });

  test('選べない日にポインターを重ねると、理由のツールチップが開く', async () => {
    await render(<LaunchCalendar />);
    const unavailable = day(NOV_15_LABEL);

    expect(getComputedStyle(unavailable.element()).pointerEvents).not.toBe(
      'none',
    );
    await userEvent.hover(unavailable);

    await expect.element(tooltip()).toHaveTextContent(INTERVAL_REASON);
  });

  test('キーボードで選べない日へ移ると、理由のツールチップが開き、日の説明として伝える', async () => {
    await render(<LaunchCalendar />);
    await focusToday();

    await expect.element(tooltip()).toHaveTextContent(DEADLINE_REASON);
    await expect
      .element(day(TODAY_LABEL))
      .toHaveAccessibleDescription(DEADLINE_REASON);

    await userEvent.keyboard('{Enter}');

    await expect.element(tooltip()).toHaveTextContent(DEADLINE_REASON);
  });

  test('選べる日にはツールチップを開かない', async () => {
    await render(<LaunchCalendar />);

    await userEvent.hover(day(NOV_12_LABEL));

    await expect.element(tooltip()).not.toBeInTheDocument();
    await expect
      .element(day(NOV_12_LABEL))
      .not.toHaveAttribute('aria-disabled');
  });

  test('選べない日の理由を渡さなければ、今日を含むすべての日を選べる', async () => {
    const onSelect = vi.fn();
    await render(
      <Calendar
        mode="single"
        defaultMonth={NOVEMBER}
        today={TODAY}
        onSelect={onSelect}
      />,
    );

    await day('今日、2026年11月9日月曜日').click();

    expect(onSelect).toHaveBeenLastCalledWith(
      TODAY,
      TODAY,
      expect.anything(),
      expect.anything(),
    );
  });

  test('選べる日を押すと選んだ日を通知し、選択中として示す', async () => {
    const onSelect = vi.fn();
    await render(<LaunchCalendar onSelect={onSelect} />);

    await day(NOV_12_LABEL).click();

    expect(onSelect).toHaveBeenLastCalledWith(new Date(2026, 10, 12));
    const selected = day(`${NOV_12_LABEL}、選択済み`);
    await expect.element(selected).toBeInTheDocument();
    expect(selected.element().closest('[role="gridcell"]')).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('キーボードで選べる日へ移ってEnterを押すと、選んだ日を通知する', async () => {
    const onSelect = vi.fn();
    await render(<LaunchCalendar onSelect={onSelect} />);
    await focusToday();
    for (let step = 0; step < 4; step += 1) {
      await userEvent.keyboard('{ArrowRight}');
    }
    await expect.element(day(NOV_13_LABEL)).toHaveFocus();

    await userEvent.keyboard('{Enter}');

    expect(onSelect).toHaveBeenLastCalledWith(new Date(2026, 10, 13));
  });

  test.each(COLOR_SCHEMES)(
    '配色が%sのとき、キーボードで移ったフォーカスをリングの色の輪郭で示す',
    async (scheme) => {
      applyColorScheme(scheme);
      await render(<LaunchCalendar />);
      await focusToday();

      await userEvent.keyboard('{ArrowRight}');
      await userEvent.keyboard('{ArrowRight}');

      const focused = day('2026年11月11日水曜日');
      await expect.element(focused).toHaveFocus();
      await expect
        .poll(() => outlineOf(focused.element()))
        .toStrictEqual(ringOutline());
    },
  );

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('日を選び、ポインターを重ねたままの状態で、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await render(<LaunchCalendar />);
      await day(NOV_12_LABEL).click();
      await expect
        .element(day(`${NOV_12_LABEL}、選択済み`))
        .toBeInTheDocument();

      expect(await runAxe(container)).toStrictEqual([]);
    });

    test('選べない日の理由のツールチップを開いた状態で、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      await render(<LaunchCalendar />);
      await focusToday();
      await expect.element(tooltip()).toBeInTheDocument();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
