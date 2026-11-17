import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import {
  BRACKET_COPY,
  BRACKET_ERROR_MESSAGE,
  BRACKET_TITLE,
} from './tournament-bracket-fixtures.ts';
import { TournamentBracketError } from './tournament-bracket-error.tsx';

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const renderError = () =>
  renderInRouter(
    <main>
      <TournamentBracketError copy={BRACKET_COPY} />
    </main>,
  );

const main = () => page.getByRole('main');
const pageTitle = () => main().getByRole('heading', { level: 1 });

afterEach(() => {
  applyColorScheme('light');
});

describe('TournamentBracketError', () => {
  test('文言の題名を読み上げ専用のh1に置き、文言の失敗の文と再試行・問い合わせの導線を示す', async () => {
    await renderError();

    await expect.element(pageTitle()).toHaveTextContent(BRACKET_TITLE);
    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(BRACKET_ERROR_MESSAGE);
    await expect
      .element(main().getByRole('link', { name: 'お問い合わせ' }))
      .toHaveAttribute('href', '/contact');
  });

  test('再試行でルーターを読み込み直し、描き直した後のページの見出しへフォーカスを移す', async () => {
    const router = await renderError();
    const invalidate = vi.spyOn(router, 'invalidate');

    await userEvent.click(main().getByRole('button', { name: '再試行' }));

    expect(invalidate).toHaveBeenCalledTimes(1);
    await expect.element(pageTitle()).toHaveFocus();
  });

  test.each(COLOR_SCHEMES)(
    '配色が%sのとき、アクセシビリティの検査の違反が0件',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderError();
      await expect.element(main().getByRole('alert')).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
