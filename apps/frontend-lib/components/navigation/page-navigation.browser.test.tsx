import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../../test/computed-style.ts';
import {
  PageNavigation,
  type PageNavigationProps,
} from './page-navigation.tsx';

const LABEL = '送信した問い合わせのページ送り';

function Navigation(props: Partial<PageNavigationProps>) {
  return (
    <PageNavigation
      label={LABEL}
      hasPrevious
      hasNext
      settled
      onPrevious={() => undefined}
      onNext={() => undefined}
      {...props}
    />
  );
}

const navigation = () => page.getByRole('navigation', { name: LABEL });
const previousButton = () =>
  page.getByRole('button', { name: '前へ', exact: true });
const nextButton = () =>
  page.getByRole('button', { name: '次へ', exact: true });

afterEach(() => {
  applyColorScheme('light');
});

describe('PageNavigation', () => {
  test('名前付きのページ送りの両方のボタンで前後のページへ移動できる', async () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    await render(<Navigation onPrevious={onPrevious} onNext={onNext} />);

    await expect.element(navigation()).toBeInTheDocument();
    await previousButton().click();
    await nextButton().click();

    expect(onPrevious).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();
  });

  test('前後のページが無い側のボタンを、Tabで止まるまま押せなくする', async () => {
    const onPrevious = vi.fn();
    await render(<Navigation hasPrevious={false} onPrevious={onPrevious} />);

    await expect
      .element(previousButton())
      .toHaveAttribute('aria-disabled', 'true');
    await expect.element(nextButton()).not.toHaveAttribute('aria-disabled');
    await userEvent.tab();
    await expect.element(previousButton()).toHaveFocus();
    await userEvent.keyboard('{Enter}');

    expect(onPrevious).not.toHaveBeenCalled();
  });

  test('一覧が表示されていない間は、前後のページがあっても両方のボタンを押せなくし、フォーカスを残す', async () => {
    const onNext = vi.fn();
    const { rerender } = await render(<Navigation onNext={onNext} />);
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');

    await rerender(<Navigation onNext={onNext} settled={false} />);

    await expect.element(nextButton()).toHaveFocus();
    await expect
      .element(previousButton())
      .toHaveAttribute('aria-disabled', 'true');
    await expect.element(nextButton()).toHaveAttribute('aria-disabled', 'true');
    await userEvent.keyboard('{Enter}');
    expect(onNext).toHaveBeenCalledOnce();
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test.each([
      ['前後のページがある', <Navigation key="both" />],
      [
        '押せないボタンがある',
        <Navigation key="disabled" hasPrevious={false} settled={false} />,
      ],
    ])(
      '%s状態で、アクセシビリティの検査の違反が0件',
      async (_state, element) => {
        applyColorScheme(scheme);
        const { container } = await render(
          <div className="p-4">{element}</div>,
        );

        expect(await runAxe(container)).toStrictEqual([]);
      },
    );
  });
});
