import { afterEach, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { CommentListSkeleton } from './comment-list-skeleton.tsx';

afterEach(() => {
  applyColorScheme('light');
});

describe('CommentListSkeleton', () => {
  test('最初の読み込みでは「コメントを読み込み中」を状態として伝え、スケルトンの形を読み上げから外す', async () => {
    await render(<CommentListSkeleton />);

    const status = page.getByRole('status');
    await expect.element(status).toHaveTextContent('コメントを読み込み中');
    expect(
      status
        .element()
        .querySelectorAll('[aria-hidden="true"] [data-slot="skeleton"]').length,
    ).toBeGreaterThan(0);
  });

  test('続きの読み込みでは「続きを読み込み中」を状態として伝える', async () => {
    await render(<CommentListSkeleton loadingMore />);

    await expect
      .element(page.getByRole('status'))
      .toHaveTextContent('続きを読み込み中');
    await expect
      .element(page.getByText('コメントを読み込み中'))
      .not.toBeInTheDocument();
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      await render(<CommentListSkeleton />);
      await expect.element(page.getByRole('status')).toBeInTheDocument();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
