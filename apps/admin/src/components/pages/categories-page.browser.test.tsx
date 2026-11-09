import { createRoute } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import {
  callsOf,
  failure,
  type GraphQLHandler,
  respondAdminGraphQL,
  success,
} from '../../../test/admin-accounts-fixtures.ts';
import { adminWithRole } from '../../../test/admin-viewer-fixtures.ts';
import {
  type PageRootRoute,
  renderPageRouter,
} from '../../../test/page-router.tsx';
import { CATEGORY_SECTIONS } from '../../composition/category-sections.ts';
import {
  AdminCreateInquiryCategoryDocument,
  AdminDeleteInquiryCategoryDocument,
  AdminInquiryCategoriesDocument,
  type AdminInquiryCategoriesQuery,
  AdminProductCategoriesDocument,
  AdminRenameInquiryCategoryDocument,
  type AdminRole,
} from '../../graphql/generated/graphql.ts';
import { Route as AuthenticatedRoute } from '../../routes/_authenticated/route.tsx';
import { Route as CategoriesRoute } from '../../routes/_authenticated/categories/index.tsx';
import { InquiryCategorySection } from '../inquiry/inquiry-category-section.tsx';
import { ProductCategorySection } from '../product/product-category-section.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const CATEGORIES_PATH = '/categories';

const SECTION_TITLE = '問い合わせカテゴリ';

const AUDITED_NOTICE = 'この操作は監査ログに記録されます。';

const BUG_CATEGORY = Object.freeze({
  id: '01JC0CATEGRY0000000000000A',
  name: '不具合の報告',
  systemDefault: false,
  linkedCount: 3,
});

const BILLING_CATEGORY = Object.freeze({
  id: '01JC0CATEGRY0000000000000B',
  name: '料金',
  systemDefault: false,
  linkedCount: 1234,
});

const OTHER_CATEGORY = Object.freeze({
  id: '01JC0000000000000000000000',
  name: 'その他',
  systemDefault: true,
  linkedCount: 0,
});

const CATEGORIES: AdminInquiryCategoriesQuery = {
  adminInquiryCategories: [
    { ...BUG_CATEGORY },
    { ...BILLING_CATEGORY },
    { ...OTHER_CATEGORY },
  ],
};

const PRODUCT_OTHER_CATEGORY = Object.freeze({
  id: '01JD0000000000000000000000',
  name: 'その他',
  handle: 'other',
  systemDefault: true,
});

const INTERNAL_ERROR = Object.freeze({
  code: 'internal_error',
  message: 'サーバーで問題が発生しました。時間をおいて再度お試しください。',
  status: 500,
});

const unexpectedOperation = (): Promise<unknown> =>
  Promise.reject(new Error('想定していない操作が実行されました。'));

interface CategoryHandlers {
  readonly categories?: GraphQLHandler;
  readonly create?: GraphQLHandler;
  readonly rename?: GraphQLHandler;
  readonly remove?: GraphQLHandler;
}

const respondCategories = (
  role: AdminRole,
  {
    categories = () => success(CATEGORIES),
    create = unexpectedOperation,
    rename = unexpectedOperation,
    remove = unexpectedOperation,
  }: CategoryHandlers = {},
): void => {
  respondAdminGraphQL(executeGraphQL, {
    role,
    handlers: new Map<unknown, GraphQLHandler>([
      [AdminInquiryCategoriesDocument, categories],
      [AdminCreateInquiryCategoryDocument, create],
      [AdminRenameInquiryCategoryDocument, rename],
      [AdminDeleteInquiryCategoryDocument, remove],
      [
        AdminProductCategoriesDocument,
        () =>
          success({ adminProductCategories: [{ ...PRODUCT_OTHER_CATEGORY }] }),
      ],
    ]),
  });
};

// アプリの経路の設定を、画面のテスト用のルーターの同じ位置の経路へ写す
const createRoutes = (rootRoute: PageRootRoute) => {
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_authenticated',
    beforeLoad: AuthenticatedRoute.options.beforeLoad,
    component: AuthenticatedRoute.options.component,
  });
  return [
    authenticatedRoute.addChildren([
      createRoute({
        getParentRoute: () => authenticatedRoute,
        path: CATEGORIES_PATH,
        component: CategoriesRoute.options.component,
      }),
    ]),
  ];
};

const renderCategoriesPage = async (
  role: AdminRole,
  handlers: CategoryHandlers = {},
) => {
  respondCategories(role, handlers);
  await renderPageRouter({
    path: CATEGORIES_PATH,
    createRoutes,
    cachedViewer: adminWithRole(role),
  });
};

const main = () => page.getByRole('main');
const section = () => main().getByRole('region', { name: SECTION_TITLE });
const table = () => section().getByRole('table', { name: SECTION_TITLE });
const addButton = () =>
  section().getByRole('button', { name: 'カテゴリを追加', exact: true });
const rowButton = (name: string, action: '編集' | '削除') =>
  section().getByRole('button', {
    name: `「${name}」を${action}`,
    exact: true,
  });
const dialogOf = (name: string) => page.getByRole('dialog', { name });
const nameBox = (dialogName: string) =>
  dialogOf(dialogName).getByRole('textbox', {
    name: 'カテゴリ名(必須)',
    exact: true,
  });
const deleteDialog = (name: string) =>
  dialogOf(`カテゴリ「${name}」を削除しますか?`);

const categoryCalls = () =>
  callsOf(executeGraphQL, AdminInquiryCategoriesDocument).length;

const rowNames = () =>
  table()
    .getByRole('row')
    .elements()
    .slice(1)
    .map((row) => row.querySelector('td')?.textContent);

beforeEach(() => {
  executeGraphQL.mockReset();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('カテゴリの区画の登録口', () => {
  test('プロダクトカテゴリの区画をorder 10、問い合わせカテゴリの区画をorder 30で登録し、凍結されている', () => {
    expect(CATEGORY_SECTIONS).toStrictEqual([
      {
        id: 'product-launch.product-categories',
        order: 10,
        title: 'プロダクトカテゴリ',
        component: ProductCategorySection,
      },
      {
        id: 'inquiry-chat.inquiry-categories',
        order: 30,
        title: SECTION_TITLE,
        component: InquiryCategorySection,
      },
    ]);
    expect(Object.isFrozen(CATEGORY_SECTIONS)).toBe(true);
  });
});

describe('カテゴリのページ', () => {
  test('ページの見出しの下に問い合わせカテゴリの区画を見出し付きで置き、カテゴリをAPIの順(「その他」は末尾)に表示する', async () => {
    await renderCategoriesPage('MODERATOR');

    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toHaveTextContent('カテゴリ');
    await expect
      .element(main().getByRole('heading', { level: 2, name: SECTION_TITLE }))
      .toBeVisible();
    await expect
      .element(table().getByText('料金', { exact: true }))
      .toBeVisible();
    expect(rowNames()).toStrictEqual([
      '不具合の報告',
      '料金',
      'その他システム標準',
    ]);
    expect(main().getByRole('link').elements()).toHaveLength(0);
  });

  test('カテゴリを追加すると名前を送り、一覧を取り直してダイアログを閉じる', async () => {
    const create = vi.fn<GraphQLHandler>(() =>
      success({ createInquiryCategory: { id: '01JC0CATEGRY0000000000000C' } }),
    );
    await renderCategoriesPage('MODERATOR', { create });
    await expect
      .element(table().getByText('料金', { exact: true }))
      .toBeVisible();
    const fetchedBefore = categoryCalls();

    await userEvent.click(addButton());
    await userEvent.fill(nameBox('カテゴリを追加'), '  アカウント  ');
    await userEvent.click(
      dialogOf('カテゴリを追加').getByRole('button', { name: '追加' }),
    );

    await expect.element(dialogOf('カテゴリを追加')).not.toBeInTheDocument();
    expect(create).toHaveBeenCalledExactlyOnceWith({ name: 'アカウント' });
    await expect.poll(categoryCalls).toBeGreaterThan(fetchedBefore);
  });

  test('同じ名前のカテゴリがあると、ダイアログを開いたまま名前の欄にAPIの文言を示す', async () => {
    const message = '同じ名前のカテゴリが既にあります。';
    await renderCategoriesPage('MODERATOR', {
      create: () =>
        failure({
          code: 'validation_error',
          message: '入力内容を確認してください。',
          status: 400,
          details: [{ field: 'name', code: 'name-taken', message }],
        }),
    });

    await userEvent.click(addButton());
    await userEvent.fill(nameBox('カテゴリを追加'), '料金');
    await userEvent.click(
      dialogOf('カテゴリを追加').getByRole('button', { name: '追加' }),
    );

    await expect
      .element(nameBox('カテゴリを追加'))
      .toHaveAccessibleDescription(message);
  });

  test('名前を変更するとカテゴリのIDと新しい名前を送り、一覧を取り直す', async () => {
    const rename = vi.fn<GraphQLHandler>(() =>
      success({ renameInquiryCategory: { id: BILLING_CATEGORY.id } }),
    );
    await renderCategoriesPage('MODERATOR', { rename });
    await expect
      .element(table().getByText('料金', { exact: true }))
      .toBeVisible();
    const fetchedBefore = categoryCalls();

    await userEvent.click(rowButton('料金', '編集'));
    await userEvent.fill(nameBox('カテゴリ「料金」を編集'), '料金とお支払い');
    await userEvent.click(
      dialogOf('カテゴリ「料金」を編集').getByRole('button', { name: '保存' }),
    );

    await expect
      .element(dialogOf('カテゴリ「料金」を編集'))
      .not.toBeInTheDocument();
    expect(rename).toHaveBeenCalledExactlyOnceWith({
      id: BILLING_CATEGORY.id,
      name: '料金とお支払い',
    });
    await expect.poll(categoryCalls).toBeGreaterThan(fetchedBefore);
  });

  test('削除の確認に紐付く件数を入れた付け替えの文と監査ログに記録される旨を示し、確定するとIDを送って一覧を取り直す', async () => {
    const remove = vi.fn<GraphQLHandler>(() =>
      success({ deleteInquiryCategory: true }),
    );
    await renderCategoriesPage('MODERATOR', { remove });
    await expect
      .element(table().getByText('料金', { exact: true }))
      .toBeVisible();

    await userEvent.click(rowButton('料金', '削除'));
    await expect
      .element(deleteDialog('料金'))
      .toHaveTextContent(
        '紐付く1,234件の問い合わせは標準カテゴリ「その他」へ付け替えられます。',
      );
    await expect
      .element(deleteDialog('料金'))
      .toHaveTextContent(AUDITED_NOTICE);
    await userEvent.click(
      deleteDialog('料金').getByRole('button', { name: 'キャンセル' }),
    );

    await userEvent.click(rowButton('不具合の報告', '削除'));
    await expect
      .element(deleteDialog('不具合の報告'))
      .toHaveTextContent(
        '紐付く3件の問い合わせは標準カテゴリ「その他」へ付け替えられます。',
      );
    expect(
      deleteDialog('不具合の報告').getByRole('textbox').elements(),
    ).toHaveLength(0);
    const fetchedBefore = categoryCalls();
    await userEvent.click(
      deleteDialog('不具合の報告').getByRole('button', { name: '削除' }),
    );

    await expect.element(deleteDialog('不具合の報告')).not.toBeInTheDocument();
    expect(remove).toHaveBeenCalledExactlyOnceWith({ id: BUG_CATEGORY.id });
    await expect.poll(categoryCalls).toBeGreaterThan(fetchedBefore);
  });

  test('標準カテゴリ「その他」は削除の操作を描かず、名前の変更はAPIの拒否の文言をダイアログに示す', async () => {
    const message = '標準カテゴリ「その他」は変更・削除できません。';
    await renderCategoriesPage('MODERATOR', {
      rename: () =>
        failure({
          code: 'inquiry_category_protected',
          message,
          status: 409,
        }),
    });
    await expect
      .element(table().getByText('料金', { exact: true }))
      .toBeVisible();

    expect(rowButton('その他', '削除').query()).toBeNull();
    await expect
      .element(section().getByText('システム標準のカテゴリは削除できません。'))
      .toBeVisible();

    await userEvent.click(rowButton('その他', '編集'));
    await userEvent.fill(nameBox('カテゴリ「その他」を編集'), 'そのほか');
    await userEvent.click(
      dialogOf('カテゴリ「その他」を編集').getByRole('button', {
        name: '保存',
      }),
    );

    await expect
      .element(dialogOf('カテゴリ「その他」を編集').getByRole('alert'))
      .toHaveTextContent(message);
  });

  test('閲覧のみの管理者には追加・編集・削除の操作を無効にし、権限が無い旨を示す', async () => {
    await renderCategoriesPage('VIEWER');
    await expect
      .element(table().getByText('料金', { exact: true }))
      .toBeVisible();

    await expect.element(addButton()).toBeDisabled();
    await expect.element(rowButton('料金', '編集')).toBeDisabled();
    await expect.element(rowButton('料金', '削除')).toBeDisabled();
    await expect
      .element(
        section().getByText('カテゴリを追加・編集・削除する権限がありません。'),
      )
      .toBeVisible();
  });

  test('カテゴリの取得の失敗は区画の見出しの下に問い合わせを促さない文言と再試行で示し、再試行で表示する', async () => {
    let failing = true;
    await renderCategoriesPage('MODERATOR', {
      categories: () =>
        failing ? failure(INTERNAL_ERROR) : success(CATEGORIES),
    });

    await expect
      .element(section().getByRole('alert'))
      .toHaveTextContent(INTERNAL_ERROR.message);
    expect(main().getByRole('link').elements()).toHaveLength(0);
    expect(document.body.textContent).not.toContain('お問い合わせ');

    failing = false;
    await userEvent.click(section().getByRole('button', { name: '再試行' }));

    await expect
      .element(table().getByText('料金', { exact: true }))
      .toBeVisible();
  });

  test.each(COLOR_SCHEMES)(
    '%sの配色で、カテゴリのページと削除の確認がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderCategoriesPage('MODERATOR');
      await expect
        .element(table().getByText('料金', { exact: true }))
        .toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);

      await userEvent.click(rowButton('不具合の報告', '削除'));
      await expect.element(deleteDialog('不具合の報告')).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
