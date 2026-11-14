import { afterEach, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
  tokenColorOf,
} from '../../test/computed-style.ts';
import { INLINE_LINK_CLASS_NAME } from './inline-link-class.ts';

const renderSentence = () =>
  render(
    <main className="bg-background p-4 text-foreground">
      <p>
        パスワードをお忘れの場合は、
        <a href="/auth/password-reset" className={INLINE_LINK_CLASS_NAME}>
          パスワードの再設定
        </a>
        を行ってください。
      </p>
    </main>,
  );

const link = () => page.getByRole('link', { name: 'パスワードの再設定' });

afterEach(() => {
  applyColorScheme('light');
});

describe('INLINE_LINK_CLASS_NAME', () => {
  test.each(COLOR_SCHEMES)(
    '配色が%sのとき、文中のリンクを色に加えて下線で見分けられるようにし、アクセシビリティの検査の違反が0件',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderSentence();

      const style = getComputedStyle(link().element());
      expect(style.textDecorationLine).toBe('underline');
      expect(style.color).toBe(tokenColorOf('primary'));
      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
