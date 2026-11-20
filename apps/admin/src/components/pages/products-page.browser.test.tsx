import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import type { GraphQLResult } from '../../../lib/utilities/graphql/graphql-result.ts';
import { failure, success } from '../../../test/admin-accounts-fixtures.ts';
import { PRODUCT_ID } from '../../../test/moderation-fixtures.ts';
import {
  CATEGORY_ID,
  CATEGORY_OPTIONS,
  categoryOptionsCallsOf,
  FIRST_PRODUCTS_PAGE,
  LAUNCHED_PRODUCT_NODE,
  OTHER_CATEGORY_ID,
  type CategoryOptionsHandler,
  type ProductsHandler,
  PRODUCTS_PATH,
  productsQueryOf,
  productsVariablesOf,
  renderModerationProductsPage,
  respondModerationProductsGraphQL,
  SUSPENDED_OWNER_PRODUCT_NODE,
  UNLAUNCHED_PRODUCT_NODE,
} from '../../../test/moderation-products-fixtures.ts';
import type {
  AdminProductsQuery,
  AdminRole,
} from '../../graphql/generated/graphql.ts';
import { Route as ProductsRoute } from '../../routes/_authenticated/products/index.tsx';
import { toProductModerationSearch } from '../moderation/shared/moderation-search.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const main = () => page.getByRole('main');
const table = () => main().getByRole('table', { name: 'プロダクトの一覧' });
const listHeading = () =>
  main().getByRole('heading', { level: 2, name: 'プロダクトの一覧' });
const rowOf = (text: string) =>
  table().getByRole('row').filter({ hasText: text });
const filterForm = () => main().getByRole('search', { name: '絞り込み' });
const textField = (name: string) =>
  filterForm().getByRole('textbox', { name, exact: true });
const selectField = (name: string) =>
  filterForm().getByRole('combobox', { name, exact: true });
const applyButton = () =>
  filterForm().getByRole('button', { name: '適用', exact: true });
const resetButton = () =>
  filterForm().getByRole('button', { name: '解除', exact: true });
const pagination = () => main().getByRole('navigation', { name: 'ページ送り' });
const nextButton = () => pagination().getByRole('button', { name: '次へ' });
const previousButton = () => pagination().getByRole('button', { name: '前へ' });

const lastVariables = () => productsVariablesOf(executeGraphQL).at(-1);

const cellTexts = (text: string) =>
  [...rowOf(text).element().querySelectorAll('td')].map(
    (cell) => cell.textContent,
  );

async function chooseOption(
  trigger: ReturnType<typeof selectField>,
  name: string,
): Promise<void> {
  await userEvent.click(trigger);
  await userEvent.click(page.getByRole('option', { name, exact: true }));
}

const optionTexts = () =>
  page
    .getByRole('option')
    .elements()
    .map((option) => option.textContent);

const renderWith = async ({
  role = 'VIEWER',
  products,
  categories,
  path = PRODUCTS_PATH,
}: {
  readonly role?: AdminRole;
  readonly products?: ProductsHandler;
  readonly categories?: CategoryOptionsHandler;
  readonly path?: string;
} = {}) => {
  respondModerationProductsGraphQL(executeGraphQL, {
    role,
    ...(products === undefined ? {} : { products }),
    ...(categories === undefined ? {} : { categories }),
  });
  return renderModerationProductsPage(role, path);
};

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

const deferred = <T,>(): Deferred<T> => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

beforeEach(async () => {
  executeGraphQL.mockReset();
  await emulateBrowserDisplay({ timeZone: 'Asia/Tokyo', locale: 'ja-JP' });
});

afterEach(async () => {
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('経路の設定', () => {
  type ProductsLoader = (input: {
    readonly context: { readonly queryClient: QueryClient };
    readonly deps: unknown;
    readonly cause: 'preload' | 'enter' | 'stay';
  }) => Promise<void> | undefined;

  const loader = ProductsRoute.options.loader as unknown as ProductsLoader;

  const PENDING = Symbol('pending');

  const SETTLED = Symbol('settled');

  // 取得の応答を返さない間に、loaderの結果が決まらないことを確かめる
  const outcomeOf = (loading: Promise<void>) =>
    Promise.race([
      loading.then(() => SETTLED),
      new Promise<typeof PENDING>((resolve) => {
        setTimeout(() => {
          resolve(PENDING);
        }, 50);
      }),
    ]);

  const pendingQueryClient = () => {
    executeGraphQL.mockImplementation(() => new Promise(() => undefined));
    return new QueryClient({ defaultOptions: { queries: { retry: false } } });
  };

  test('検索パラメータは共通部品の解析で検証し、loaderの依存はカテゴリをカテゴリのIDにした一覧の引数にする', () => {
    expect(ProductsRoute.options.validateSearch).toBe(
      toProductModerationSearch,
    );
    expect(
      (
        ProductsRoute.options.loaderDeps as (input: {
          search: unknown;
        }) => unknown
      )({
        search: toProductModerationSearch({
          name: 'pitch',
          category: CATEGORY_ID,
          launchState: 'won',
          after: 'cursor-2',
        }),
      }),
    ).toStrictEqual({
      name: 'pitch',
      launchState: 'won',
      after: 'cursor-2',
      categoryId: CATEGORY_ID,
    });
  });

  test.each(['enter', 'preload'] as const)(
    '%sでは一覧とカテゴリの選択肢の取得を待つ',
    async (cause) => {
      const queryClient = pendingQueryClient();

      const loading = loader({ context: { queryClient }, deps: {}, cause });

      if (!(loading instanceof Promise)) {
        throw new Error('loaderが取得を待つPromiseを返しませんでした。');
      }
      expect(await outcomeOf(loading)).toBe(PENDING);
      await expect.poll(() => categoryOptionsCallsOf(executeGraphQL)).toBe(1);
      expect(productsVariablesOf(executeGraphQL)).toStrictEqual([
        { filter: {}, first: 50 },
      ]);
    },
  );

  test('同じ画面の中の条件の変更(stay)では、取得を始めるだけで待たない', async () => {
    const queryClient = pendingQueryClient();

    const loading = loader({
      context: { queryClient },
      deps: { name: 'pitch' },
      cause: 'stay',
    });

    expect(loading).toBeUndefined();
    await expect
      .poll(() => productsVariablesOf(executeGraphQL))
      .toStrictEqual([{ filter: { name: 'pitch' }, first: 50 }]);
  });
});

describe('プロダクトの一覧', () => {
  test('条件を付けずに1ページ目の50件を求め、題名と説明の下にロゴ・名称・ハンドル・投稿者・カテゴリ・最新のローンチ・公開状態をAPIの順に表示する', async () => {
    await renderWith();

    await expect.element(table()).toBeVisible();
    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toHaveTextContent('プロダクト');
    await expect
      .element(
        main().getByText(
          '削除されていないプロダクトを、登録日時の新しい順に表示します。',
        ),
      )
      .toBeVisible();
    expect(lastVariables()).toStrictEqual({ filter: {}, first: 50 });
    expect(
      table()
        .getByRole('columnheader')
        .elements()
        .map((element) => element.textContent),
    ).toStrictEqual([
      'ロゴ',
      '名称',
      'ハンドル',
      '投稿者',
      'カテゴリ',
      '最新のローンチ',
      '公開状態',
    ]);
    const names = table()
      .getByRole('row')
      .elements()
      .slice(1)
      .map((row) => row.querySelectorAll('td')[1]?.textContent);
    expect(names).toStrictEqual([
      LAUNCHED_PRODUCT_NODE.name,
      UNLAUNCHED_PRODUCT_NODE.name,
      SUSPENDED_OWNER_PRODUCT_NODE.name,
    ]);
    expect(cellTexts(LAUNCHED_PRODUCT_NODE.name).slice(1)).toStrictEqual([
      'Pitch Notes',
      'pitch_notes',
      'サンプル太郎(@maker_ai)',
      '生産性',
      '2026年11月16日(月)・勝利',
      '公開中',
    ]);
    await expect
      .element(
        rowOf(LAUNCHED_PRODUCT_NODE.name).getByText('2026年11月16日(月)'),
      )
      .toHaveAttribute('datetime', '2026-11-16');
  });

  test('ロゴは画像配信ドメインを使わず同一オリジンの中継の経路から表示し、ロゴの無いプロダクトは代わりの表示にする', async () => {
    await renderWith();
    await expect.element(table()).toBeVisible();

    const logo = rowOf(LAUNCHED_PRODUCT_NODE.name)
      .element()
      .querySelector('td img');
    expect(logo?.getAttribute('src')).toBe(LAUNCHED_PRODUCT_NODE.logo?.path);
    expect(
      rowOf(UNLAUNCHED_PRODUCT_NODE.name)
        .element()
        .querySelector('td [data-slot="media-placeholder"]'),
    ).not.toBeNull();
  });

  test('ローンチの無いプロダクトは「なし」、読めない投稿者は「表示できない利用者」、公開状態と最新のローンチの状態は表示名で示す', async () => {
    await renderWith();
    await expect.element(table()).toBeVisible();

    expect(cellTexts(UNLAUNCHED_PRODUCT_NODE.name).slice(3)).toStrictEqual([
      '表示できない利用者',
      '開発ツール',
      'なし',
      '非公開化中',
    ]);
    expect(cellTexts(SUSPENDED_OWNER_PRODUCT_NODE.name).slice(5)).toStrictEqual(
      ['2026年12月1日(火)・予約中', '投稿者が停止中'],
    );
  });

  test('項目の名称から、そのプロダクトの詳細へ移る', async () => {
    const router = await renderWith();
    const link = rowOf(LAUNCHED_PRODUCT_NODE.name).getByRole('link', {
      name: LAUNCHED_PRODUCT_NODE.name,
    });
    await expect
      .element(link)
      .toHaveAttribute('href', `${PRODUCTS_PATH}/${PRODUCT_ID}`);

    await userEvent.click(link);

    await expect
      .poll(() => router.state.location.pathname)
      .toBe(`${PRODUCTS_PATH}/${PRODUCT_ID}`);
  });

  test('条件に一致するプロダクトが無ければ、該当するプロダクトが無い旨を一覧の位置に示す', async () => {
    await renderWith({
      products: () => success(productsQueryOf([])),
      path: `${PRODUCTS_PATH}?ownerHandle=nobody`,
    });

    await expect
      .element(main().getByText('条件に一致するプロダクトはありません。'))
      .toBeVisible();
    expect(lastVariables()).toStrictEqual({
      filter: { ownerHandle: 'nobody' },
      first: 50,
    });
  });

  test('取得の失敗は一覧の場所に文言と再試行の操作で示し、問い合わせの導線を出さず絞り込みを残し、再試行で一覧の見出しへフォーカスを移して一覧を表示する', async () => {
    let available = false;
    await renderWith({
      products: () =>
        available
          ? success(FIRST_PRODUCTS_PAGE)
          : failure({
              code: 'internal_error',
              message: '処理中に問題が発生しました。',
              status: 500,
            }),
    });

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent('処理中に問題が発生しました。');
    expect(
      main()
        .getByRole('link', { name: /問い合わせ/u })
        .query(),
    ).toBeNull();
    await expect.element(filterForm()).toBeVisible();
    available = true;
    await userEvent.click(main().getByRole('button', { name: '再試行' }));

    await expect.element(table()).toBeVisible();
    await expect.element(listHeading()).toHaveFocus();
  });

  test('エラーコードを持たない想定外の失敗は、問い合わせを促さない管理者側の文言を示す', async () => {
    await renderWith({
      products: () => Promise.reject(new Error('network down')),
    });

    const alert = main().getByRole('alert');
    await expect
      .element(alert)
      .toHaveTextContent('時間をおいて再度お試しください。');
    await expect.element(alert).not.toHaveTextContent('問い合わせ');
    await expect.element(alert).not.toHaveTextContent('network down');
  });
});

describe('絞り込み', () => {
  test('カテゴリの選択肢はAPIの順(カテゴリの並び順)、ローンチ状態は5種、公開状態は3種を表示名で並べる', async () => {
    await renderWith();
    await expect.element(table()).toBeVisible();

    await userEvent.click(selectField('カテゴリ'));
    expect(optionTexts()).toStrictEqual([
      'すべてのカテゴリ',
      '開発ツール',
      '生産性',
    ]);
    await userEvent.keyboard('{Escape}');
    await userEvent.click(selectField('ローンチ状態'));
    expect(optionTexts()).toStrictEqual([
      'すべてのローンチ状態',
      '予約中',
      '予選マッチ中',
      '勝利',
      '敗北',
      '取消',
    ]);
    await userEvent.keyboard('{Escape}');
    await userEvent.click(selectField('公開状態'));
    expect(optionTexts()).toStrictEqual([
      'すべての公開状態',
      '公開中',
      '非公開化中',
      '投稿者が停止中',
    ]);
  });

  test('名称・ハンドル・投稿者のハンドル・カテゴリ・ローンチ状態・公開状態を組み合わせて求め直し、条件をURLに残してページの位置を捨てる', async () => {
    const router = await renderWith({
      path: `${PRODUCTS_PATH}?after=cursor-2`,
    });
    await expect.element(table()).toBeVisible();
    expect(lastVariables()).toStrictEqual({
      filter: {},
      first: 50,
      after: 'cursor-2',
    });

    await userEvent.fill(textField('名称'), ' Pitch ');
    await userEvent.fill(textField('ハンドル'), 'notes');
    await userEvent.fill(textField('投稿者のハンドル'), 'maker_ai');
    await chooseOption(selectField('カテゴリ'), '生産性');
    await chooseOption(selectField('ローンチ状態'), '敗北');
    await chooseOption(selectField('公開状態'), '非公開化中');
    await userEvent.click(applyButton());

    await expect.poll(lastVariables).toStrictEqual({
      filter: {
        name: 'Pitch',
        handle: 'notes',
        ownerHandle: 'maker_ai',
        categoryId: CATEGORY_ID,
        launchState: 'LOST',
        visibility: 'HIDDEN',
      },
      first: 50,
    });
    expect(router.state.location.search).toEqual({
      name: 'Pitch',
      handle: 'notes',
      ownerHandle: 'maker_ai',
      category: CATEGORY_ID,
      launchState: 'lost',
      visibility: 'hidden',
    });
  });

  test('URLの条件を入力欄と選択欄に示して求め、「解除」で条件を全て外して1ページ目を求め直す', async () => {
    const router = await renderWith({
      path: `${PRODUCTS_PATH}?name=Pitch&ownerHandle=maker_ai&category=${OTHER_CATEGORY_ID}&launchState=in_progress&visibility=owner_suspended&after=cursor-2`,
    });
    await expect.element(textField('名称')).toHaveValue('Pitch');
    await expect.element(textField('投稿者のハンドル')).toHaveValue('maker_ai');
    await expect
      .element(selectField('カテゴリ'))
      .toHaveTextContent('開発ツール');
    await expect
      .element(selectField('ローンチ状態'))
      .toHaveTextContent('予選マッチ中');
    await expect
      .element(selectField('公開状態'))
      .toHaveTextContent('投稿者が停止中');
    expect(lastVariables()).toStrictEqual({
      filter: {
        name: 'Pitch',
        ownerHandle: 'maker_ai',
        categoryId: OTHER_CATEGORY_ID,
        launchState: 'IN_PROGRESS',
        visibility: 'OWNER_SUSPENDED',
      },
      first: 50,
      after: 'cursor-2',
    });

    await userEvent.click(resetButton());

    await expect.poll(lastVariables).toStrictEqual({ filter: {}, first: 50 });
    expect(router.state.location.search).toEqual({});
    await expect.element(textField('名称')).toHaveValue('');
    await expect.element(textField('投稿者のハンドル')).toHaveValue('');
    await expect
      .element(selectField('カテゴリ'))
      .toHaveTextContent('すべてのカテゴリ');
    await expect
      .element(selectField('ローンチ状態'))
      .toHaveTextContent('すべてのローンチ状態');
    await expect
      .element(selectField('公開状態'))
      .toHaveTextContent('すべての公開状態');
  });

  test('URLの空の値と不正な条件は、未指定として1ページ目を求める', async () => {
    await renderWith({
      path: `${PRODUCTS_PATH}?name=%20&category=not-a-category&launchState=WON&visibility=deleted&after=${'c'.repeat(257)}`,
    });

    await expect.element(table()).toBeVisible();
    await expect
      .element(selectField('カテゴリ'))
      .toHaveTextContent('すべてのカテゴリ');
    await expect
      .element(selectField('ローンチ状態'))
      .toHaveTextContent('すべてのローンチ状態');
    await expect
      .element(selectField('公開状態'))
      .toHaveTextContent('すべての公開状態');
    expect(productsVariablesOf(executeGraphQL)).toStrictEqual([
      { filter: {}, first: 50 },
    ]);
  });

  test('条件を変えて取り直す間は、前の結果を操作できない状態で表示し続け、絞り込みは操作できるまま残す', async () => {
    const next = deferred<GraphQLResult<AdminProductsQuery>>();
    await renderWith({
      products: ({ filter }) =>
        filter?.visibility === 'HIDDEN'
          ? next.promise
          : success(FIRST_PRODUCTS_PAGE),
    });
    await expect.element(table()).toBeVisible();

    await chooseOption(selectField('公開状態'), '非公開化中');
    await userEvent.click(applyButton());

    await expect
      .poll(() => lastVariables()?.filter)
      .toStrictEqual({ visibility: 'HIDDEN' });
    await expect.element(rowOf(LAUNCHED_PRODUCT_NODE.name)).toBeInTheDocument();
    await expect
      .poll(() => table().element().closest('[aria-busy="true"]'))
      .not.toBeNull();
    expect(table().element().closest('[inert]')).not.toBeNull();
    await expect.element(textField('名称')).toBeEnabled();

    next.resolve({
      ok: true,
      data: productsQueryOf([UNLAUNCHED_PRODUCT_NODE]),
    });

    await expect
      .element(rowOf(LAUNCHED_PRODUCT_NODE.name))
      .not.toBeInTheDocument();
    await expect.element(rowOf(UNLAUNCHED_PRODUCT_NODE.name)).toBeVisible();
    expect(table().element().closest('[aria-busy="true"]')).toBeNull();
    expect(table().element().closest('[inert]')).toBeNull();
  });

  test('カテゴリの選択肢の取得の失敗は絞り込みの中に文言と再試行の操作で示し、一覧と「すべてのカテゴリ」の選択を残し、再試行で選択肢を読み直す', async () => {
    let available = false;
    await renderWith({
      categories: () =>
        available
          ? success(CATEGORY_OPTIONS)
          : failure({
              code: 'internal_error',
              message: '処理中に問題が発生しました。',
              status: 500,
            }),
    });

    await expect
      .element(filterForm().getByRole('alert'))
      .toHaveTextContent('処理中に問題が発生しました。');
    await expect.element(table()).toBeVisible();
    await expect.element(selectField('カテゴリ')).toBeEnabled();
    await userEvent.click(selectField('カテゴリ'));
    expect(optionTexts()).toStrictEqual(['すべてのカテゴリ']);
    await userEvent.keyboard('{Escape}');

    available = true;
    await userEvent.click(filterForm().getByRole('button', { name: '再試行' }));

    await expect
      .element(filterForm().getByRole('alert'))
      .not.toBeInTheDocument();
    await userEvent.click(selectField('カテゴリ'));
    expect(optionTexts()).toStrictEqual([
      'すべてのカテゴリ',
      '開発ツール',
      '生産性',
    ]);
  });
});

describe('ページ送り', () => {
  const pages: ProductsHandler = ({ after }) =>
    success(
      after === 'cursor-2'
        ? productsQueryOf([SUSPENDED_OWNER_PRODUCT_NODE], null)
        : productsQueryOf(
            [LAUNCHED_PRODUCT_NODE, UNLAUNCHED_PRODUCT_NODE],
            'cursor-2',
          ),
    );

  test('「次へ」で続きのページを求めてURLにカーソルを残し、「前へ」で辿った前のページへ戻る', async () => {
    const router = await renderWith({ products: pages });
    await expect.element(table()).toBeVisible();
    await expect
      .element(previousButton())
      .toHaveAttribute('aria-disabled', 'true');

    await userEvent.click(nextButton());

    await expect
      .element(rowOf(SUSPENDED_OWNER_PRODUCT_NODE.name))
      .toBeVisible();
    await expect
      .element(rowOf(LAUNCHED_PRODUCT_NODE.name))
      .not.toBeInTheDocument();
    expect(lastVariables()).toStrictEqual({
      filter: {},
      first: 50,
      after: 'cursor-2',
    });
    expect(router.state.location.search).toEqual({ after: 'cursor-2' });
    await expect.element(nextButton()).toHaveAttribute('aria-disabled', 'true');

    await userEvent.click(previousButton());

    await expect.element(rowOf(LAUNCHED_PRODUCT_NODE.name)).toBeVisible();
    expect(router.state.location.search).toEqual({});
  });

  test('記録の無い途中のページ(共有したURL)の「前へ」は1ページ目へ戻り、絞り込みを保つ', async () => {
    const router = await renderWith({
      products: pages,
      path: `${PRODUCTS_PATH}?visibility=visible&after=cursor-2`,
    });
    await expect
      .element(rowOf(SUSPENDED_OWNER_PRODUCT_NODE.name))
      .toBeVisible();

    await userEvent.click(previousButton());

    await expect.element(rowOf(LAUNCHED_PRODUCT_NODE.name)).toBeVisible();
    expect(router.state.location.search).toEqual({ visibility: 'visible' });
  });
});

describe('アクセシビリティ', () => {
  test.each(COLOR_SCHEMES)(
    '%sの配色で、一覧・絞り込み・代わりの表示のロゴがWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderWith();
      await expect.element(table()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test.each(COLOR_SCHEMES)(
    '%sの配色で、カテゴリの選択肢の取得の失敗の表示がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderWith({
        categories: () =>
          failure({
            code: 'internal_error',
            message: '処理中に問題が発生しました。',
            status: 500,
          }),
      });
      await expect.element(filterForm().getByRole('alert')).toBeVisible();
      await expect.element(table()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
