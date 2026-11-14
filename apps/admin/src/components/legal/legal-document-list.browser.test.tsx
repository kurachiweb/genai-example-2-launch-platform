import type { ReactNode } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import {
  LEGAL_NOTICE_PUBLISHED_AT,
  TERMS_PUBLISHED_AT,
} from '../../../test/legal-documents-fixtures.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import type { LegalDocumentSummaryView } from '../../graphql/admin-legal-documents.ts';
import { LegalDocumentList } from './legal-document-list.tsx';

// ログイン中の管理者の取得の補助が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const CLIENT_SITE_ORIGIN = 'https://client.example';

const DOCUMENTS: readonly LegalDocumentSummaryView[] = Object.freeze([
  {
    kind: 'terms',
    latestVersionNumber: 3,
    latestPublishedAt: TERMS_PUBLISHED_AT,
    hasDraft: true,
  },
  {
    kind: 'privacy',
    latestVersionNumber: null,
    latestPublishedAt: null,
    hasDraft: false,
  },
  {
    kind: 'legal-notice',
    latestVersionNumber: 1,
    latestPublishedAt: LEGAL_NOTICE_PUBLISHED_AT,
    hasDraft: false,
  },
]);

const DISPLAY = Object.freeze({ timeZone: 'Asia/Tokyo', locale: 'ja-JP' });

// 日時の部品はアプリの文書の外枠が置く表示設定の内側で描く
const renderList = (element: ReactNode) =>
  renderInRouter(
    <DisplayPreferencesProvider initial={DISPLAY}>
      {element}
    </DisplayPreferencesProvider>,
  );

const table = () => page.getByRole('table', { name: '法務文書の一覧' });
const rowOf = (name: string) =>
  table().getByRole('row').filter({ hasText: name });
const cellTextsOf = (name: string) =>
  [...rowOf(name).element().querySelectorAll('td')].map(
    (cell) => cell.textContent,
  );

describe('法務文書の一覧', () => {
  test('3文書を名前・最新版の版番号または未公開・公開日時・下書きの有無とともに表示する', async () => {
    await renderList(<LegalDocumentList documents={DOCUMENTS} />);

    await expect.element(table()).toBeVisible();
    expect(
      table()
        .getByRole('columnheader')
        .elements()
        .map((element) => element.textContent),
    ).toStrictEqual(['文書', '最新版', '公開日時', '下書き', '操作']);
    expect(
      table()
        .getByRole('row')
        .elements()
        .slice(1)
        .map((row) => row.querySelector('td')?.textContent),
    ).toStrictEqual(['利用規約', 'プライバシーポリシー', '法的通知']);
    expect(cellTextsOf('利用規約').slice(1, 4)).toStrictEqual([
      '第3版',
      expect.stringContaining('2026'),
      'あり',
    ]);
    expect(cellTextsOf('プライバシーポリシー').slice(1, 4)).toStrictEqual([
      '未公開',
      'なし',
      'なし',
    ]);
    expect(cellTextsOf('法的通知').slice(1, 4)).toStrictEqual([
      '第1版',
      expect.stringContaining('2026'),
      'なし',
    ]);
  });

  test('公開日時は年を含む形式で<time>のdatetimeに公開日時を持つ', async () => {
    await renderList(<LegalDocumentList documents={DOCUMENTS} />);

    await expect.element(table()).toBeVisible();
    const termsTime = rowOf('利用規約').element().querySelector('time');
    expect(termsTime?.getAttribute('dateTime')).toBe(TERMS_PUBLISHED_AT);
    expect(termsTime?.textContent).toContain('2026');
    expect(
      rowOf('プライバシーポリシー').element().querySelector('time'),
    ).toBeNull();
  });

  test('各行に編集の画面へのリンクと、利用者側のオリジンの公開ページへのリンクを置く', async () => {
    await renderList(<LegalDocumentList documents={DOCUMENTS} />);

    await expect.element(table()).toBeVisible();
    const expected = [
      ['利用規約', '/legal-documents/terms', '/terms'],
      ['プライバシーポリシー', '/legal-documents/privacy', '/privacy'],
      ['法的通知', '/legal-documents/legal-notice', '/legal'],
    ] as const;
    for (const [name, editHref, publicPath] of expected) {
      await expect
        .element(rowOf(name).getByRole('link', { name: `${name}を編集` }))
        .toHaveAttribute('href', editHref);
      await expect
        .element(
          rowOf(name).getByRole('link', {
            name: `${name}の公開ページを開く`,
          }),
        )
        .toHaveAttribute('href', `${CLIENT_SITE_ORIGIN}${publicPath}`);
    }
    await expect
      .element(rowOf('利用規約').getByRole('link', { name: '利用規約を編集' }))
      .toHaveTextContent('編集');
  });

  test('編集のリンクを選ぶと、ページを読み込み直さずに編集の画面へ遷移する', async () => {
    const router = await renderList(
      <LegalDocumentList documents={DOCUMENTS} />,
    );

    await userEvent.click(page.getByRole('link', { name: '法的通知を編集' }));

    await expect
      .poll(() => router.state.location.pathname)
      .toBe('/legal-documents/legal-notice');
  });

  test('読み込み中は表の代わりに読み込み中の状態を示す', async () => {
    await renderList(<LegalDocumentList documents={undefined} />);

    await expect
      .element(page.getByRole('status'))
      .toHaveTextContent('読み込み中');
    expect(table().query()).toBeNull();
    await expect
      .element(page.getByRole('heading', { level: 2, name: '法務文書の一覧' }))
      .toBeVisible();
  });

  test('取得の失敗は文言と再試行の操作だけで示し、問い合わせのボタンと問い合わせを促す文を出さず、再試行で一覧の見出しへフォーカスを移す', async () => {
    const onRetry = vi.fn();
    const message =
      'ページを表示できませんでした。時間をおいて再度お試しください。';
    await renderList(
      <LegalDocumentList documents={undefined} error={{ message, onRetry }} />,
    );

    await expect.element(page.getByRole('alert')).toHaveTextContent(message);
    expect(page.getByRole('status').query()).toBeNull();
    expect(page.getByRole('link', { name: 'お問い合わせ' }).query()).toBeNull();
    expect(document.body.textContent).not.toContain('お問い合わせ');

    await userEvent.click(page.getByRole('button', { name: '再試行' }));

    expect(onRetry).toHaveBeenCalledOnce();
    await expect
      .element(page.getByRole('heading', { level: 2, name: '法務文書の一覧' }))
      .toHaveFocus();
  });
});

describe('アクセシビリティ', () => {
  test.each(COLOR_SCHEMES)(
    '%sの配色で、一覧・読み込み中・失敗の表示がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderList(
        <div>
          <LegalDocumentList documents={DOCUMENTS} />
          <LegalDocumentList documents={undefined} />
          <LegalDocumentList
            documents={undefined}
            error={{
              message: '一覧を表示できませんでした。',
              onRetry: vi.fn(),
            }}
          />
        </div>,
      );
      await expect.element(table()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
