import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../../test/computed-style.ts';
import { NotFoundView } from './not-found-view.tsx';
import { UnexpectedErrorView } from './unexpected-error-view.tsx';

const NOT_FOUND_MESSAGE =
  'ページが見つかりません。お探しのページは見つかりませんでした。URLをご確認ください。';
const UNEXPECTED_ERROR_MESSAGE =
  'ページを表示できませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。';
const CONTACT_HREF = '/contact';

const CLIENT_LINKS = [
  { href: '/', label: 'トップページへ' },
  { href: '/p', label: 'ディレクトリを見る' },
] as const;

afterEach(() => {
  applyColorScheme('light');
});

describe('NotFoundView', () => {
  test('見出しと説明で文言規則の表の404の文言を表示する', async () => {
    await render(<NotFoundView links={CLIENT_LINKS} />);

    const heading = page.getByRole('heading', { level: 1 });
    await expect.element(heading).toHaveTextContent('ページが見つかりません。');
    const description = page.getByText(
      'お探しのページは見つかりませんでした。URLをご確認ください。',
    );
    await expect.element(description).toBeVisible();
    expect(
      `${heading.element().textContent}${description.element().textContent}`,
    ).toBe(NOT_FOUND_MESSAGE);
  });

  test('渡した導線を順にリンクとして出し、Tabで順にたどれる', async () => {
    await render(<NotFoundView links={CLIENT_LINKS} />);

    for (const { href, label } of CLIENT_LINKS) {
      const link = page.getByRole('link', { name: label });
      await userEvent.tab();
      await expect.element(link).toHaveFocus();
      await expect.element(link).toHaveAttribute('href', href);
    }
  });

  test('管理者側のようにトップページへの導線だけを渡せる', async () => {
    await render(
      <NotFoundView links={[{ href: '/', label: 'トップページへ' }]} />,
    );

    expect(page.getByRole('link').elements()).toHaveLength(1);
  });
});

describe('UnexpectedErrorView', () => {
  test('静的なエラー画面と同じ想定外のエラーの文言を、見出しと案内に分けて警告として伝える', async () => {
    await render(
      <UnexpectedErrorView
        onRetry={() => undefined}
        contactHref={CONTACT_HREF}
      />,
    );

    await expect
      .element(page.getByRole('heading', { level: 1 }))
      .toHaveTextContent('ページを表示できませんでした。');
    expect(page.getByRole('alert').element().textContent).toBe(
      UNEXPECTED_ERROR_MESSAGE,
    );
  });

  test('再試行の操作と問い合わせへの導線を出し、技術的な詳細は出さない', async () => {
    const onRetry = vi.fn();
    const { container } = await render(
      <UnexpectedErrorView onRetry={onRetry} contactHref={CONTACT_HREF} />,
    );

    await userEvent.tab();
    await expect
      .element(page.getByRole('button', { name: '再試行' }))
      .toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onRetry).toHaveBeenCalledTimes(1);
    await userEvent.tab();
    const contact = page.getByRole('link', { name: 'お問い合わせ' });
    await expect.element(contact).toHaveFocus();
    await expect.element(contact).toHaveAttribute('href', CONTACT_HREF);
    expect(container.textContent).toBe(
      `${UNEXPECTED_ERROR_MESSAGE}再試行お問い合わせ`,
    );
  });

  test('管理者側のように問い合わせのページが無ければ、問い合わせへの導線を省いて再試行だけを出せる', async () => {
    const { container } = await render(
      <UnexpectedErrorView onRetry={() => undefined} />,
    );

    await expect
      .element(page.getByRole('button', { name: '再試行' }))
      .toBeVisible();
    expect(page.getByRole('link').elements()).toHaveLength(0);
    expect(container.textContent).toBe(`${UNEXPECTED_ERROR_MESSAGE}再試行`);
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('存在しないページの表示でアクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    const { container } = await render(<NotFoundView links={CLIENT_LINKS} />);

    expect(await runAxe(container)).toStrictEqual([]);
  });

  test('想定外のエラーの表示でアクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    const { container } = await render(
      <UnexpectedErrorView
        onRetry={() => undefined}
        contactHref={CONTACT_HREF}
      />,
    );

    expect(await runAxe(container)).toStrictEqual([]);
  });
});
