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
import {
  AdminCreateProductCategoryDocument,
  AdminDeleteProductCategoryDocument,
  AdminHelpCategoriesDocument,
  AdminInquiryCategoriesDocument,
  AdminProductCategoriesDocument,
  type AdminProductCategoriesQuery,
  type AdminRole,
  AdminUpdateProductCategoryDocument,
} from '../../graphql/generated/graphql.ts';
import { Route as AuthenticatedRoute } from '../../routes/_authenticated/route.tsx';
import { Route as CategoriesRoute } from '../../routes/_authenticated/categories/index.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const CATEGORIES_PATH = '/categories';

const SECTION_TITLE = 'プロダクトカテゴリ';

const HELP_SECTION_TITLE = 'ヘルプ記事カテゴリ';

const INQUIRY_SECTION_TITLE = '問い合わせカテゴリ';

const AUDITED_NOTICE = 'この操作は監査ログに記録されます。';

const DELETE_DESCRIPTION =
  '削除したカテゴリは元に戻せません。プロダクトが紐付いているカテゴリは削除できません。削除から14日以内のプロダクトも紐付くものとして数えるため、14日を過ぎてから削除してください。';

const UNEXPECTED_WITHOUT_CONTACT =
  'ページを表示できませんでした。時間をおいて再度お試しください。';

const TOOLS_CATEGORY = Object.freeze({
  id: '01JD0CATEGRY0000000000000A',
  name: '開発ツール',
  handle: 'dev-tools',
  systemDefault: false,
});

const DESIGN_CATEGORY = Object.freeze({
  id: '01JD0CATEGRY0000000000000B',
  name: 'デザイン',
  handle: 'Design_2',
  systemDefault: false,
});

const OTHER_CATEGORY = Object.freeze({
  id: '01JD0000000000000000000000',
  name: 'その他',
  handle: 'other',
  systemDefault: true,
});

const CATEGORIES: AdminProductCategoriesQuery = {
  adminProductCategories: [
    { ...TOOLS_CATEGORY },
    { ...DESIGN_CATEGORY },
    { ...OTHER_CATEGORY },
  ],
};

const INQUIRY_CATEGORIES = {
  adminInquiryCategories: [
    {
      id: '01JC0000000000000000000000',
      name: 'その他',
      systemDefault: true,
      linkedCount: 0,
    },
  ],
};

const HELP_CATEGORIES = {
  adminHelpCategories: [
    {
      id: '01JC0000000000000000000001',
      name: 'その他',
      systemDefault: true,
      sortOrder: 1,
      articleCount: 0,
    },
  ],
};

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
  readonly update?: GraphQLHandler;
  readonly remove?: GraphQLHandler;
}

const respondCategories = (
  role: AdminRole,
  {
    categories = () => success(CATEGORIES),
    create = unexpectedOperation,
    update = unexpectedOperation,
    remove = unexpectedOperation,
  }: CategoryHandlers = {},
): void => {
  respondAdminGraphQL(executeGraphQL, {
    role,
    handlers: new Map<unknown, GraphQLHandler>([
      [AdminProductCategoriesDocument, categories],
      [AdminCreateProductCategoryDocument, create],
      [AdminUpdateProductCategoryDocument, update],
      [AdminDeleteProductCategoryDocument, remove],
      [AdminHelpCategoriesDocument, () => success(HELP_CATEGORIES)],
      [AdminInquiryCategoriesDocument, () => success(INQUIRY_CATEGORIES)],
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
const handleBox = (dialogName: string) =>
  dialogOf(dialogName).getByRole('textbox', { name: 'ハンドル', exact: true });
const submitButton = (dialogName: string, name: '追加' | '保存') =>
  dialogOf(dialogName).getByRole('button', { name, exact: true });
const deleteDialog = (name: string) =>
  dialogOf(`カテゴリ「${name}」を削除しますか?`);

const categoryCalls = () =>
  callsOf(executeGraphQL, AdminProductCategoriesDocument).length;

const rowCells = () =>
  table()
    .getByRole('row')
    .elements()
    .slice(1)
    .map((row) =>
      Array.from(row.querySelectorAll('td'))
        .slice(0, 2)
        .map((cell) => cell.textContent),
    );

const waitForTable = async () => {
  await expect
    .element(table().getByText('デザイン', { exact: true }))
    .toBeVisible();
};

const ADD_DIALOG = 'カテゴリを追加';

beforeEach(() => {
  executeGraphQL.mockReset();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('プロダクトカテゴリの区画', () => {
  test('カテゴリのページの先頭の区画に、カテゴリ名・ハンドルと「その他」の印をAPIの順で示す', async () => {
    await renderCategoriesPage('MODERATOR');
    await waitForTable();

    expect(
      main()
        .getByRole('heading', { level: 2 })
        .elements()
        .map((heading) => heading.textContent),
    ).toStrictEqual([SECTION_TITLE, HELP_SECTION_TITLE, INQUIRY_SECTION_TITLE]);
    expect(rowCells()).toStrictEqual([
      ['開発ツール', 'dev-tools'],
      ['デザイン', 'Design_2'],
      ['その他システム標準', 'other'],
    ]);
    expect(rowButton('その他', '削除').query()).toBeNull();
    await expect
      .element(section().getByText('システム標準のカテゴリは削除できません。'))
      .toBeVisible();
  });

  test('カテゴリを追加すると名前とハンドルを理由なしで送り、一覧を取り直してダイアログを閉じる', async () => {
    const create = vi.fn<GraphQLHandler>(() =>
      success({ createProductCategory: { id: '01JD0CATEGRY0000000000000C' } }),
    );
    await renderCategoriesPage('MODERATOR', { create });
    await waitForTable();
    const fetchedBefore = categoryCalls();

    await userEvent.click(addButton());
    await userEvent.fill(nameBox(ADD_DIALOG), '  AIツール  ');
    await userEvent.fill(handleBox(ADD_DIALOG), ' ai-tools ');
    await userEvent.click(submitButton(ADD_DIALOG, '追加'));

    await expect.element(dialogOf(ADD_DIALOG)).not.toBeInTheDocument();
    expect(create).toHaveBeenCalledExactlyOnceWith({
      input: { name: 'AIツール', handle: 'ai-tools' },
    });
    await expect.poll(categoryCalls).toBeGreaterThan(fetchedBefore);
  });

  test.each([
    ['未入力', '', 'ハンドルを入力してください。'],
    ['文字数超過', 'a'.repeat(51), 'ハンドルは50文字以内で入力してください。'],
    [
      '文字種違反',
      '-tools',
      'ハンドルは英数字で始め、英数字・ハイフン・アンダースコアのみで入力してください。',
    ],
  ])(
    'ハンドルの%sは、送らずにハンドルの欄に理由を示す',
    async (_label, handle, message) => {
      const create = vi.fn<GraphQLHandler>(unexpectedOperation);
      await renderCategoriesPage('MODERATOR', { create });
      await waitForTable();

      await userEvent.click(addButton());
      await userEvent.fill(nameBox(ADD_DIALOG), 'AIツール');
      await userEvent.click(handleBox(ADD_DIALOG));
      await userEvent.fill(handleBox(ADD_DIALOG), handle);
      await userEvent.tab();

      await expect
        .element(handleBox(ADD_DIALOG))
        .toHaveAccessibleDescription(message);
      await expect.element(submitButton(ADD_DIALOG, '追加')).toBeDisabled();
      expect(create).not.toHaveBeenCalled();
    },
  );

  test('ハンドルは50文字ちょうどなら送る', async () => {
    const create = vi.fn<GraphQLHandler>(() =>
      success({ createProductCategory: { id: '01JD0CATEGRY0000000000000C' } }),
    );
    await renderCategoriesPage('MODERATOR', { create });
    await waitForTable();

    await userEvent.click(addButton());
    await userEvent.fill(nameBox(ADD_DIALOG), 'AIツール');
    await userEvent.fill(handleBox(ADD_DIALOG), `A${'b'.repeat(49)}`);
    await userEvent.click(submitButton(ADD_DIALOG, '追加'));

    await expect.element(dialogOf(ADD_DIALOG)).not.toBeInTheDocument();
    expect(create).toHaveBeenCalledExactlyOnceWith({
      input: { name: 'AIツール', handle: `A${'b'.repeat(49)}` },
    });
  });

  test.each([
    [
      '名前',
      'product_category_name_taken',
      'input.name',
      'このカテゴリ名は既に使われています。',
    ],
    [
      'ハンドル',
      'product_category_handle_taken',
      'input.handle',
      'このハンドルは既に使われています。別の文字列を入力してください。',
    ],
  ])(
    '%sの重複はダイアログを開いたまま、その欄にAPIの文言を示す',
    async (label, code, field, message) => {
      await renderCategoriesPage('MODERATOR', {
        create: () =>
          failure({
            code,
            message,
            status: 409,
            details: [{ field, code: 'unavailable', message }],
          }),
      });
      await waitForTable();

      await userEvent.click(addButton());
      await userEvent.fill(nameBox(ADD_DIALOG), 'デザイン');
      await userEvent.fill(handleBox(ADD_DIALOG), 'design_2');
      await userEvent.click(submitButton(ADD_DIALOG, '追加'));

      const box =
        label === '名前' ? nameBox(ADD_DIALOG) : handleBox(ADD_DIALOG);
      await expect.element(box).toHaveAccessibleDescription(message);
      expect(dialogOf(ADD_DIALOG).getByRole('alert').query()).toBeNull();
    },
  );

  test('変更すると現在の名前とハンドルを入れたダイアログから、IDと新しい名前・ハンドルを理由なしで送り、一覧を取り直す', async () => {
    const update = vi.fn<GraphQLHandler>(() =>
      success({ updateProductCategory: { id: DESIGN_CATEGORY.id } }),
    );
    await renderCategoriesPage('MODERATOR', { update });
    await waitForTable();
    const fetchedBefore = categoryCalls();
    const dialogName = 'カテゴリ「デザイン」を編集';

    await userEvent.click(rowButton('デザイン', '編集'));
    await expect.element(nameBox(dialogName)).toHaveValue('デザイン');
    await expect.element(handleBox(dialogName)).toHaveValue('Design_2');
    await userEvent.fill(nameBox(dialogName), 'デザインツール');
    await userEvent.fill(handleBox(dialogName), 'design-tools');
    await userEvent.click(submitButton(dialogName, '保存'));

    await expect.element(dialogOf(dialogName)).not.toBeInTheDocument();
    expect(update).toHaveBeenCalledExactlyOnceWith({
      id: DESIGN_CATEGORY.id,
      input: { name: 'デザインツール', handle: 'design-tools' },
    });
    await expect.poll(categoryCalls).toBeGreaterThan(fetchedBefore);
  });

  test('標準カテゴリ「その他」の変更の拒否は、APIの文言をダイアログに示す', async () => {
    const message = '標準カテゴリ「その他」は変更・削除できません。';
    const dialogName = 'カテゴリ「その他」を編集';
    await renderCategoriesPage('MODERATOR', {
      update: () =>
        failure({ code: 'product_category_protected', message, status: 422 }),
    });
    await waitForTable();

    await userEvent.click(rowButton('その他', '編集'));
    await userEvent.fill(handleBox(dialogName), 'others');
    await userEvent.click(submitButton(dialogName, '保存'));

    await expect
      .element(dialogOf(dialogName).getByRole('alert'))
      .toHaveTextContent(message);
  });

  test('GraphQLの失敗でない例外は、問い合わせを促さない文言をダイアログに示す', async () => {
    await renderCategoriesPage('MODERATOR', {
      create: () => Promise.reject(new TypeError('壊れた応答')),
    });
    await waitForTable();

    await userEvent.click(addButton());
    await userEvent.fill(nameBox(ADD_DIALOG), 'AIツール');
    await userEvent.fill(handleBox(ADD_DIALOG), 'ai-tools');
    await userEvent.click(submitButton(ADD_DIALOG, '追加'));

    await expect
      .element(dialogOf(ADD_DIALOG).getByRole('alert'))
      .toHaveTextContent(UNEXPECTED_WITHOUT_CONTACT);
    expect(document.body.textContent).not.toContain('お問い合わせ');
  });

  test('削除の確認に論理削除から14日以内のプロダクトも数える旨と監査ログに記録される旨を示し、確定するとIDだけを送って一覧を取り直す', async () => {
    const remove = vi.fn<GraphQLHandler>(() =>
      success({ deleteProductCategory: true }),
    );
    await renderCategoriesPage('MODERATOR', { remove });
    await waitForTable();

    await userEvent.click(rowButton('開発ツール', '削除'));
    await expect
      .element(deleteDialog('開発ツール'))
      .toHaveTextContent(DELETE_DESCRIPTION);
    await expect
      .element(deleteDialog('開発ツール'))
      .toHaveTextContent(AUDITED_NOTICE);
    expect(
      deleteDialog('開発ツール').getByRole('textbox').elements(),
    ).toHaveLength(0);
    const fetchedBefore = categoryCalls();
    await userEvent.click(
      deleteDialog('開発ツール').getByRole('button', { name: '削除' }),
    );

    await expect.element(deleteDialog('開発ツール')).not.toBeInTheDocument();
    expect(remove).toHaveBeenCalledExactlyOnceWith({ id: TOOLS_CATEGORY.id });
    await expect.poll(categoryCalls).toBeGreaterThan(fetchedBefore);
  });

  test('プロダクトが紐付くカテゴリの削除の拒否は、APIの文言を削除の確認に示す', async () => {
    const message =
      'このカテゴリにはプロダクトが紐付いているため削除できません。削除から14日以内のプロダクトも含みます。';
    await renderCategoriesPage('MODERATOR', {
      remove: () =>
        failure({ code: 'product_category_in_use', message, status: 409 }),
    });
    await waitForTable();

    await userEvent.click(rowButton('開発ツール', '削除'));
    await userEvent.click(
      deleteDialog('開発ツール').getByRole('button', { name: '削除' }),
    );

    await expect
      .element(deleteDialog('開発ツール').getByRole('alert'))
      .toHaveTextContent(message);
  });

  test('閲覧のみの管理者には追加・編集・削除の操作を無効にし、権限が無い旨を示す', async () => {
    await renderCategoriesPage('VIEWER');
    await waitForTable();

    await expect.element(addButton()).toBeDisabled();
    await expect.element(rowButton('開発ツール', '編集')).toBeDisabled();
    await expect.element(rowButton('開発ツール', '削除')).toBeDisabled();
    await expect.element(rowButton('その他', '編集')).toBeDisabled();
    await expect
      .element(
        section().getByText('カテゴリを追加・編集・削除する権限がありません。'),
      )
      .toBeVisible();
  });

  test('一覧の取得の失敗は区画の位置に問い合わせを促さない文言と再試行で示して他の区画の表示を続け、再試行で表示する', async () => {
    let failing = true;
    await renderCategoriesPage('MODERATOR', {
      categories: () =>
        failing ? failure(INTERNAL_ERROR) : success(CATEGORIES),
    });

    await expect
      .element(section().getByRole('alert'))
      .toHaveTextContent(INTERNAL_ERROR.message);
    await expect
      .element(main().getByRole('table', { name: INQUIRY_SECTION_TITLE }))
      .toBeVisible();
    expect(document.body.textContent).not.toContain('お問い合わせ');

    failing = false;
    await userEvent.click(section().getByRole('button', { name: '再試行' }));

    await waitForTable();
  });

  test.each(COLOR_SCHEMES)(
    '%sの配色で、区画と追加のダイアログと削除の確認がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderCategoriesPage('MODERATOR');
      await waitForTable();

      expect(await runAxe(document.body)).toStrictEqual([]);

      await userEvent.click(addButton());
      await userEvent.fill(nameBox(ADD_DIALOG), 'AIツール');
      await userEvent.fill(handleBox(ADD_DIALOG), '-tools');
      await userEvent.tab();
      await expect
        .element(handleBox(ADD_DIALOG))
        .toHaveAccessibleDescription(
          'ハンドルは英数字で始め、英数字・ハイフン・アンダースコアのみで入力してください。',
        );

      expect(await runAxe(document.body)).toStrictEqual([]);

      await userEvent.click(
        dialogOf(ADD_DIALOG).getByRole('button', { name: 'キャンセル' }),
      );
      await userEvent.click(rowButton('開発ツール', '削除'));
      await expect.element(deleteDialog('開発ツール')).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
