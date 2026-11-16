import { type ReactNode, useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
  outlineOf,
  ringOutline,
  tokenColorOf,
} from '../../../lib/test/computed-style.ts';
import { StarRatingInput } from './star-rating-input.tsx';

const LABEL = 'あなたの評価';

const REASON_ID = 'rating-unverified-reason';

const REASON =
  'この操作にはメールアドレスの確認が必要です。確認メールをご確認ください。';

const OUTSIDE = '星の外の領域';

// 前に実行したテストのポインターの位置が残ると、同じ位置に描いた星へポインターが重なった扱いになり予告で塗られるため、描画の後にポインターを外へ移す
async function renderAwayFromPointer(element: ReactNode) {
  const screen = await render(
    <>
      {element}
      <p>{OUTSIDE}</p>
    </>,
  );
  await userEvent.hover(page.getByText(OUTSIDE));
  return screen;
}

const group = () => page.getByRole('radiogroup', { name: LABEL });

const star = (score: number) =>
  page.getByRole('radio', { name: `5段階中${String(score)}`, exact: true });

const starIconOf = (score: number): SVGElement => {
  const icon = star(score).element().querySelector('svg');
  if (icon === null) {
    throw new Error('星のアイコンがありません。');
  }
  return icon;
};

const isFilled = (score: number): boolean =>
  getComputedStyle(starIconOf(score)).fill === tokenColorOf('primary');

const filledScores = (): readonly number[] =>
  [1, 2, 3, 4, 5].filter((score) => isFilled(score));

function ControlledStarRatingInput({
  initial,
  onChange,
}: {
  readonly initial: number | null;
  readonly onChange?: (value: number) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <StarRatingInput
      label={LABEL}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

function DisabledStarRatingInput({ value }: { readonly value: number | null }) {
  return (
    <div>
      <StarRatingInput
        label={LABEL}
        value={value}
        onChange={() => undefined}
        disabled
        describedBy={REASON_ID}
      />
      <p id={REASON_ID}>{REASON}</p>
    </div>
  );
}

afterEach(() => {
  applyColorScheme('light');
});

describe('StarRatingInput', () => {
  test('名前の付いた1つのラジオグループに「5段階中1」〜「5段階中5」の5つの選択肢を置き、値の星を選んだ状態にする', async () => {
    await renderAwayFromPointer(<ControlledStarRatingInput initial={3} />);

    await expect.element(group()).toBeInTheDocument();
    expect(page.getByRole('radio').elements()).toHaveLength(5);
    await expect.element(star(3)).toBeChecked();
    for (const score of [1, 2, 4, 5]) {
      await expect.element(star(score)).not.toBeChecked();
    }
  });

  test('Tabは選んだ星だけに止まる', async () => {
    await renderAwayFromPointer(
      <>
        <ControlledStarRatingInput initial={4} />
        <button type="button">次の操作</button>
      </>,
    );

    await userEvent.tab();
    await expect.element(star(4)).toHaveFocus();
    await userEvent.tab();

    await expect
      .element(page.getByRole('button', { name: '次の操作' }))
      .toHaveFocus();
  });

  test('未選択ならTabは最初の星に止まる', async () => {
    await renderAwayFromPointer(<ControlledStarRatingInput initial={null} />);

    await userEvent.tab();

    await expect.element(star(1)).toHaveFocus();
    for (const score of [1, 2, 3, 4, 5]) {
      await expect.element(star(score)).not.toBeChecked();
    }
  });

  test('右と上の矢印キーで次の星、左と下の矢印キーで前の星へフォーカスを移して選ぶ', async () => {
    const onChange = vi.fn();
    await renderAwayFromPointer(
      <ControlledStarRatingInput initial={2} onChange={onChange} />,
    );

    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}');
    await expect.element(star(3)).toHaveFocus();
    await expect.element(star(3)).toBeChecked();
    await userEvent.keyboard('{ArrowUp}');
    await expect.element(star(4)).toBeChecked();
    await userEvent.keyboard('{ArrowLeft}');
    await expect.element(star(3)).toBeChecked();
    await userEvent.keyboard('{ArrowDown}');

    await expect.element(star(2)).toHaveFocus();
    await expect.element(star(2)).toBeChecked();
    expect(onChange.mock.calls).toStrictEqual([[3], [4], [3], [2]]);
  });

  test('両端の星から外へは移らず、値が変わらないため選択の変更を伝えない', async () => {
    const onChange = vi.fn();
    await renderAwayFromPointer(
      <ControlledStarRatingInput initial={5} onChange={onChange} />,
    );

    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}');
    await expect.element(star(5)).toHaveFocus();
    await userEvent.click(star(1));
    await userEvent.keyboard('{ArrowLeft}');

    await expect.element(star(1)).toHaveFocus();
    await expect.element(star(1)).toBeChecked();
    expect(onChange.mock.calls).toStrictEqual([[1]]);
  });

  test('未選択のまま矢印キーを押すと最初の星の次を選ぶ', async () => {
    const onChange = vi.fn();
    await renderAwayFromPointer(
      <ControlledStarRatingInput initial={null} onChange={onChange} />,
    );

    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}');

    await expect.element(star(2)).toHaveFocus();
    expect(onChange.mock.calls).toStrictEqual([[2]]);
  });

  test('星の押下とSpaceでその星を選ぶ', async () => {
    const onChange = vi.fn();
    await renderAwayFromPointer(
      <ControlledStarRatingInput initial={null} onChange={onChange} />,
    );

    await userEvent.tab();
    await userEvent.keyboard(' ');
    await expect.element(star(1)).toBeChecked();
    await userEvent.click(star(4));

    await expect.element(star(4)).toBeChecked();
    expect(onChange.mock.calls).toStrictEqual([[1], [4]]);
  });

  test('選んだ星の押下とSpaceは値が変わらないため選択の変更を伝えない', async () => {
    const onChange = vi.fn();
    await renderAwayFromPointer(
      <ControlledStarRatingInput initial={3} onChange={onChange} />,
    );

    await userEvent.click(star(3));
    await userEvent.keyboard(' ');

    await expect.element(star(3)).toHaveFocus();
    await expect.element(star(3)).toBeChecked();
    expect(onChange).not.toHaveBeenCalled();
  });

  test('値までの星をプライマリの色で塗り、残りは塗らない', async () => {
    await renderAwayFromPointer(<ControlledStarRatingInput initial={3} />);

    await expect.element(star(3)).toBeChecked();
    await expect.poll(filledScores).toStrictEqual([1, 2, 3]);
    expect(getComputedStyle(starIconOf(1)).color).toBe(tokenColorOf('primary'));
    expect(getComputedStyle(starIconOf(4)).color).not.toBe(
      tokenColorOf('primary'),
    );
  });

  test('ポインターを重ねた星までを予告として塗り、外すと値の表示へ戻す', async () => {
    const onChange = vi.fn();
    await renderAwayFromPointer(
      <ControlledStarRatingInput initial={2} onChange={onChange} />,
    );

    await userEvent.hover(star(4));
    await expect.poll(filledScores).toStrictEqual([1, 2, 3, 4]);
    await userEvent.hover(page.getByText(OUTSIDE));

    await expect.poll(filledScores).toStrictEqual([1, 2]);
    expect(onChange).not.toHaveBeenCalled();
  });

  test('キーボードでフォーカスした星に共通のフォーカスの輪郭を付ける', async () => {
    await renderAwayFromPointer(<ControlledStarRatingInput initial={1} />);

    await userEvent.tab();

    await expect.element(star(1)).toHaveFocus();
    expect(outlineOf(star(1).element())).toStrictEqual(ringOutline());
  });

  test('小さい大きさは大きい大きさより星を小さく描く', async () => {
    await renderAwayFromPointer(
      <>
        <StarRatingInput
          label="小さい星"
          value={null}
          onChange={() => undefined}
          size="sm"
        />
        <StarRatingInput
          label="大きい星"
          value={null}
          onChange={() => undefined}
        />
      </>,
    );
    const widthOf = (name: string) =>
      page
        .getByRole('radiogroup', { name })
        .getByRole('radio', { name: '5段階中1' })
        .element()
        .querySelector('svg')
        ?.getBoundingClientRect().width;

    expect(widthOf('小さい星')).toBe(20);
    expect(widthOf('大きい星')).toBe(28);
  });

  describe('無効のとき', () => {
    test('どの星も選べず、無効の理由をグループの説明として伝える', async () => {
      await renderAwayFromPointer(<DisabledStarRatingInput value={null} />);

      await expect.element(group()).toHaveAttribute('aria-disabled', 'true');
      await expect.element(group()).toHaveAccessibleDescription(REASON);
      for (const score of [1, 2, 3, 4, 5]) {
        await expect.element(star(score)).toBeDisabled();
      }
    });

    test('押してもポインターを重ねても選ばず、塗りを変えない', async () => {
      const onChange = vi.fn();
      await renderAwayFromPointer(
        <StarRatingInput
          label={LABEL}
          value={2}
          onChange={onChange}
          disabled
        />,
      );

      await userEvent.hover(star(4));
      await userEvent.click(star(4), { force: true });

      expect(filledScores()).toStrictEqual([1, 2]);
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('選んだ星をプライマリの色で塗る', async () => {
      applyColorScheme(scheme);
      await renderAwayFromPointer(<ControlledStarRatingInput initial={2} />);

      await expect.poll(filledScores).toStrictEqual([1, 2]);
    });

    test('入力できる状態のアクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await renderAwayFromPointer(
        <ControlledStarRatingInput initial={3} />,
      );

      expect(await runAxe(container)).toStrictEqual([]);
    });

    test('無効の状態のアクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await renderAwayFromPointer(
        <DisabledStarRatingInput value={4} />,
      );

      expect(await runAxe(container)).toStrictEqual([]);
    });
  });
});
