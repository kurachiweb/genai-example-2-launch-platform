import { useState } from 'react';
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
import {
  EMPTY_PERIOD_RANGE_DRAFT,
  type PeriodRangeDraft,
} from './period-range-draft.ts';
import { PeriodRangeForm } from './period-range-form.tsx';

const TODAY = '2026-09-17';
const HINT = '片方だけ入力すると、その日以降・以前のローンチで絞り込みます。';
const FUTURE_MESSAGE = '未来の日付は選べません。';
const ORDER_MESSAGE = '開始日は終了日以前の日付を選んでください。';

const fromInput = () => page.getByLabelText('開始日', { exact: true });
const toInput = () => page.getByLabelText('終了日', { exact: true });
const applyButton = () => page.getByRole('button', { name: '適用' });
const cancelButton = () => page.getByRole('button', { name: 'キャンセル' });

interface HarnessProps {
  readonly initial?: PeriodRangeDraft;
  readonly onApply?: (range: PeriodRange) => void;
  readonly onCancel?: () => void;
  readonly onChange?: (draft: PeriodRangeDraft) => void;
}

// 呼び出し側が下書きを持つ形で使うため、テストでも状態を外に置く
function Harness({ initial, onApply, onCancel, onChange }: HarnessProps) {
  const [draft, setDraft] = useState(initial ?? EMPTY_PERIOD_RANGE_DRAFT);
  return (
    <div className="bg-background p-4 text-foreground">
      <PeriodRangeForm
        value={draft}
        businessToday={TODAY}
        onChange={(next) => {
          setDraft(next);
          onChange?.(next);
        }}
        onApply={onApply}
        onCancel={onCancel}
      />
    </div>
  );
}

// 日付の入力欄のTabは年・月・日の区画ごとに止まり、欄を離れるまでの回数が既定の表示形式に依存するため、欄の外を押して離れる
async function leaveField(): Promise<void> {
  await userEvent.click(page.getByText(HINT));
}

async function fillAndLeave(
  input: ReturnType<typeof fromInput>,
  value: string,
): Promise<void> {
  await userEvent.fill(input, value);
  await leaveField();
}

afterEach(() => {
  applyColorScheme('light');
});

describe('PeriodRangeForm', () => {
  test('開始日・終了日の日付の欄に、片方だけの指定の説明を結び付け、基準時刻の今日より後を選ばせない', async () => {
    await render(
      <Harness onApply={() => undefined} onCancel={() => undefined} />,
    );

    for (const input of [fromInput(), toInput()]) {
      await expect.element(input).toHaveAttribute('type', 'date');
      await expect.element(input).toHaveAttribute('max', TODAY);
      await expect.element(input).toHaveAccessibleDescription(HINT);
      await expect.element(input).not.toHaveAttribute('aria-invalid');
    }
    await expect.element(page.getByText(HINT)).toBeVisible();
  });

  test('どちらも空の間は適用のボタンを押せない', async () => {
    await render(
      <Harness onApply={() => undefined} onCancel={() => undefined} />,
    );

    await expect.element(applyButton()).toBeDisabled();
  });

  test('開始日だけを入力して適用すると、その日以降の期間を知らせる', async () => {
    const onApply = vi.fn();
    await render(<Harness onApply={onApply} onCancel={() => undefined} />);

    await fillAndLeave(fromInput(), '2026-09-01');
    await userEvent.click(applyButton());

    expect(onApply.mock.calls).toEqual([
      [{ from: '2026-09-01', to: undefined }],
    ]);
  });

  test('終了日だけを入力して適用すると、その日以前の期間を知らせる', async () => {
    const onApply = vi.fn();
    await render(<Harness onApply={onApply} onCancel={() => undefined} />);

    await fillAndLeave(toInput(), '2026-09-10');
    await userEvent.click(applyButton());

    expect(onApply.mock.calls).toEqual([
      [{ from: undefined, to: '2026-09-10' }],
    ]);
  });

  test('基準時刻の今日は選べ、両端を入力して適用すると両端を知らせる', async () => {
    const onApply = vi.fn();
    await render(<Harness onApply={onApply} onCancel={() => undefined} />);

    await fillAndLeave(fromInput(), '2026-09-01');
    await fillAndLeave(toInput(), TODAY);

    await expect
      .element(page.getByText(FUTURE_MESSAGE))
      .not.toBeInTheDocument();
    await userEvent.click(applyButton());

    expect(onApply.mock.calls).toEqual([[{ from: '2026-09-01', to: TODAY }]]);
  });

  test.each([
    ['開始日', fromInput, toInput],
    ['終了日', toInput, fromInput],
  ])(
    '%sに未来の日付を入力すると、適用のボタンを押せなくし、フォーカスアウトの時にその欄へ未来の日付の文言を示す',
    async (_label, invalidInput, otherInput) => {
      await render(
        <Harness onApply={() => undefined} onCancel={() => undefined} />,
      );

      await userEvent.fill(invalidInput(), '2026-09-18');

      await expect.element(applyButton()).toBeDisabled();
      await expect
        .element(page.getByText(FUTURE_MESSAGE))
        .not.toBeInTheDocument();

      await leaveField();

      await expect.element(page.getByText(FUTURE_MESSAGE)).toBeVisible();
      await expect
        .element(invalidInput())
        .toHaveAttribute('aria-invalid', 'true');
      await expect
        .element(invalidInput())
        .toHaveAccessibleDescription(`${HINT} ${FUTURE_MESSAGE}`);
      await expect.element(otherInput()).not.toHaveAttribute('aria-invalid');
      await expect.element(applyButton()).toBeDisabled();
    },
  );

  test('開始日が終了日より後なら、適用のボタンを押せなくし、フォーカスアウトの時に逆順の文言を両方の欄へ結び付けて示し、直すと消す', async () => {
    await render(
      <Harness onApply={() => undefined} onCancel={() => undefined} />,
    );

    await fillAndLeave(fromInput(), '2026-09-10');
    await userEvent.fill(toInput(), '2026-09-01');

    await expect.element(applyButton()).toBeDisabled();

    await leaveField();

    await expect.element(page.getByText(ORDER_MESSAGE)).toBeVisible();
    for (const input of [fromInput(), toInput()]) {
      await expect.element(input).toHaveAttribute('aria-invalid', 'true');
      await expect
        .element(input)
        .toHaveAccessibleDescription(`${HINT} ${ORDER_MESSAGE}`);
    }

    await fillAndLeave(toInput(), '2026-09-12');

    await expect.element(page.getByText(ORDER_MESSAGE)).not.toBeInTheDocument();
    await expect.element(applyButton()).toBeEnabled();
  });

  test('一度離れた欄に入力し直す間は、未来の日付のままでも文言とaria-invalidを外し、欄を離れた時に示し直す', async () => {
    await render(
      <Harness onApply={() => undefined} onCancel={() => undefined} />,
    );

    await fillAndLeave(fromInput(), '2026-09-18');
    await expect.element(page.getByText(FUTURE_MESSAGE)).toBeVisible();

    await userEvent.fill(fromInput(), '2026-09-19');

    await expect
      .element(page.getByText(FUTURE_MESSAGE))
      .not.toBeInTheDocument();
    await expect.element(fromInput()).not.toHaveAttribute('aria-invalid');
    await expect.element(fromInput()).toHaveAccessibleDescription(HINT);
    await expect.element(applyButton()).toBeDisabled();

    await leaveField();

    await expect.element(page.getByText(FUTURE_MESSAGE)).toBeVisible();
    await expect.element(fromInput()).toHaveAttribute('aria-invalid', 'true');
  });

  test('受け取った下書きを入力欄に示し、変更を空の欄は空の文字列の下書きで知らせる', async () => {
    const onChange = vi.fn();
    await render(
      <Harness
        initial={{ from: '2026-09-14', to: '2026-09-16' }}
        onChange={onChange}
        onApply={() => undefined}
        onCancel={() => undefined}
      />,
    );

    await expect.element(fromInput()).toHaveValue('2026-09-14');
    await expect.element(toInput()).toHaveValue('2026-09-16');

    await userEvent.clear(toInput());

    expect(onChange).toHaveBeenLastCalledWith({ from: '2026-09-14', to: '' });
  });

  test('キャンセルを押すと呼び出し側へ知らせ、適用を知らせない', async () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    await render(<Harness onApply={onApply} onCancel={onCancel} />);

    await fillAndLeave(fromInput(), '2026-09-01');
    await userEvent.click(cancelButton());

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onApply).not.toHaveBeenCalled();
  });

  test('適用を知らせる先が無ければ操作のボタンを置かず、入力欄だけで下書きの変更を知らせる', async () => {
    const onChange = vi.fn();
    await render(<Harness onChange={onChange} />);

    await fillAndLeave(fromInput(), '2026-09-18');

    expect(onChange).toHaveBeenLastCalledWith({ from: '2026-09-18', to: '' });
    await expect.element(page.getByText(FUTURE_MESSAGE)).toBeVisible();
    await expect.element(page.getByRole('button')).not.toBeInTheDocument();
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test.each([
      ['入力前', EMPTY_PERIOD_RANGE_DRAFT],
      ['未来と逆順の文言の表示中', { from: '2026-09-20', to: '2026-09-18' }],
    ])(
      '%sの欄と操作で、アクセシビリティの検査の違反が0件',
      async (_label, initial) => {
        applyColorScheme(scheme);
        const { container } = await render(
          <Harness
            initial={initial}
            onApply={() => undefined}
            onCancel={() => undefined}
          />,
        );
        await userEvent.click(fromInput());
        await userEvent.click(toInput());
        await leaveField();

        expect(await runAxe(container)).toStrictEqual([]);
      },
    );
  });
});
