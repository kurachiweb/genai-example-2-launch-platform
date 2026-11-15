import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import type { PeriodRange } from '../../../common-lib/directory/directory-period.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { pressKeyUntilFocusMoves } from '../../../lib/test/keyboard.ts';
import { PeriodFilter } from './period-filter.tsx';

// 2026-09-17は木曜日
const TODAY = '2026-09-17';
const HINT = '片方だけ入力すると、その日以降・以前のローンチで絞り込みます。';
const FUTURE_MESSAGE = '未来の日付は選べません。';
const ORDER_MESSAGE = '開始日は終了日以前の日付を選んでください。';

const trigger = () => page.getByRole('button', { name: /^期間 / });
const menu = () => page.getByRole('menu');
const option = (name: string) =>
  page.getByRole('menuitemradio', { name, exact: true });
const rangeDialog = () => page.getByRole('dialog', { name: '期間を指定' });
const fromInput = () => page.getByLabelText('開始日', { exact: true });
const toInput = () => page.getByLabelText('終了日', { exact: true });
const applyButton = () => page.getByRole('button', { name: '適用' });

async function openMenu(): Promise<void> {
  await userEvent.click(trigger());
  await expect.element(menu()).toBeInTheDocument();
}

async function openRangeDialog(): Promise<void> {
  await openMenu();
  await userEvent.click(option('期間を指定…'));
  await expect.element(rangeDialog()).toBeInTheDocument();
}

// 日付の入力欄のTabは年・月・日の区画ごとに止まり、欄を離れるまでの回数が既定の表示形式に依存するため、欄の外を押して離れる
async function leaveField(): Promise<void> {
  await userEvent.click(rangeDialog().getByText(HINT));
}

afterEach(() => {
  applyColorScheme('light');
});

describe('PeriodFilter', () => {
  test.each([
    [{}, '期間 全期間'],
    [{ from: '2026-09-16', to: '2026-09-16' }, '期間 昨日'],
    [{ from: '2026-09-14', to: '2026-09-20' }, '期間 今週'],
    [{ from: '2026-09-01', to: '2026-09-30' }, '期間 今月'],
    [{ from: '2026-01-01', to: '2026-12-31' }, '期間 今年'],
  ] satisfies [PeriodRange, string][])(
    '選択欄は、基準時刻の今日から求めたプリセットと一致する期間をプリセットの名前で示す(%o)',
    async (range, name) => {
      await render(
        <PeriodFilter
          range={range}
          businessToday={TODAY}
          onChange={() => undefined}
        />,
      );

      await expect.element(trigger()).toHaveAccessibleName(name);
      expect(trigger().element().querySelector('time')).toBeNull();
    },
  );

  test.each([
    [{ from: '2026-09-14', to: '2026-09-19' }, '期間 9月14日〜9月19日'],
    [{ from: '2026-09-01' }, '期間 9月1日以降'],
    [{ to: '2026-09-20' }, '期間 9月20日以前'],
    [{ from: '2026-09-14', to: '2026-09-14' }, '期間 9月14日'],
    [{ from: '2025-09-14', to: '2026-09-20' }, '期間 2025年9月14日〜9月20日'],
    [
      { from: '2025-09-14', to: '2025-09-20' },
      '期間 2025年9月14日〜2025年9月20日',
    ],
  ] satisfies [PeriodRange, string][])(
    'プリセットに一致しない期間は日付を<time>要素で示し、メニューでは「期間を指定…」を選択中にする(%o)',
    async (range, name) => {
      await render(
        <PeriodFilter
          range={range}
          businessToday={TODAY}
          onChange={() => undefined}
        />,
      );

      await expect.element(trigger()).toHaveAccessibleName(name);
      const { from, to }: PeriodRange = range;
      const dateTimes = Array.from(
        trigger().element().querySelectorAll('time'),
        (time) => time.dateTime,
      );
      expect(dateTimes).toStrictEqual(
        [from, to].filter(
          (date, index, dates): date is string =>
            date !== undefined && dates.indexOf(date) === index,
        ),
      );

      await openMenu();

      await expect
        .element(option('期間を指定…'))
        .toHaveAttribute('aria-checked', 'true');
    },
  );

  test('選択肢は「昨日」「今週」「今月」「今年」「全期間」「期間を指定…」の順で、既定の「全期間」を選択中にする', async () => {
    await render(
      <PeriodFilter
        range={{}}
        businessToday={TODAY}
        onChange={() => undefined}
      />,
    );

    await openMenu();

    const options = page.getByRole('menuitemradio');
    const expectedNames = [
      '昨日',
      '今週',
      '今月',
      '今年',
      '全期間',
      '期間を指定…',
    ];
    await expect
      .poll(() => options.elements().length)
      .toBe(expectedNames.length);
    for (const [index, name] of expectedNames.entries()) {
      await expect.element(options.nth(index)).toHaveAccessibleName(name);
    }
    await expect
      .element(option('全期間'))
      .toHaveAttribute('aria-checked', 'true');
  });

  test.each([
    ['2026-09-17', '昨日', { from: '2026-09-16', to: '2026-09-16' }],
    ['2026-09-17', '今週', { from: '2026-09-14', to: '2026-09-20' }],
    ['2026-09-17', '今月', { from: '2026-09-01', to: '2026-09-30' }],
    ['2026-09-17', '今年', { from: '2026-01-01', to: '2026-12-31' }],
    ['2027-01-01', '昨日', { from: '2026-12-31', to: '2026-12-31' }],
    ['2026-09-20', '今週', { from: '2026-09-14', to: '2026-09-20' }],
    ['2026-09-21', '今週', { from: '2026-09-21', to: '2026-09-27' }],
    ['2028-02-10', '今月', { from: '2028-02-01', to: '2028-02-29' }],
  ])(
    '基準時刻の今日が%sのとき「%s」を選ぶと、その区切り全体の期間を知らせてメニューを閉じる',
    async (today, preset, expected) => {
      const onChange = vi.fn();
      await render(
        <PeriodFilter range={{}} businessToday={today} onChange={onChange} />,
      );

      await openMenu();
      await userEvent.click(option(preset));

      expect(onChange.mock.calls).toEqual([[expected]]);
      await expect.element(menu()).not.toBeInTheDocument();
      await expect.element(trigger()).toHaveFocus();
    },
  );

  test('指定した期間から「全期間」を選ぶと、条件を消せるよう両端をundefinedにして知らせる', async () => {
    const onChange = vi.fn();
    await render(
      <PeriodFilter
        range={{ from: '2026-09-01' }}
        businessToday={TODAY}
        onChange={onChange}
      />,
    );

    await openMenu();
    await userEvent.click(option('全期間'));

    expect(onChange.mock.calls).toEqual([[{ from: undefined, to: undefined }]]);
  });

  test('選択中のプリセットを選び直しても、変更を知らせない', async () => {
    const onChange = vi.fn();
    await render(
      <PeriodFilter
        range={{ from: '2026-09-14', to: '2026-09-20' }}
        businessToday={TODAY}
        onChange={onChange}
      />,
    );

    await openMenu();
    await userEvent.click(option('今週'));

    expect(onChange).not.toHaveBeenCalled();
  });

  test('「期間を指定…」を選ぶと「期間を指定」のポップオーバーを開き、プリセットの期間では欄を空にして開始日へフォーカスを移す', async () => {
    await render(
      <PeriodFilter
        range={{ from: '2026-09-14', to: '2026-09-20' }}
        businessToday={TODAY}
        onChange={() => undefined}
      />,
    );

    await openRangeDialog();

    await expect.element(menu()).not.toBeInTheDocument();
    await expect
      .element(rangeDialog().getByText('期間を指定', { exact: true }))
      .toBeVisible();
    await expect.element(fromInput()).toHaveFocus();
    await expect.element(fromInput()).toHaveValue('');
    await expect.element(toInput()).toHaveValue('');
    await expect.element(fromInput()).toHaveAttribute('max', TODAY);
    await expect.element(applyButton()).toBeDisabled();
  });

  test('指定中の期間で開くと、その期間を欄に示す', async () => {
    await render(
      <PeriodFilter
        range={{ from: '2026-09-02', to: '2026-09-09' }}
        businessToday={TODAY}
        onChange={() => undefined}
      />,
    );

    await openRangeDialog();

    await expect.element(fromInput()).toHaveValue('2026-09-02');
    await expect.element(toInput()).toHaveValue('2026-09-09');
  });

  test('開始日だけを入力して適用すると、その日以降の期間を知らせてポップオーバーを閉じ、選択欄へフォーカスを戻す', async () => {
    const onChange = vi.fn();
    await render(
      <PeriodFilter range={{}} businessToday={TODAY} onChange={onChange} />,
    );

    await openRangeDialog();
    await userEvent.fill(fromInput(), '2026-09-01');
    await userEvent.click(applyButton());

    expect(onChange.mock.calls).toEqual([
      [{ from: '2026-09-01', to: undefined }],
    ]);
    await expect.element(rangeDialog()).not.toBeInTheDocument();
    await expect.element(trigger()).toHaveFocus();
  });

  test('終了日だけを入力して適用すると、その日以前の期間を知らせる', async () => {
    const onChange = vi.fn();
    await render(
      <PeriodFilter range={{}} businessToday={TODAY} onChange={onChange} />,
    );

    await openRangeDialog();
    await userEvent.fill(toInput(), '2026-09-10');
    await userEvent.click(applyButton());

    expect(onChange.mock.calls).toEqual([
      [{ from: undefined, to: '2026-09-10' }],
    ]);
  });

  test('未来の日付と逆順を入力すると、フォーカスアウトの時に文言を示して適用のボタンを押せなくする', async () => {
    await render(
      <PeriodFilter
        range={{}}
        businessToday={TODAY}
        onChange={() => undefined}
      />,
    );

    await openRangeDialog();
    await userEvent.fill(fromInput(), '2026-09-18');
    await leaveField();

    await expect.element(rangeDialog().getByText(FUTURE_MESSAGE)).toBeVisible();
    await expect.element(applyButton()).toBeDisabled();

    await userEvent.fill(fromInput(), '2026-09-10');
    await userEvent.fill(toInput(), '2026-09-01');
    await leaveField();

    await expect
      .element(rangeDialog().getByText(FUTURE_MESSAGE))
      .not.toBeInTheDocument();
    await expect.element(rangeDialog().getByText(ORDER_MESSAGE)).toBeVisible();
    await expect.element(applyButton()).toBeDisabled();
  });

  test('キャンセルを押すと変更を知らせずに閉じ、選択欄へフォーカスを戻す', async () => {
    const onChange = vi.fn();
    await render(
      <PeriodFilter range={{}} businessToday={TODAY} onChange={onChange} />,
    );

    await openRangeDialog();
    await userEvent.fill(fromInput(), '2026-09-01');
    await userEvent.click(page.getByRole('button', { name: 'キャンセル' }));

    expect(onChange).not.toHaveBeenCalled();
    await expect.element(rangeDialog()).not.toBeInTheDocument();
    await expect.element(trigger()).toHaveFocus();
  });

  test('Escapeで閉じると変更を知らせず、選択欄へフォーカスを戻す', async () => {
    const onChange = vi.fn();
    await render(
      <PeriodFilter range={{}} businessToday={TODAY} onChange={onChange} />,
    );

    await openRangeDialog();
    await userEvent.keyboard('{Escape}');

    expect(onChange).not.toHaveBeenCalled();
    await expect.element(rangeDialog()).not.toBeInTheDocument();
    await expect.element(trigger()).toHaveFocus();
  });

  test('適用した期間と同じ期間なら、変更を知らせない', async () => {
    const onChange = vi.fn();
    await render(
      <PeriodFilter
        range={{ from: '2026-09-02', to: '2026-09-09' }}
        businessToday={TODAY}
        onChange={onChange}
      />,
    );

    await openRangeDialog();
    await userEvent.click(applyButton());

    expect(onChange).not.toHaveBeenCalled();
    await expect.element(rangeDialog()).not.toBeInTheDocument();
  });

  test('キーボードでメニューを開き、矢印キーとEndキーで「期間を指定…」へ移ってEnterを押すと、ポップオーバーの開始日へフォーカスを移す', async () => {
    await render(
      <PeriodFilter
        range={{}}
        businessToday={TODAY}
        onChange={() => undefined}
      />,
    );

    await userEvent.tab();
    await expect.element(trigger()).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect.element(option('昨日')).toHaveFocus();
    await pressKeyUntilFocusMoves('ArrowDown');
    await expect.element(option('今週')).toHaveFocus();
    await pressKeyUntilFocusMoves('End');
    await expect.element(option('期間を指定…')).toHaveFocus();
    await userEvent.keyboard('{Enter}');

    await expect.element(rangeDialog()).toBeInTheDocument();
    await expect.element(fromInput()).toHaveFocus();
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('閉じた選択欄・開いたメニュー・文言を示したポップオーバーで、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await render(
        <div className="bg-background p-4 text-foreground">
          <PeriodFilter
            range={{ from: '2026-09-14', to: '2026-09-19' }}
            businessToday={TODAY}
            onChange={() => undefined}
          />
        </div>,
      );
      expect(await runAxe(container)).toStrictEqual([]);

      // メニュー・ポップオーバーを開くと外側はaria-hiddenになるため、開いた要素を別に検査する
      await openMenu();
      expect(await runAxe(menu().element())).toStrictEqual([]);

      await userEvent.click(option('期間を指定…'));
      await expect.element(rangeDialog()).toBeInTheDocument();
      await userEvent.fill(fromInput(), '2026-09-20');
      await leaveField();
      await expect
        .element(rangeDialog().getByText(ORDER_MESSAGE))
        .toBeVisible();

      expect(await runAxe(rangeDialog().element())).toStrictEqual([]);
    });
  });
});
