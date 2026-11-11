import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import { failure, success } from '../../../test/admin-accounts-fixtures.ts';
import {
  ALL_ARTICLES,
  DELETED_AUTHOR_ARTICLE,
  DRAFT_ARTICLE,
  EDITOR_AUTHOR_ID,
  HELP_ARTICLES_PATH,
  helpArticlesQueryOf,
  OTHER_DELETED_AUTHOR_ARTICLE,
  PRICING_CATEGORY,
  PUBLISHED_ARTICLE,
  renderHelpArticlesPage,
  respondAdminHelpArticlesGraphQL,
  USAGE_CATEGORY,
} from '../../../test/admin-help-articles-fixtures.ts';
import type { GraphQLHandler } from '../../../test/admin-accounts-fixtures.ts';
import { loadAdminHelpArticlesPage } from '../../graphql/admin-help-articles.ts';
import type { AdminRole } from '../../graphql/generated/graphql.ts';
import { Route as HelpArticlesRoute } from '../../routes/_authenticated/help-articles/index.tsx';
import { parseHelpArticleFilter } from '../help/help-article-filter.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const INTERNAL_ERROR = Object.freeze({
  code: 'internal_error',
  message: '処理中に問題が発生しました。',
  status: 500,
});

const main = () => page.getByRole('main');
const table = () => main().getByRole('table', { name: 'ヘルプ記事の一覧' });
const listHeading = () =>
  main().getByRole('heading', { level: 2, name: 'ヘルプ記事の一覧' });
const rowOf = (text: string) =>
  table().getByRole('row').filter({ hasText: text });
const filterForm = () => main().getByRole('search', { name: '絞り込み' });
const creatorSelect = () =>
  filterForm().getByRole('combobox', { name: '作成者' });
const categorySelect = () =>
  filterForm().getByRole('combobox', { name: 'カテゴリ' });
const statusSelect = () =>
  filterForm().getByRole('combobox', { name: 'ステータス' });
const applyButton = () =>
  filterForm().getByRole('button', { name: '適用', exact: true });
const resetButton = () =>
  filterForm().getByRole('button', { name: '解除', exact: true });

const titlesInTable = () =>
  table()
    .getByRole('row')
    .elements()
    .slice(1)
    .map((row) => row.querySelector('td')?.textContent);

// 既定の画像の頭文字のように支援技術から隠した飾りの文字を除いた、セルの文言
const cellTexts = (text: string) =>
  [...rowOf(text).element().querySelectorAll('td')].map((cell) => {
    const copy = cell.cloneNode(true) as HTMLElement;
    for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) {
      hidden.remove();
    }
    return copy.textContent;
  });

const optionLabels = () =>
  page
    .getByRole('option')
    .elements()
    .map((option) => option.textContent);

async function chooseOption(
  trigger: ReturnType<typeof statusSelect>,
  name: string,
): Promise<void> {
  await userEvent.click(trigger);
  await userEvent.click(page.getByRole('option', { name, exact: true }));
}

const renderWith = async ({
  role = 'MODERATOR',
  articles,
  categories,
  path = HELP_ARTICLES_PATH,
}: {
  readonly role?: AdminRole;
  readonly articles?: GraphQLHandler;
  readonly categories?: GraphQLHandler;
  readonly path?: string;
} = {}) => {
  respondAdminHelpArticlesGraphQL(executeGraphQL, {
    role,
    ...(articles === undefined ? {} : { articles }),
    ...(categories === undefined ? {} : { categories }),
  });
  return renderHelpArticlesPage(role, path);
};

beforeEach(async () => {
  executeGraphQL.mockReset();
  await emulateBrowserDisplay({ timeZone: 'Asia/Tokyo', locale: 'ja-JP' });
});

afterEach(async () => {
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

test('経路の設定は画面のテストが写したものと同じ検索パラメータの検証と読み込みの関数を使う', () => {
  expect(HelpArticlesRoute.options.validateSearch).toBe(parseHelpArticleFilter);
  expect(HelpArticlesRoute.options.loader).toBe(loadAdminHelpArticlesPage);
});

describe('ヘルプ記事の一覧', () => {
  test('題名と説明の下に、下書きを含む全ての記事をAPIの順(更新日時の新しい順)に7つの列で表示する', async () => {
    await renderWith();

    await expect.element(table()).toBeVisible();
    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toHaveTextContent('ヘルプ記事');
    await expect
      .element(
        main().getByText(
          '下書きを含むすべてのヘルプ記事を、更新日時の新しい順に表示します。',
        ),
      )
      .toBeVisible();
    expect(
      table()
        .getByRole('columnheader')
        .elements()
        .map((element) => element.textContent),
    ).toStrictEqual([
      'タイトル',
      'ハンドル',
      'カテゴリ',
      'ステータス',
      'ピン留め',
      '作成者',
      '更新日時',
    ]);
    expect(titlesInTable()).toStrictEqual([
      PUBLISHED_ARTICLE.title,
      DRAFT_ARTICLE.title,
      DELETED_AUTHOR_ARTICLE.title,
      OTHER_DELETED_AUTHOR_ARTICLE.title,
    ]);
    expect(cellTexts(PUBLISHED_ARTICLE.title)).toStrictEqual([
      'Upvoteの仕組み',
      'how-upvote-works',
      '使い方',
      '公開',
      'あり',
      '山田サポート',
      '2026年11月10日(火) 14:30',
    ]);
    expect(cellTexts(DRAFT_ARTICLE.title)).toStrictEqual([
      '料金プランの違い',
      'Pricing-Plans',
      '料金',
      '下書き',
      'なし',
      '伊藤編集',
      '2026年11月9日(月) 12:00',
    ]);
    const updatedTimes = table()
      .getByRole('row')
      .elements()
      .slice(1)
      .map((row) => row.querySelector('time')?.getAttribute('datetime'));
    expect(updatedTimes).toStrictEqual([
      PUBLISHED_ARTICLE.updatedAt,
      DRAFT_ARTICLE.updatedAt,
      DELETED_AUTHOR_ARTICLE.updatedAt,
      OTHER_DELETED_AUTHOR_ARTICLE.updatedAt,
    ]);
  });

  test('タイトルは記事の編集画面へのリンクにし、削除された管理者の記事は作成者を「削除済みの管理者」と示す', async () => {
    await renderWith();

    await expect
      .element(
        rowOf(DRAFT_ARTICLE.title).getByRole('link', {
          name: DRAFT_ARTICLE.title,
        }),
      )
      .toHaveAttribute('href', `${HELP_ARTICLES_PATH}/${DRAFT_ARTICLE.id}`);
    expect(cellTexts(DELETED_AUTHOR_ARTICLE.title)[5]).toBe('削除済みの管理者');
    expect(cellTexts(OTHER_DELETED_AUTHOR_ARTICLE.title)[5]).toBe(
      '削除済みの管理者',
    );
  });

  test('ページ分けをせず、多数の記事も全件を1つの表に表示する', async () => {
    const many = Array.from({ length: 120 }, (_, index) => ({
      ...DRAFT_ARTICLE,
      id: `${DRAFT_ARTICLE.id}-${String(index)}`,
      title: `記事${String(index)}`,
    }));
    await renderWith({ articles: () => success(helpArticlesQueryOf(many)) });

    await expect.element(rowOf('記事119')).toBeInTheDocument();
    expect(table().getByRole('row').elements()).toHaveLength(121);
    expect(
      main().getByRole('navigation', { name: 'ページ送り' }).query(),
    ).toBeNull();
  });

  test('記事が1件も無い時は「ヘルプ記事はまだありません。」と示す', async () => {
    await renderWith({ articles: () => success(helpArticlesQueryOf([])) });

    await expect
      .element(main().getByText('ヘルプ記事はまだありません。'))
      .toBeVisible();
    expect(
      main().getByText('条件に一致するヘルプ記事はありません。').query(),
    ).toBeNull();
  });

  test('絞り込みの結果が0件の時は、記事が無い時と区別して「条件に一致するヘルプ記事はありません。」と示す', async () => {
    await renderWith({
      path: `${HELP_ARTICLES_PATH}?creator=${EDITOR_AUTHOR_ID}&status=published`,
    });

    await expect
      .element(main().getByText('条件に一致するヘルプ記事はありません。'))
      .toBeVisible();
    expect(main().getByText('ヘルプ記事はまだありません。').query()).toBeNull();
  });

  test('取得の失敗は一覧の場所に再試行とともに示して問い合わせを促さず、再試行で一覧の見出しへフォーカスを移して一覧を表示する', async () => {
    let available = false;
    await renderWith({
      articles: () =>
        available ? success(ALL_ARTICLES) : failure(INTERNAL_ERROR),
    });

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent('処理中に問題が発生しました。');
    await expect.element(filterForm()).toBeVisible();
    expect(
      main()
        .getByText(/問い合わせ/)
        .query(),
    ).toBeNull();
    expect(
      main()
        .getByRole('link', { name: /問い合わせ/ })
        .query(),
    ).toBeNull();
    available = true;
    await userEvent.click(main().getByRole('button', { name: '再試行' }));

    await expect.element(table()).toBeVisible();
    await expect.element(listHeading()).toHaveFocus();
  });
});

describe('ロールによる操作の出し分け', () => {
  test.each<AdminRole>(['MODERATOR', 'SUPER_ADMIN'])(
    '%sには「新規作成」と「並び順を変更」を置き、「並び順を見る」を置かない',
    async (role) => {
      await renderWith({ role });

      await expect
        .element(main().getByRole('link', { name: '新規作成' }))
        .toHaveAttribute('href', `${HELP_ARTICLES_PATH}/new`);
      await expect
        .element(main().getByRole('link', { name: '並び順を変更' }))
        .toHaveAttribute('href', `${HELP_ARTICLES_PATH}/order`);
      expect(
        main().getByRole('link', { name: '並び順を見る' }).query(),
      ).toBeNull();
    },
  );

  test('閲覧のみの管理者には「並び順を見る」だけを置き、作成と並べ替えの導線を出さない', async () => {
    await renderWith({ role: 'VIEWER' });

    await expect
      .element(main().getByRole('link', { name: '並び順を見る' }))
      .toHaveAttribute('href', `${HELP_ARTICLES_PATH}/order`);
    await expect.element(table()).toBeVisible();
    expect(main().getByRole('link', { name: '新規作成' }).query()).toBeNull();
    expect(
      main().getByRole('link', { name: '並び順を変更' }).query(),
    ).toBeNull();
  });
});

describe('絞り込み', () => {
  test('作成者は記事の作成者からニックネームの順に作って削除済みの管理者を末尾の1つにまとめ、カテゴリはAPIの順、ステータスは表示名で並べる', async () => {
    await renderWith();
    await expect.element(table()).toBeVisible();

    await userEvent.click(creatorSelect());
    expect(optionLabels()).toStrictEqual([
      'すべての作成者',
      '伊藤編集',
      '山田サポート',
      '削除済みの管理者',
    ]);
    await userEvent.keyboard('{Escape}');
    await userEvent.click(categorySelect());
    expect(optionLabels()).toStrictEqual([
      'すべてのカテゴリ',
      '料金',
      '使い方',
      'その他',
    ]);
    await userEvent.keyboard('{Escape}');
    await userEvent.click(statusSelect());
    expect(optionLabels()).toStrictEqual([
      'すべてのステータス',
      '下書き',
      '公開',
    ]);
  });

  test('「適用」で作成者・カテゴリ・ステータスを全て満たす記事だけを表示し、条件をURLに残してフォーカスを保つ', async () => {
    const router = await renderWith();
    await expect.element(table()).toBeVisible();
    const callsBefore = executeGraphQL.mock.calls.length;

    await chooseOption(creatorSelect(), '削除済みの管理者');
    await chooseOption(categorySelect(), USAGE_CATEGORY.name);
    await chooseOption(statusSelect(), '下書き');
    await userEvent.click(applyButton());

    await expect
      .poll((): unknown => router.state.location.search)
      .toEqual({
        creator: 'deleted',
        category: USAGE_CATEGORY.id,
        status: 'draft',
      });
    await expect
      .poll(titlesInTable)
      .toStrictEqual([DELETED_AUTHOR_ARTICLE.title]);
    await expect.element(applyButton()).toHaveFocus();
    expect(executeGraphQL.mock.calls.length).toBe(callsBefore);
  });

  test('URLの条件を入力欄に示して絞り込み、「解除」で条件を外して全件に戻す', async () => {
    const router = await renderWith({
      path: `${HELP_ARTICLES_PATH}?creator=deleted&category=${USAGE_CATEGORY.id}`,
    });

    await expect.element(creatorSelect()).toHaveTextContent('削除済みの管理者');
    await expect
      .element(categorySelect())
      .toHaveTextContent(USAGE_CATEGORY.name);
    await expect
      .element(statusSelect())
      .toHaveTextContent('すべてのステータス');
    expect(titlesInTable()).toStrictEqual([DELETED_AUTHOR_ARTICLE.title]);

    await userEvent.click(resetButton());

    await expect.poll((): unknown => router.state.location.search).toEqual({});
    await expect.poll(titlesInTable).toHaveLength(4);
    await expect.element(creatorSelect()).toHaveTextContent('すべての作成者');
    await expect
      .element(categorySelect())
      .toHaveTextContent('すべてのカテゴリ');
  });

  test('ブラウザの戻る・進むで前後の条件の一覧と入力欄に戻る', async () => {
    const router = await renderWith();
    await expect.element(table()).toBeVisible();

    await chooseOption(categorySelect(), PRICING_CATEGORY.name);
    await userEvent.click(applyButton());
    await expect.poll(titlesInTable).toStrictEqual([DRAFT_ARTICLE.title]);

    router.history.back();

    await expect.poll(titlesInTable).toHaveLength(4);
    await expect
      .element(categorySelect())
      .toHaveTextContent('すべてのカテゴリ');

    router.history.forward();

    await expect.poll(titlesInTable).toStrictEqual([DRAFT_ARTICLE.title]);
    await expect
      .element(categorySelect())
      .toHaveTextContent(PRICING_CATEGORY.name);
  });

  test('URLの不正な条件は未指定として扱い、全件を表示する', async () => {
    await renderWith({
      path: `${HELP_ARTICLES_PATH}?creator=&category=${'c'.repeat(65)}&status=DRAFT`,
    });

    await expect.poll(titlesInTable).toHaveLength(4);
    await expect.element(creatorSelect()).toHaveTextContent('すべての作成者');
    await expect
      .element(categorySelect())
      .toHaveTextContent('すべてのカテゴリ');
    await expect
      .element(statusSelect())
      .toHaveTextContent('すべてのステータス');
  });

  test('カテゴリの一覧の取得に失敗しても記事の一覧を表示し、カテゴリの欄は「すべてのカテゴリ」だけで操作できる', async () => {
    await renderWith({ categories: () => failure(INTERNAL_ERROR) });

    await expect.poll(titlesInTable).toHaveLength(4);
    await expect.element(categorySelect()).toBeEnabled();
    await userEvent.click(categorySelect());
    expect(optionLabels()).toStrictEqual(['すべてのカテゴリ']);
  });
});

describe('アクセシビリティ', () => {
  test.each(COLOR_SCHEMES)(
    '%sの配色で、一覧・絞り込み・削除済みの作成者の表示がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderWith();
      await expect.element(table()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test.each(COLOR_SCHEMES)(
    '%sの配色で、閲覧のみの表示と絞り込みの0件がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderWith({
        role: 'VIEWER',
        path: `${HELP_ARTICLES_PATH}?creator=${EDITOR_AUTHOR_ID}&status=published`,
      });
      await expect
        .element(main().getByText('条件に一致するヘルプ記事はありません。'))
        .toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test.each(COLOR_SCHEMES)(
    '%sの配色で、取得の失敗の表示がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderWith({ articles: () => failure(INTERNAL_ERROR) });
      await expect.element(main().getByRole('alert')).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
