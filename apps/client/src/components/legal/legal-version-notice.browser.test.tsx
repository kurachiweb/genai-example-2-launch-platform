import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import type { LegalDocumentKind } from '../../../common-lib/legal/legal-documents.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import { LegalVersionNotice } from './legal-version-notice.tsx';

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const note = () => page.getByRole('note');

async function renderNotice({
  kind = 'terms',
  isLatest,
  versionNumber,
}: {
  readonly kind?: LegalDocumentKind;
  readonly isLatest: boolean;
  readonly versionNumber: number;
}) {
  return renderInRouter(
    <LegalVersionNotice
      kind={kind}
      isLatest={isLatest}
      versionNumber={versionNumber}
    />,
    { path: `/terms/revisions/${String(versionNumber)}` },
  );
}

afterEach(() => {
  applyColorScheme('light');
});

describe('LegalVersionNotice', () => {
  test('過去の版では、過去の版である旨と最新版の公開ページへのリンクを注記として示す', async () => {
    await renderNotice({ isLatest: false, versionNumber: 1 });

    await expect
      .element(note())
      .toHaveTextContent('これは第1版です。最新版ではありません。');
    await expect
      .element(note().getByRole('link', { name: '最新版を見る' }))
      .toHaveAttribute('href', '/terms');
    expect(note().element().textContent).not.toContain('これは最新版です。');
    expect(
      note().getByRole('link', { name: '公開ページを見る' }).query(),
    ).toBeNull();
  });

  test('最新版では、最新版である旨と公開ページへのリンクを注記として示す', async () => {
    await renderNotice({ isLatest: true, versionNumber: 3 });

    await expect.element(note()).toHaveTextContent('これは最新版です。');
    await expect
      .element(note().getByRole('link', { name: '公開ページを見る' }))
      .toHaveAttribute('href', '/terms');
    expect(note().element().textContent).not.toContain('最新版ではありません');
    expect(
      note().getByRole('link', { name: '最新版を見る' }).query(),
    ).toBeNull();
  });

  test.each([
    ['privacy', false, '最新版を見る', '/privacy'],
    ['legal-notice', false, '最新版を見る', '/legal'],
    ['privacy', true, '公開ページを見る', '/privacy'],
    ['legal-notice', true, '公開ページを見る', '/legal'],
  ] as const)(
    '種類が%s(最新版: %s)のリンク「%s」は、その文書の公開ページのパスにする',
    async (kind, isLatest, name, href) => {
      await renderNotice({ kind, isLatest, versionNumber: 2 });

      await expect
        .element(note().getByRole('link', { name }))
        .toHaveAttribute('href', href);
    },
  );

  test('公開ページへのリンクは、版のページを公開ページの一部として現在のページと示さない', async () => {
    await renderNotice({ isLatest: false, versionNumber: 1 });

    await expect
      .element(note().getByRole('link', { name: '最新版を見る' }))
      .not.toHaveAttribute('aria-current');
  });

  test('リンクを選ぶと、ページを読み込み直さずに公開ページへ遷移する', async () => {
    const router = await renderNotice({ isLatest: false, versionNumber: 1 });

    await userEvent.click(note().getByRole('link', { name: '最新版を見る' }));

    await expect.poll(() => router.state.location.pathname).toBe('/terms');
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test.each([
      ['過去の版', false],
      ['最新版', true],
    ] as const)(
      '%sの案内でアクセシビリティの検査の違反が0件',
      async (_label, isLatest) => {
        await renderNotice({ isLatest, versionNumber: 2 });
        await expect.element(note()).toBeVisible();

        expect(await runAxe(document.body)).toStrictEqual([]);
      },
    );
  });
});
