import { describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { LegalConflictNotice } from './legal-conflict-notice.tsx';

const CONFLICT_MESSAGE =
  '他の管理者がこの文書を更新しました。最新の内容を読み込んでから、もう一度操作してください。';

const reloadButton = () =>
  page.getByRole('button', { name: '最新の内容を読み込む' });

// 下書きの入力欄のフォームの中に置かれるため、フォームの中で描く
const renderInForm = (onReload: () => void) => {
  const onSubmit = vi.fn((event: { preventDefault: () => void }) => {
    event.preventDefault();
  });
  const rendered = render(
    <form aria-label="本文" onSubmit={onSubmit}>
      <LegalConflictNotice onReload={onReload} />
    </form>,
  );
  return { rendered, onSubmit };
};

describe('競合の案内', () => {
  test('他の操作で内容が変わった旨を支援技術へ伝わる文言で示す', async () => {
    await renderInForm(vi.fn()).rendered;

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(CONFLICT_MESSAGE);
    await expect.element(reloadButton()).toBeVisible();
  });

  test('「最新の内容を読み込む」の押下で再読み込みを求め、囲むフォームを送信しない', async () => {
    const onReload = vi.fn();
    const { rendered, onSubmit } = renderInForm(onReload);
    await rendered;

    await reloadButton().click();

    expect(onReload).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test('キーボードで「最新の内容を読み込む」へ移動して操作できる', async () => {
    const onReload = vi.fn();
    const { rendered, onSubmit } = renderInForm(onReload);
    await rendered;

    await userEvent.keyboard('{Tab}');
    await expect.element(reloadButton()).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');

    expect(onReload).toHaveBeenCalledTimes(2);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('アクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    const { container } = await renderInForm(vi.fn()).rendered;

    expect(await runAxe(container)).toStrictEqual([]);
  });
});
