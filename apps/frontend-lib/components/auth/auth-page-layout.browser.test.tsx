import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../../test/computed-style.ts';
import { AuthPageLayout } from './auth-page-layout.tsx';

const TITLE = 'ログイン';

const renderLayout = () =>
  render(
    <main className="bg-background text-foreground">
      <AuthPageLayout title={TITLE}>
        <p>フォームの本文</p>
      </AuthPageLayout>
    </main>,
  );

afterEach(() => {
  applyColorScheme('light');
});

describe('AuthPageLayout', () => {
  test('題名を見出しにした領域に本文を描き、領域の名前を見出しから取る', async () => {
    await renderLayout();

    await expect
      .element(page.getByRole('heading', { level: 1 }))
      .toHaveTextContent(TITLE);
    await expect
      .element(page.getByRole('region', { name: TITLE }))
      .toHaveTextContent(`${TITLE}フォームの本文`);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('アクセシビリティの検査の違反が0件', async () => {
      await renderLayout();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
