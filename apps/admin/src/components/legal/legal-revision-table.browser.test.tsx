import type { ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import type { AdminLegalRevisionView } from '../../graphql/admin-legal-documents.ts';
import { LegalRevisionTable } from './legal-revision-table.tsx';

// ログイン中の管理者の取得の補助が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const CLIENT_SITE_ORIGIN = 'https://client.example';

const THIRD_PUBLISHED_AT = '2026-11-02T03:04:05.000Z';

const REVISIONS: readonly AdminLegalRevisionView[] = Object.freeze([
  {
    versionNumber: 3,
    publishedAt: THIRD_PUBLISHED_AT,
    changeSummary: '第5条の禁止事項を追加しました。',
    publishedBy: { id: '01JC0ADMIN000000000000000002', nickname: '統括の担当' },
  },
  {
    versionNumber: 2,
    publishedAt: '2026-10-15T00:00:00.000Z',
    changeSummary: '退会の手続きを改めました。',
    publishedBy: { id: '01JC0ADMIN0000000000000000DD', nickname: null },
  },
  {
    versionNumber: 1,
    publishedAt: '2025-12-01T09:00:00.000Z',
    changeSummary: '初版を公開しました。',
    publishedBy: { id: '01JC0ADMIN000000000000000002', nickname: '統括の担当' },
  },
]);

const DISPLAY = Object.freeze({ timeZone: 'Asia/Tokyo', locale: 'ja-JP' });

// 日時の部品はアプリの文書の外枠が置く表示設定の内側で描く
const renderTable = (element: ReactNode) =>
  renderInRouter(
    <DisplayPreferencesProvider initial={DISPLAY}>
      {element}
    </DisplayPreferencesProvider>,
  );

const table = () => page.getByRole('table', { name: '改訂履歴' });
const bodyRows = () => table().getByRole('row').elements().slice(1);
const cellTextsOf = (row: Element) =>
  [...row.querySelectorAll('td')].map((cell) => cell.textContent);

afterEach(() => {
  applyColorScheme('light');
});

describe('改訂履歴の表', () => {
  test('全版を新しい順に、版番号・年を含む公開日時・変更概要・公開した管理者のニックネームとともに表示する', async () => {
    await renderTable(
      <LegalRevisionTable kind="terms" revisions={REVISIONS} />,
    );

    await expect.element(table()).toBeVisible();
    await expect
      .element(page.getByRole('heading', { level: 2, name: '改訂履歴' }))
      .toBeVisible();
    expect(
      table()
        .getByRole('columnheader')
        .elements()
        .map((element) => element.textContent),
    ).toStrictEqual(['版', '公開日時', '変更概要', '公開した管理者', '操作']);
    const rows = bodyRows();
    expect(rows.map((row) => cellTextsOf(row)[0])).toStrictEqual([
      '第3版',
      '第2版',
      '第1版',
    ]);
    expect(rows.map((row) => cellTextsOf(row).slice(2, 4))).toStrictEqual([
      ['第5条の禁止事項を追加しました。', '統括の担当'],
      ['退会の手続きを改めました。', '削除済みの管理者'],
      ['初版を公開しました。', '統括の担当'],
    ]);
    const times = rows.map((row) => row.querySelector('time'));
    expect(times.map((time) => time?.getAttribute('datetime'))).toStrictEqual(
      REVISIONS.map(({ publishedAt }) => publishedAt),
    );
    expect(times[0]?.textContent).toContain('2026');
    expect(times[2]?.textContent).toContain('2025');
  });

  test('公開した管理者が削除済みなら、ニックネームに代えて削除済みの管理者である旨を表示する', async () => {
    await renderTable(
      <LegalRevisionTable
        kind="terms"
        revisions={REVISIONS.filter(
          ({ publishedBy }) => publishedBy.nickname === null,
        )}
      />,
    );

    await expect.element(table()).toBeVisible();
    expect(bodyRows().map((row) => cellTextsOf(row)[3])).toStrictEqual([
      '削除済みの管理者',
    ]);
  });

  test('各行に管理画面の版の表示へのリンクと、利用者側のオリジンの過去版のページへのリンクを置く', async () => {
    await renderTable(
      <LegalRevisionTable kind="legal-notice" revisions={REVISIONS} />,
    );

    await expect.element(table()).toBeVisible();
    for (const { versionNumber } of REVISIONS) {
      const label = `第${String(versionNumber)}版`;
      await expect
        .element(table().getByRole('link', { name: `${label}を表示` }))
        .toHaveAttribute(
          'href',
          `/legal-documents/legal-notice/revisions/${String(versionNumber)}`,
        );
      await expect
        .element(
          table().getByRole('link', { name: `${label}を公開ページで見る` }),
        )
        .toHaveAttribute(
          'href',
          `${CLIENT_SITE_ORIGIN}/legal/revisions/${String(versionNumber)}`,
        );
    }
    await expect
      .element(table().getByRole('link', { name: '第3版を表示' }))
      .toHaveTextContent('表示');
    await expect
      .element(table().getByRole('link', { name: '第3版を公開ページで見る' }))
      .toHaveTextContent('公開ページで見る');
  });

  test('表示のリンクを選ぶと、ページを読み込み直さずに版の表示の画面へ遷移する', async () => {
    const router = await renderTable(
      <LegalRevisionTable kind="terms" revisions={REVISIONS} />,
    );

    await userEvent.click(page.getByRole('link', { name: '第2版を表示' }));

    await expect
      .poll(() => router.state.location.pathname)
      .toBe('/legal-documents/terms/revisions/2');
  });

  test('版が1件も無ければ、表の代わりにまだ公開した版が無い旨を表示する', async () => {
    await renderTable(<LegalRevisionTable kind="privacy" revisions={[]} />);

    await expect
      .element(page.getByText('まだ公開した版はありません。'))
      .toBeVisible();
    expect(table().query()).toBeNull();
    await expect
      .element(page.getByRole('heading', { level: 2, name: '改訂履歴' }))
      .toBeVisible();
  });
});

describe('アクセシビリティ', () => {
  test.each(COLOR_SCHEMES)(
    '%sの配色で、改訂履歴の表と空の状態がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderTable(
        <div>
          <LegalRevisionTable kind="terms" revisions={REVISIONS} />
          <LegalRevisionTable kind="privacy" revisions={[]} />
        </div>,
      );
      await expect.element(table()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
