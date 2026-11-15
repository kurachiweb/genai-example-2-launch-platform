import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import { Toaster } from '../../../lib/components/feedback/toaster.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import {
  callsOf,
  failure,
  type GraphQLHandler,
  success,
} from '../../../test/admin-accounts-fixtures.ts';
import {
  type AdminHelpArticleRowFields,
  DRAFT_ARTICLE,
  HELP_ARTICLE_ORDER_PATH,
  helpArticlesQueryOf,
  ORDER_ARTICLES,
  ORDER_OTHER_C,
  ORDER_OTHER_D,
  ORDER_OTHER_E,
  ORDER_PINNED_A,
  ORDER_PINNED_B,
  OTHER_CATEGORY,
  PRICING_CATEGORY,
  renderHelpArticleOrderPage,
  respondAdminHelpArticlesGraphQL,
  USAGE_CATEGORY,
} from '../../../test/admin-help-articles-fixtures.ts';
import { loadAdminHelpArticlesPage } from '../../graphql/admin-help-articles.ts';
import {
  AdminHelpArticlesDocument,
  AdminReorderHelpArticlesDocument,
  type AdminRole,
} from '../../graphql/generated/graphql.ts';
import { Route as HelpArticleOrderRoute } from '../../routes/_authenticated/help-articles/order.tsx';
import { parseHelpArticleOrderSearch } from '../help/help-article-order-search.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const OUTDATED_MESSAGE =
  '並び順が別の画面で変更されました。最新の並びを読み込んでから並べ替えてください。';

const AUDITED_NOTICE = 'この操作は監査ログに記録されます。';

const INTERNAL_ERROR = Object.freeze({
  code: 'internal_error',
  message: '処理中に問題が発生しました。',
  status: 500,
});

const USAGE_PATH = `${HELP_ARTICLE_ORDER_PATH}?category=${USAGE_CATEGORY.id}`;

const main = () => page.getByRole('main');
const categorySelect = () =>
  main().getByRole('combobox', { name: 'カテゴリ', exact: true });
const groupOf = (name: 'ピン留めの記事' | 'その他の記事') =>
  main().getByRole('region', { name, exact: true });
const listOf = (name: 'ピン留めの記事' | 'その他の記事') =>
  groupOf(name).getByRole('list', { name, exact: true });
const moveButton = (title: string, direction: '上' | '下') =>
  main().getByRole('button', {
    name: `${title}を${direction}へ移動`,
    exact: true,
  });
const saveButton = () =>
  main().getByRole('button', { name: '保存', exact: true });
const undoButton = () =>
  main().getByRole('button', { name: '元に戻す', exact: true });
const reloadButton = () =>
  main().getByRole('button', { name: '最新の並びを読み込む', exact: true });

const titlesOf = (name: 'ピン留めの記事' | 'その他の記事') =>
  listOf(name)
    .getByRole('listitem')
    .elements()
    .map(
      (item) =>
        item.querySelector('[data-slot="help-article-title"]')?.textContent,
    );

const statusesOf = (name: 'ピン留めの記事' | 'その他の記事') =>
  listOf(name)
    .getByRole('listitem')
    .elements()
    .map((item) => item.querySelector('[data-slot="badge"]')?.textContent);

const renderWith = async ({
  role = 'MODERATOR',
  articles = () => success(ORDER_ARTICLES),
  categories,
  reorder,
  path = USAGE_PATH,
}: {
  readonly role?: AdminRole;
  readonly articles?: GraphQLHandler;
  readonly categories?: GraphQLHandler;
  readonly reorder?: GraphQLHandler;
  readonly path?: string;
} = {}) => {
  respondAdminHelpArticlesGraphQL(executeGraphQL, {
    role,
    articles,
    ...(categories === undefined ? {} : { categories }),
    ...(reorder === undefined ? {} : { reorder }),
  });
  await render(<Toaster />);
  return renderHelpArticleOrderPage(role, path);
};

const reorderedOf = (
  rows: readonly AdminHelpArticleRowFields[],
): readonly AdminHelpArticleRowFields[] =>
  rows.map((row, index) => ({ ...row, sortOrder: index + 1 }));

// 描き直しのたびに一覧の並びを記録し、取得の結果が届く前の一瞬の表示も見落とさない
function recordTitles(name: 'ピン留めの記事' | 'その他の記事') {
  const snapshots: (readonly (string | null | undefined)[])[] = [];
  const observer = new MutationObserver(() => {
    snapshots.push(listOf(name).query() === null ? [] : titlesOf(name));
  });
  observer.observe(main().element(), {
    childList: true,
    subtree: true,
    characterData: true,
  });
  return {
    snapshots,
    stop: () => {
      observer.disconnect();
    },
  };
}

const OUTDATED = Object.freeze({
  code: 'help_order_outdated',
  message: OUTDATED_MESSAGE,
  status: 409,
});

const ADDED_ARTICLE = Object.freeze({
  ...ORDER_OTHER_E,
  id: '01JD0HART00000000000000016',
  handle: 'new-article',
  title: '新しい記事',
  sortOrder: 6,
});

beforeEach(() => {
  executeGraphQL.mockReset();
});

afterEach(() => {
  toast.dismiss();
  applyColorScheme('light');
});

test('経路の設定は画面のテストが写したものと同じ検索パラメータの検証と読み込みの関数を使う', () => {
  expect(HelpArticleOrderRoute.options.validateSearch).toBe(
    parseHelpArticleOrderSearch,
  );
  expect(HelpArticleOrderRoute.options.loader).toBe(loadAdminHelpArticlesPage);
});

describe('カテゴリの選択と記事の並び', () => {
  test('題名と説明の下に、選んだカテゴリの全ての記事を2つの群に現在の並び順でステータスとともに示す', async () => {
    await renderWith();

    await expect.element(listOf('その他の記事')).toBeVisible();
    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toHaveTextContent('ヘルプ記事の並び順');
    await expect
      .element(
        main().getByText(
          'カテゴリごとに、ヘルプトップとフッターに並ぶ記事の順を変更します。ピン留めの記事は、その他の記事より前に並びます。',
        ),
      )
      .toBeVisible();
    await expect.element(categorySelect()).toHaveTextContent('使い方');
    await expect
      .element(groupOf('ピン留めの記事').getByRole('heading', { level: 2 }))
      .toHaveTextContent('ピン留めの記事');
    await expect
      .element(groupOf('その他の記事').getByRole('heading', { level: 2 }))
      .toHaveTextContent('その他の記事');
    expect(titlesOf('ピン留めの記事')).toStrictEqual([
      ORDER_PINNED_B.title,
      ORDER_PINNED_A.title,
    ]);
    expect(statusesOf('ピン留めの記事')).toStrictEqual(['下書き', '公開']);
    expect(titlesOf('その他の記事')).toStrictEqual([
      ORDER_OTHER_C.title,
      ORDER_OTHER_D.title,
      ORDER_OTHER_E.title,
    ]);
    expect(statusesOf('その他の記事')).toStrictEqual([
      '公開',
      '下書き',
      '公開',
    ]);
    await expect.element(main()).toHaveTextContent(AUDITED_NOTICE);
  });

  test('カテゴリの指定が無ければ並び順の先頭のカテゴリを選び、記事の無い群は「該当する記事はありません。」と示す', async () => {
    await renderWith({ path: HELP_ARTICLE_ORDER_PATH });

    await expect.element(categorySelect()).toHaveTextContent('料金');
    await expect
      .element(groupOf('ピン留めの記事'))
      .toHaveTextContent('該当する記事はありません。');
    expect(listOf('ピン留めの記事').query()).toBeNull();
    expect(titlesOf('その他の記事')).toStrictEqual([DRAFT_ARTICLE.title]);
  });

  test('不正な値や存在しないカテゴリの指定は、並び順の先頭のカテゴリを選ぶ', async () => {
    await renderWith({
      path: `${HELP_ARTICLE_ORDER_PATH}?category=${'c'.repeat(65)}`,
    });
    await expect.element(categorySelect()).toHaveTextContent('料金');
    expect(titlesOf('その他の記事')).toStrictEqual([DRAFT_ARTICLE.title]);
  });

  test('存在しないカテゴリの指定も、並び順の先頭のカテゴリを選ぶ', async () => {
    await renderWith({
      path: `${HELP_ARTICLE_ORDER_PATH}?category=01JD0HCAT00000000000000099`,
    });
    await expect.element(categorySelect()).toHaveTextContent('料金');
    expect(titlesOf('その他の記事')).toStrictEqual([DRAFT_ARTICLE.title]);
  });

  test('カテゴリの選択肢はカテゴリの並び順で、選ぶとURLに残して並びを替え、戻る操作で前のカテゴリに戻る', async () => {
    const router = await renderWith({ path: HELP_ARTICLE_ORDER_PATH });
    await expect.element(categorySelect()).toHaveTextContent('料金');

    await userEvent.click(categorySelect());
    expect(
      page
        .getByRole('option')
        .elements()
        .map((option) => option.textContent),
    ).toStrictEqual([
      PRICING_CATEGORY.name,
      USAGE_CATEGORY.name,
      OTHER_CATEGORY.name,
    ]);
    await userEvent.click(
      page.getByRole('option', { name: USAGE_CATEGORY.name, exact: true }),
    );

    await expect.poll(() => titlesOf('ピン留めの記事')).toHaveLength(2);
    expect(router.state.location.search).toEqual({
      category: USAGE_CATEGORY.id,
    });
    expect(callsOf(executeGraphQL, AdminHelpArticlesDocument)).toHaveLength(1);

    router.history.back();

    await expect.element(categorySelect()).toHaveTextContent('料金');
    expect(titlesOf('その他の記事')).toStrictEqual([DRAFT_ARTICLE.title]);
  });

  test('保存していない並びはカテゴリを切り替えると破棄し、戻ると現在の並び順で示す', async () => {
    const router = await renderWith();
    await expect.element(listOf('その他の記事')).toBeVisible();

    await userEvent.click(moveButton(ORDER_OTHER_E.title, '上'));
    await userEvent.click(categorySelect());
    await userEvent.click(
      page.getByRole('option', { name: PRICING_CATEGORY.name, exact: true }),
    );
    await expect.element(categorySelect()).toHaveTextContent('料金');

    router.history.back();

    await expect.element(categorySelect()).toHaveTextContent('使い方');
    expect(titlesOf('その他の記事')).toStrictEqual([
      ORDER_OTHER_C.title,
      ORDER_OTHER_D.title,
      ORDER_OTHER_E.title,
    ]);
  });
});

describe('並べ替えと保存', () => {
  test('各群の中で並べ替え、保存でピン留めの群に続けてその他の群の順のIDを送り、成功を知らせて新しい並びを示す', async () => {
    const saved = reorderedOf([
      ORDER_PINNED_A,
      ORDER_PINNED_B,
      ORDER_OTHER_E,
      ORDER_OTHER_C,
      ORDER_OTHER_D,
    ]);
    let current = ORDER_ARTICLES;
    const reorder = vi.fn<GraphQLHandler>(() => {
      current = helpArticlesQueryOf([DRAFT_ARTICLE, ...saved]);
      return success({ reorderHelpArticles: saved });
    });
    await renderWith({ articles: () => success(current), reorder });
    await expect.element(listOf('その他の記事')).toBeVisible();

    await userEvent.click(moveButton(ORDER_PINNED_A.title, '上'));
    await userEvent.click(moveButton(ORDER_OTHER_E.title, '上'));
    await userEvent.click(moveButton(ORDER_OTHER_E.title, '上'));
    expect(titlesOf('ピン留めの記事')).toStrictEqual([
      ORDER_PINNED_A.title,
      ORDER_PINNED_B.title,
    ]);
    expect(titlesOf('その他の記事')).toStrictEqual([
      ORDER_OTHER_E.title,
      ORDER_OTHER_C.title,
      ORDER_OTHER_D.title,
    ]);
    await userEvent.click(saveButton());

    await expect
      .element(page.getByText('並び順を保存しました。', { exact: true }))
      .toBeVisible();
    expect(reorder).toHaveBeenCalledExactlyOnceWith({
      categoryId: USAGE_CATEGORY.id,
      orderedIds: [
        ORDER_PINNED_A.id,
        ORDER_PINNED_B.id,
        ORDER_OTHER_E.id,
        ORDER_OTHER_C.id,
        ORDER_OTHER_D.id,
      ],
    });
    expect(titlesOf('ピン留めの記事')).toStrictEqual([
      ORDER_PINNED_A.title,
      ORDER_PINNED_B.title,
    ]);
    expect(titlesOf('その他の記事')).toStrictEqual([
      ORDER_OTHER_E.title,
      ORDER_OTHER_C.title,
      ORDER_OTHER_D.title,
    ]);
    await expect.element(saveButton()).toHaveFocus();
  });

  test('「元に戻す」で保存せずに保存前の並びへ戻す', async () => {
    await renderWith();
    await expect.element(listOf('その他の記事')).toBeVisible();

    await userEvent.click(moveButton(ORDER_PINNED_B.title, '下'));
    await userEvent.click(moveButton(ORDER_OTHER_C.title, '下'));
    await userEvent.click(undoButton());

    expect(titlesOf('ピン留めの記事')).toStrictEqual([
      ORDER_PINNED_B.title,
      ORDER_PINNED_A.title,
    ]);
    expect(titlesOf('その他の記事')).toStrictEqual([
      ORDER_OTHER_C.title,
      ORDER_OTHER_D.title,
      ORDER_OTHER_E.title,
    ]);
    expect(
      callsOf(executeGraphQL, AdminReorderHelpArticlesDocument),
    ).toHaveLength(0);
    await expect.element(undoButton()).toHaveFocus();
  });

  test('並びを表示した後に記事が増えていると、古い並びの案内と「最新の並びを読み込む」を示し、読み込むと最新の並びで並べ替えを続けられる', async () => {
    const added = {
      ...ORDER_OTHER_E,
      id: '01JD0HART00000000000000016',
      handle: 'new-article',
      title: '新しい記事',
      sortOrder: 6,
    };
    let current = ORDER_ARTICLES;
    const reorder = vi.fn<GraphQLHandler>(() =>
      failure({
        code: 'help_order_outdated',
        message: OUTDATED_MESSAGE,
        status: 409,
      }),
    );
    await renderWith({ articles: () => success(current), reorder });
    await expect.element(listOf('その他の記事')).toBeVisible();

    current = helpArticlesQueryOf([...ORDER_ARTICLES.adminHelpArticles, added]);
    await userEvent.click(moveButton(ORDER_OTHER_E.title, '上'));
    await userEvent.click(saveButton());

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(OUTDATED_MESSAGE);
    expect(titlesOf('その他の記事')).toStrictEqual([
      ORDER_OTHER_C.title,
      ORDER_OTHER_E.title,
      ORDER_OTHER_D.title,
    ]);

    await userEvent.click(reloadButton());

    await expect.element(reloadButton()).not.toBeInTheDocument();
    expect(main().getByRole('alert').query()).toBeNull();
    expect(titlesOf('その他の記事')).toStrictEqual([
      ORDER_OTHER_C.title,
      ORDER_OTHER_D.title,
      ORDER_OTHER_E.title,
      added.title,
    ]);
    await expect.element(moveButton(ORDER_PINNED_B.title, '下')).toHaveFocus();

    reorder.mockImplementation(() => success({ reorderHelpArticles: [] }));
    await userEvent.click(saveButton());

    await expect
      .element(page.getByText('並び順を保存しました。', { exact: true }))
      .toBeVisible();
    expect(reorder).toHaveBeenLastCalledWith({
      categoryId: USAGE_CATEGORY.id,
      orderedIds: [
        ORDER_PINNED_B.id,
        ORDER_PINNED_A.id,
        ORDER_OTHER_C.id,
        ORDER_OTHER_D.id,
        ORDER_OTHER_E.id,
        added.id,
      ],
    });
  });

  test('古い並び以外の保存の失敗はAPIの文言を示し、「最新の並びを読み込む」を出さずに並べ替えを続ける', async () => {
    await renderWith({ reorder: () => failure(INTERNAL_ERROR) });
    await expect.element(listOf('その他の記事')).toBeVisible();

    await userEvent.click(saveButton());

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(INTERNAL_ERROR.message);
    expect(reloadButton().query()).toBeNull();
    await expect.element(saveButton()).toHaveFocus();
  });
});

describe('保存と読み込みの直後の表示とフォーカス', () => {
  test('保存の成功の直後に、保存の前の並び順を一瞬も示さない', async () => {
    const saved = reorderedOf([
      ORDER_PINNED_B,
      ORDER_PINNED_A,
      ORDER_OTHER_E,
      ORDER_OTHER_C,
      ORDER_OTHER_D,
    ]);
    let current = ORDER_ARTICLES;
    await renderWith({
      articles: () => success(current),
      reorder: () => {
        current = helpArticlesQueryOf([DRAFT_ARTICLE, ...saved]);
        return success({ reorderHelpArticles: saved });
      },
    });
    await expect.element(listOf('その他の記事')).toBeVisible();
    await userEvent.click(moveButton(ORDER_OTHER_E.title, '上'));
    await userEvent.click(moveButton(ORDER_OTHER_E.title, '上'));

    const shown = recordTitles('その他の記事');
    await userEvent.click(saveButton());
    await expect
      .element(page.getByText('並び順を保存しました。', { exact: true }))
      .toBeVisible();
    await expect
      .poll(() => callsOf(executeGraphQL, AdminHelpArticlesDocument).length)
      .toBe(2);
    await expect
      .poll(() => titlesOf('その他の記事'))
      .toStrictEqual([
        ORDER_OTHER_E.title,
        ORDER_OTHER_C.title,
        ORDER_OTHER_D.title,
      ]);
    shown.stop();

    expect(shown.snapshots).not.toContainEqual([
      ORDER_OTHER_C.title,
      ORDER_OTHER_D.title,
      ORDER_OTHER_E.title,
    ]);
  });

  test('「最新の並びを読み込む」の直後に、読み込む前の並び順を一瞬も示さない', async () => {
    let current = ORDER_ARTICLES;
    await renderWith({
      articles: () => success(current),
      reorder: () => failure(OUTDATED),
    });
    await expect.element(listOf('その他の記事')).toBeVisible();
    current = helpArticlesQueryOf([
      ...ORDER_ARTICLES.adminHelpArticles,
      ADDED_ARTICLE,
    ]);
    await userEvent.click(moveButton(ORDER_OTHER_E.title, '上'));
    await userEvent.click(saveButton());
    await expect.element(reloadButton()).toBeVisible();

    const shown = recordTitles('その他の記事');
    await userEvent.click(reloadButton());
    await expect.element(reloadButton()).not.toBeInTheDocument();
    shown.stop();

    expect(titlesOf('その他の記事')).toStrictEqual([
      ORDER_OTHER_C.title,
      ORDER_OTHER_D.title,
      ORDER_OTHER_E.title,
      ADDED_ARTICLE.title,
    ]);
    expect(shown.snapshots).not.toContainEqual([
      ORDER_OTHER_C.title,
      ORDER_OTHER_D.title,
      ORDER_OTHER_E.title,
    ]);
  });

  test('読み込みの間は「元に戻す」を押せないことを伝えて手元の並びを保ち、読み込みのボタンの外へ移したフォーカスを読み込みの後に奪わない', async () => {
    let reloading: Promise<unknown> | null = null;
    let finishReload: (value: unknown) => void = () => undefined;
    await renderWith({
      articles: () => reloading ?? success(ORDER_ARTICLES),
      reorder: () => failure(OUTDATED),
    });
    await expect.element(listOf('その他の記事')).toBeVisible();
    await userEvent.click(moveButton(ORDER_OTHER_E.title, '上'));
    await userEvent.click(saveButton());
    await expect.element(reloadButton()).toBeVisible();
    reloading = new Promise((resolve) => {
      finishReload = resolve;
    });

    await userEvent.click(reloadButton());
    await expect.element(undoButton()).toHaveAttribute('aria-disabled', 'true');
    undoButton().element().focus();
    await userEvent.keyboard('{Enter}');

    expect(titlesOf('その他の記事')).toStrictEqual([
      ORDER_OTHER_C.title,
      ORDER_OTHER_E.title,
      ORDER_OTHER_D.title,
    ]);
    await expect.element(undoButton()).toHaveFocus();

    finishReload(
      success(
        helpArticlesQueryOf([
          ...ORDER_ARTICLES.adminHelpArticles,
          ADDED_ARTICLE,
        ]),
      ),
    );

    await expect.element(reloadButton()).not.toBeInTheDocument();
    await expect.poll(() => titlesOf('その他の記事')).toHaveLength(4);
    await expect.element(undoButton()).toHaveFocus();
    await expect.element(undoButton()).not.toHaveAttribute('aria-disabled');
  });
});

describe('取得の失敗', () => {
  test('記事の取得の失敗は再試行とともに示して問い合わせを促さず、再試行で題名へフォーカスを移して並びを示す', async () => {
    let fail = true;
    await renderWith({
      articles: () =>
        fail ? failure(INTERNAL_ERROR) : success(ORDER_ARTICLES),
    });

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(INTERNAL_ERROR.message);
    expect(
      main().getByRole('link', { name: '問い合わせる' }).query(),
    ).toBeNull();

    fail = false;
    await userEvent.click(main().getByRole('button', { name: '再試行' }));

    await expect.element(listOf('その他の記事')).toBeVisible();
    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toHaveFocus();
  });

  test('カテゴリの一覧の取得の失敗も再試行とともに示す', async () => {
    await renderWith({ categories: () => failure(INTERNAL_ERROR) });

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(INTERNAL_ERROR.message);
    expect(groupOf('その他の記事').query()).toBeNull();
  });
});

describe('閲覧のみの管理者', () => {
  test('カテゴリを選べて並びだけを示し、移動・保存・元に戻すの導線と監査ログの案内を描かない', async () => {
    await renderWith({ role: 'VIEWER' });

    await expect.element(listOf('その他の記事')).toBeVisible();
    await expect.element(categorySelect()).toBeEnabled();
    expect(titlesOf('ピン留めの記事')).toStrictEqual([
      ORDER_PINNED_B.title,
      ORDER_PINNED_A.title,
    ]);
    expect(titlesOf('その他の記事')).toHaveLength(3);
    expect(main().getByRole('button').elements()).toHaveLength(0);
    expect(main().getByText(AUDITED_NOTICE).query()).toBeNull();
  });
});

describe('アクセシビリティ', () => {
  test.each(COLOR_SCHEMES)(
    '%sの配色で、並び・空の群・古い並びの案内がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderWith({
        reorder: () =>
          failure({
            code: 'help_order_outdated',
            message: OUTDATED_MESSAGE,
            status: 409,
          }),
      });
      await expect.element(listOf('その他の記事')).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);

      await userEvent.click(saveButton());
      await expect.element(reloadButton()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test.each(COLOR_SCHEMES)(
    '%sの配色で、閲覧のみの表示と記事の無い群がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderWith({ role: 'VIEWER', path: HELP_ARTICLE_ORDER_PATH });
      await expect.element(listOf('その他の記事')).toBeVisible();

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
