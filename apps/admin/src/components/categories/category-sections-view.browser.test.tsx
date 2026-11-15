import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { CategoryMasterEditor } from '../../../lib/components/admin/category-master-editor.tsx';
import { reportUnexpectedErrorInBrowser } from '../../../lib/start/observability/browser-error-reporting.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import type { CategorySection } from '../../composition/category-sections.ts';
import { CategorySectionsView } from './category-sections-view.tsx';

// ログイン中の管理者の取得の補助が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

vi.mock('../../../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

const UNEXPECTED_MESSAGE =
  'ページを表示できませんでした。時間をおいて再度お試しください。';

const PRODUCT_TITLE = 'プロダクトカテゴリ';

const HELP_TITLE = 'ヘルプ記事カテゴリ';

const BROKEN_TITLE = '通報カテゴリ';

const resolved = (): Promise<void> => Promise.resolve();

const editorOf = (title: string, name: string) =>
  function FakeSection() {
    return (
      <CategoryMasterEditor
        title={title}
        categories={[{ id: `${title}-1`, name, systemDefault: false }]}
        withHandle={false}
        canEdit
        onCreate={resolved}
        onUpdate={resolved}
        onDelete={resolved}
        failureMessageOf={() => '失敗しました。'}
      />
    );
  };

const ProductSection = editorOf(PRODUCT_TITLE, '開発ツール');

const HelpSection = editorOf(HELP_TITLE, 'はじめに');

const RecoveredSection = editorOf(BROKEN_TITLE, 'スパム');

let sectionFailing = false;

// Reactは失敗した描画をやり直すため、テストが失敗を止めるまで描画のたびに失敗する
function ThrowingSection() {
  if (sectionFailing) {
    throw new Error('区画の描画の失敗');
  }
  return <RecoveredSection />;
}

function ThrowingGraphQLSection(): never {
  throw new GraphQLClientError({
    code: 'upstream_unavailable',
    message: '現在ご利用いただけません。時間をおいて再度お試しください。',
    status: 503,
  });
}

const sectionOf = (
  id: string,
  order: number,
  title: string,
  component: CategorySection['component'],
): CategorySection => ({ id, order, title, component });

const renderSections = (sections: readonly CategorySection[]) =>
  renderInRouter(
    <main className="p-4">
      <h1>カテゴリ</h1>
      <CategorySectionsView sections={sections} />
    </main>,
  );

const sectionHeadings = () =>
  page
    .getByRole('heading', { level: 2 })
    .elements()
    .map((heading) => heading.textContent);

beforeEach(() => {
  sectionFailing = false;
  vi.mocked(reportUnexpectedErrorInBrowser).mockClear();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('CategorySectionsView', () => {
  test('登録の順によらず区画をorderの順に、題を見出しにして並べる', async () => {
    await renderSections([
      sectionOf('help-center.help-categories', 20, HELP_TITLE, HelpSection),
      sectionOf(
        'product-launch.product-categories',
        10,
        PRODUCT_TITLE,
        ProductSection,
      ),
    ]);

    await expect
      .element(page.getByRole('table', { name: HELP_TITLE }))
      .toBeVisible();
    expect(sectionHeadings()).toStrictEqual([PRODUCT_TITLE, HELP_TITLE]);
    expect(
      page
        .getByRole('region')
        .elements()
        .map((region) => region.getAttribute('aria-labelledby') !== null),
    ).toStrictEqual([true, true]);
  });

  test('1つの区画の描画の失敗はその位置に題の見出しと問い合わせを促さない文言と再試行で示し、他の区画の表示を続け、エラートラッキングへ送る', async () => {
    sectionFailing = true;
    await renderSections([
      sectionOf('a.product', 10, PRODUCT_TITLE, ProductSection),
      sectionOf('b.broken', 20, BROKEN_TITLE, ThrowingSection),
      sectionOf('c.help', 30, HELP_TITLE, HelpSection),
    ]);

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(UNEXPECTED_MESSAGE);
    await expect
      .element(
        page.getByRole('region', { name: BROKEN_TITLE }).getByRole('alert'),
      )
      .toBeVisible();
    expect(sectionHeadings()).toStrictEqual([
      PRODUCT_TITLE,
      BROKEN_TITLE,
      HELP_TITLE,
    ]);
    await expect
      .element(page.getByRole('table', { name: PRODUCT_TITLE }))
      .toBeVisible();
    await expect
      .element(page.getByRole('table', { name: HELP_TITLE }))
      .toBeVisible();
    expect(page.getByRole('link').elements()).toHaveLength(0);
    expect(document.body.textContent).not.toContain('お問い合わせ');
    expect(reportUnexpectedErrorInBrowser).toHaveBeenCalledWith(
      expect.any(Error),
      'render',
    );

    sectionFailing = false;
    await userEvent.click(page.getByRole('button', { name: '再試行' }));

    await expect
      .element(page.getByRole('table', { name: BROKEN_TITLE }))
      .toBeVisible();
    expect(sectionHeadings()).toStrictEqual([
      PRODUCT_TITLE,
      BROKEN_TITLE,
      HELP_TITLE,
    ]);
  });

  test('再試行で、消えた再試行のボタンから描き直した区画の題の見出しへフォーカスを移す', async () => {
    sectionFailing = true;
    await renderSections([
      sectionOf('a.product', 10, PRODUCT_TITLE, ProductSection),
      sectionOf('b.broken', 20, BROKEN_TITLE, ThrowingSection),
    ]);
    await expect.element(page.getByRole('alert')).toBeVisible();
    sectionFailing = false;

    await userEvent.click(page.getByRole('button', { name: '再試行' }));

    await expect
      .element(page.getByRole('table', { name: BROKEN_TITLE }))
      .toBeVisible();
    await expect
      .element(
        page
          .getByRole('region', { name: BROKEN_TITLE })
          .getByRole('heading', { level: 2, name: BROKEN_TITLE }),
      )
      .toHaveFocus();
  });

  test('再試行でも描画に失敗したときは、その区画の題の見出しへフォーカスを移す', async () => {
    sectionFailing = true;
    await renderSections([
      sectionOf('a.product', 10, PRODUCT_TITLE, ProductSection),
      sectionOf('b.broken', 20, BROKEN_TITLE, ThrowingSection),
    ]);
    await expect.element(page.getByRole('alert')).toBeVisible();

    await userEvent.click(page.getByRole('button', { name: '再試行' }));

    await expect.element(page.getByRole('alert')).toBeVisible();
    await expect
      .element(page.getByRole('heading', { level: 2, name: BROKEN_TITLE }))
      .toHaveFocus();
  });

  test('GraphQLの失敗はAPIの文言で示し、取得の補助が送るためエラートラッキングへ送り直さない', async () => {
    await renderSections([
      sectionOf('a.graphql', 10, BROKEN_TITLE, ThrowingGraphQLSection),
    ]);

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('現在ご利用いただけません。');
    expect(reportUnexpectedErrorInBrowser).not.toHaveBeenCalled();
  });

  test.each(COLOR_SCHEMES)(
    '%sの配色で、区画の並びと失敗の表示がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      sectionFailing = true;
      await renderSections([
        sectionOf('a.product', 10, PRODUCT_TITLE, ProductSection),
        sectionOf('b.broken', 20, BROKEN_TITLE, ThrowingSection),
      ]);
      await expect.element(page.getByRole('alert')).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
