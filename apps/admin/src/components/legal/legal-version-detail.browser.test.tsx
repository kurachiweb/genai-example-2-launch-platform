import { afterEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import type { AdminLegalVersionView } from '../../graphql/admin-legal-documents.ts';
import { LegalVersionDetail } from './legal-version-detail.tsx';

// ログイン中の管理者の取得の補助が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const PUBLISHED_AT = '2026-11-02T03:04:05.000Z';

const VERSION: AdminLegalVersionView = Object.freeze({
  kind: 'privacy',
  versionNumber: 2,
  publishedAt: PUBLISHED_AT,
  changeSummary: '第三者提供の記載を改めました。',
  body: '## 第1条(目的)\n\n本ポリシーは利用者の情報の扱いを定めます。\n\n- 収集する情報\n- 利用の目的',
  isLatest: false,
  publishedBy: { id: '01JC0ADMIN000000000000000002', nickname: '統括の担当' },
});

const VERSION_BY_DELETED_ADMIN: AdminLegalVersionView = Object.freeze({
  ...VERSION,
  publishedBy: { id: '01JC0ADMIN0000000000000000DD', nickname: null },
});

const DISPLAY = Object.freeze({ timeZone: 'Asia/Tokyo', locale: 'ja-JP' });

// 日時の部品はアプリの文書の外枠が置く表示設定の内側で描く
const renderDetail = (version: AdminLegalVersionView) =>
  renderInRouter(
    <DisplayPreferencesProvider initial={DISPLAY}>
      <LegalVersionDetail version={version} />
    </DisplayPreferencesProvider>,
  );

const valueOf = (term: string) => {
  const termElement = [...document.querySelectorAll('dt')].find(
    (element) => element.textContent === term,
  );
  return termElement?.nextElementSibling;
};

afterEach(() => {
  applyColorScheme('light');
});

describe('版の表示', () => {
  test('版番号・年を含む公開日時・変更概要・公開した管理者のニックネームを表示する', async () => {
    await renderDetail(VERSION);

    await expect
      .element(page.getByText('第三者提供の記載を改めました。'))
      .toBeVisible();
    expect(valueOf('版')?.textContent).toBe('第2版');
    const publishedAt = valueOf('公開日時')?.querySelector('time');
    expect(publishedAt?.getAttribute('datetime')).toBe(PUBLISHED_AT);
    expect(publishedAt?.textContent).toContain('2026');
    expect(valueOf('変更概要')?.textContent).toBe(
      '第三者提供の記載を改めました。',
    );
    expect(valueOf('公開した管理者')?.textContent).toBe('統括の担当');
  });

  test('公開した管理者が削除済みなら、ニックネームに代えて削除済みの管理者である旨を表示する', async () => {
    await renderDetail(VERSION_BY_DELETED_ADMIN);

    await expect.element(page.getByText('削除済みの管理者')).toBeVisible();
    expect(valueOf('公開した管理者')?.textContent).toBe('削除済みの管理者');
  });

  test('版の本文をマークダウンとして描画して表示する', async () => {
    await renderDetail(VERSION);

    await expect
      .element(page.getByRole('heading', { level: 2, name: '第1条(目的)' }))
      .toBeVisible();
    await expect
      .element(page.getByText('本ポリシーは利用者の情報の扱いを定めます。'))
      .toBeVisible();
    expect(
      page
        .getByRole('listitem')
        .elements()
        .map((item) => item.textContent),
    ).toStrictEqual(['収集する情報', '利用の目的']);
    expect(document.body.textContent).not.toContain('## 第1条');
  });

  test('利用者側のオリジンの、その版の過去版のページへのリンクを置く', async () => {
    await renderDetail(VERSION);

    await expect
      .element(page.getByRole('link', { name: '公開ページで見る' }))
      .toHaveAttribute('href', 'https://client.example/privacy/revisions/2');
  });
});

describe('アクセシビリティ', () => {
  test.each(COLOR_SCHEMES)(
    '%sの配色で、版の表示がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderDetail(VERSION_BY_DELETED_ADMIN);
      await expect
        .element(page.getByRole('link', { name: '公開ページで見る' }))
        .toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
