import type { QueryClient } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../../styles.css';
import {
  REPORT_CATEGORY_INFRINGEMENT_ID,
  REPORT_CATEGORY_OTHER_ID,
} from '../../../../common-lib/reporting/report-rules.ts';
import { runAxe } from '../../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../../lib/test/computed-style.ts';
import {
  callsOf,
  failure,
  type GraphQLHandler,
  respondAdminGraphQL,
  success,
} from '../../../../test/admin-accounts-fixtures.ts';
import { watchAuditLogQueries } from '../../../../test/audit-log-queries.ts';
import { adminWithRole } from '../../../../test/admin-viewer-fixtures.ts';
import {
  type PageRootRoute,
  renderPageRouter,
} from '../../../../test/page-router.tsx';
import {
  adminReportCaseQueryOptions,
  adminReportCasesQueryOptions,
} from '../../../graphql/admin-reporting-cases.ts';
import {
  AdminCreateReportCategoryDocument,
  AdminDeleteReportCategoryDocument,
  AdminHelpCategoriesDocument,
  AdminInquiryCategoriesDocument,
  AdminProductCategoriesDocument,
  AdminRenameReportCategoryDocument,
  AdminReportCategoriesDocument,
  type AdminReportCategoriesQuery,
  type AdminRole,
} from '../../../graphql/generated/graphql.ts';
import { Route as AuthenticatedRoute } from '../../../routes/_authenticated/route.tsx';
import { Route as CategoriesRoute } from '../../../routes/_authenticated/categories/index.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const CATEGORIES_PATH = '/categories';

const SECTION_TITLE = '通報カテゴリ';

const AUDITED_NOTICE = 'この操作は監査ログに記録されます。';

const SPAM_CATEGORY = Object.freeze({
  id: '01JE0CATEGRY0000000000000A',
  name: 'スパム',
  systemDefault: false,
  infringement: false,
  reportCount: 1234,
});

const HARASSMENT_CATEGORY = Object.freeze({
  id: '01JE0CATEGRY0000000000000B',
  name: '嫌がらせ',
  systemDefault: false,
  infringement: false,
  reportCount: 0,
});

const INFRINGEMENT_CATEGORY = Object.freeze({
  id: REPORT_CATEGORY_INFRINGEMENT_ID,
  name: '権利侵害',
  systemDefault: true,
  infringement: true,
  reportCount: 5,
});

const OTHER_CATEGORY = Object.freeze({
  id: REPORT_CATEGORY_OTHER_ID,
  name: 'その他',
  systemDefault: true,
  infringement: false,
  reportCount: 2,
});

const CATEGORIES: AdminReportCategoriesQuery = {
  adminReportCategories: [
    { ...SPAM_CATEGORY },
    { ...HARASSMENT_CATEGORY },
    { ...INFRINGEMENT_CATEGORY },
    { ...OTHER_CATEGORY },
  ],
};

const REPORT_CASE_ID = '01JE0REPRTCASE00000000000A';

const PROTECTED_MESSAGE = '標準のカテゴリは変更・削除できません。';

const NAME_TAKEN_MESSAGE = '同じ名前のカテゴリがあります。';

const INTERNAL_ERROR = Object.freeze({
  code: 'internal_error',
  message: 'サーバーで問題が発生しました。時間をおいて再度お試しください。',
  status: 500,
});

const unexpectedOperation = (): Promise<unknown> =>
  Promise.reject(new Error('想定していない操作が実行されました。'));

interface ReportCategoryHandlers {
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
  }: ReportCategoryHandlers = {},
): void => {
  respondAdminGraphQL(executeGraphQL, {
    role,
    handlers: new Map<unknown, GraphQLHandler>([
      [AdminReportCategoriesDocument, categories],
      [AdminCreateReportCategoryDocument, create],
      [AdminRenameReportCategoryDocument, rename],
      [AdminDeleteReportCategoryDocument, remove],
      [
        AdminProductCategoriesDocument,
        () =>
          success({
            adminProductCategories: [
              {
                id: '01JD0000000000000000000000',
                name: 'その他',
                handle: 'other',
                systemDefault: true,
              },
            ],
          }),
      ],
      [
        AdminHelpCategoriesDocument,
        () =>
          success({
            adminHelpCategories: [
              {
                id: '01JC0000000000000000000001',
                name: 'その他',
                systemDefault: true,
                sortOrder: 1,
                articleCount: 0,
              },
            ],
          }),
      ],
      [
        AdminInquiryCategoriesDocument,
        () =>
          success({
            adminInquiryCategories: [
              {
                id: '01JC0000000000000000000000',
                name: 'その他',
                systemDefault: true,
                linkedCount: 0,
              },
            ],
          }),
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
  handlers: ReportCategoryHandlers = {},
) => {
  respondCategories(role, handlers);
  return renderPageRouter({
    path: CATEGORIES_PATH,
    createRoutes,
    cachedViewer: adminWithRole(role),
  });
};

interface ReportQueryInvalidation {
  readonly auditLogs: boolean;
  readonly cases: boolean;
  readonly caseDetail: boolean;
}

// 通報の一覧・詳細と監査ログの画面で読んだ照会をキャッシュに置き、操作の後にそれらが無効にされたかを返す関数を作る
const watchReportQueries = (
  queryClient: QueryClient,
): (() => ReportQueryInvalidation) => {
  const auditLogsInvalidated = watchAuditLogQueries(queryClient);
  const casesKey = adminReportCasesQueryOptions({}).queryKey;
  const caseKey = adminReportCaseQueryOptions(REPORT_CASE_ID).queryKey;
  queryClient.setQueryData(casesKey, {
    adminReportCases: {
      nodes: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  });
  queryClient.setQueryData(caseKey, { adminReportCase: null });
  return () => ({
    auditLogs: auditLogsInvalidated(),
    cases: queryClient.getQueryState(casesKey)?.isInvalidated ?? false,
    caseDetail: queryClient.getQueryState(caseKey)?.isInvalidated ?? false,
  });
};

const ALL_INVALIDATED: ReportQueryInvalidation = Object.freeze({
  auditLogs: true,
  cases: true,
  caseDetail: true,
});

const NONE_INVALIDATED: ReportQueryInvalidation = Object.freeze({
  auditLogs: false,
  cases: false,
  caseDetail: false,
});

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
  callsOf(executeGraphQL, AdminReportCategoriesDocument).length;

const rowNames = () =>
  table()
    .getByRole('row')
    .elements()
    .slice(1)
    .map((row) => row.querySelector('td')?.textContent);

const waitForList = () =>
  expect.element(table().getByText('スパム', { exact: true })).toBeVisible();

beforeEach(() => {
  executeGraphQL.mockReset();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('カテゴリのページの通報カテゴリの区画', () => {
  test.each<AdminRole>(['VIEWER', 'MODERATOR', 'SUPER_ADMIN'])(
    '%sの管理者に、問い合わせカテゴリの区画の後ろへ見出し付きで置き、追加の順で「権利侵害」「その他」をこの順で末尾に並べる',
    async (role) => {
      await renderCategoriesPage(role);
      await waitForList();

      expect(rowNames()).toStrictEqual([
        'スパム',
        '嫌がらせ',
        '権利侵害システム標準',
        'その他システム標準',
      ]);
      const headings = main()
        .getByRole('heading', { level: 2 })
        .elements()
        .map((heading) => heading.textContent);
      expect(headings.at(-1)).toBe(SECTION_TITLE);
      expect(headings.at(-2)).toBe('問い合わせカテゴリ');
      expect(section().getByRole('link').elements()).toHaveLength(0);
    },
  );

  test('閲覧のみの管理者には一覧だけを示し、追加・編集・削除の操作と操作の列と権限が無い旨を描かない', async () => {
    await renderCategoriesPage('VIEWER');
    await waitForList();

    expect(section().getByRole('button').elements()).toHaveLength(0);
    expect(
      table().getByRole('columnheader', { name: '操作' }).query(),
    ).toBeNull();
    expect(section().element().textContent).not.toContain(
      'カテゴリを追加・編集・削除する権限がありません。',
    );
  });

  test.each<AdminRole>(['MODERATOR', 'SUPER_ADMIN'])(
    '%sの管理者には追加・名前の変更・削除を示し、標準カテゴリ「権利侵害」「その他」には削除の操作を描かずに削除できない旨を示す',
    async (role) => {
      await renderCategoriesPage(role);
      await waitForList();

      await expect.element(addButton()).toBeEnabled();
      for (const name of ['スパム', '嫌がらせ']) {
        await expect.element(rowButton(name, '編集')).toBeEnabled();
        await expect.element(rowButton(name, '削除')).toBeEnabled();
      }
      for (const name of ['権利侵害', 'その他']) {
        expect(rowButton(name, '削除').query()).toBeNull();
      }
      await expect
        .element(
          section().getByText('システム標準のカテゴリは削除できません。'),
        )
        .toBeVisible();
    },
  );

  test('カテゴリを追加すると前後の空白を除いた名前を送ってダイアログを閉じ、カテゴリを取り直して案件と監査ログの照会を無効にする', async () => {
    const create = vi.fn<GraphQLHandler>(() =>
      success({ createReportCategory: { id: '01JE0CATEGRY0000000000000C' } }),
    );
    const router = await renderCategoriesPage('MODERATOR', { create });
    await waitForList();
    const invalidated = watchReportQueries(router.options.context.queryClient);
    const fetchedBefore = categoryCalls();

    await userEvent.click(addButton());
    await userEvent.fill(nameBox('カテゴリを追加'), '  なりすまし  ');
    await userEvent.click(
      dialogOf('カテゴリを追加').getByRole('button', { name: '追加' }),
    );

    await expect.element(dialogOf('カテゴリを追加')).not.toBeInTheDocument();
    expect(create).toHaveBeenCalledExactlyOnceWith({ name: 'なりすまし' });
    await expect.poll(categoryCalls).toBeGreaterThan(fetchedBefore);
    expect(invalidated()).toStrictEqual(ALL_INVALIDATED);
  });

  test('同じ名前のカテゴリがあると、ダイアログを開いたまま名前の欄にAPIの文言を示し、照会を無効にしない', async () => {
    const router = await renderCategoriesPage('MODERATOR', {
      create: () =>
        failure({
          code: 'report_category_name_taken',
          message: NAME_TAKEN_MESSAGE,
          status: 409,
          details: [
            { field: 'name', code: 'name-taken', message: NAME_TAKEN_MESSAGE },
          ],
        }),
    });
    await waitForList();
    const invalidated = watchReportQueries(router.options.context.queryClient);
    const fetchedBefore = categoryCalls();

    await userEvent.click(addButton());
    await userEvent.fill(nameBox('カテゴリを追加'), 'スパム');
    await userEvent.click(
      dialogOf('カテゴリを追加').getByRole('button', { name: '追加' }),
    );

    await expect
      .element(nameBox('カテゴリを追加'))
      .toHaveAccessibleDescription(NAME_TAKEN_MESSAGE);
    expect(categoryCalls()).toBe(fetchedBefore);
    expect(invalidated()).toStrictEqual(NONE_INVALIDATED);
  });

  test('名前を変更するとカテゴリのIDと新しい名前を送り、カテゴリを取り直して案件と監査ログの照会を無効にする', async () => {
    const rename = vi.fn<GraphQLHandler>(() =>
      success({ renameReportCategory: { id: SPAM_CATEGORY.id } }),
    );
    const router = await renderCategoriesPage('MODERATOR', { rename });
    await waitForList();
    const invalidated = watchReportQueries(router.options.context.queryClient);
    const fetchedBefore = categoryCalls();

    await userEvent.click(rowButton('スパム', '編集'));
    await expect
      .element(nameBox('カテゴリ「スパム」を編集'))
      .toHaveValue('スパム');
    await userEvent.fill(nameBox('カテゴリ「スパム」を編集'), '宣伝・スパム');
    await userEvent.click(
      dialogOf('カテゴリ「スパム」を編集').getByRole('button', {
        name: '保存',
      }),
    );

    await expect
      .element(dialogOf('カテゴリ「スパム」を編集'))
      .not.toBeInTheDocument();
    expect(rename).toHaveBeenCalledExactlyOnceWith({
      id: SPAM_CATEGORY.id,
      name: '宣伝・スパム',
    });
    await expect.poll(categoryCalls).toBeGreaterThan(fetchedBefore);
    expect(invalidated()).toStrictEqual(ALL_INVALIDATED);
  });

  test.each(['権利侵害', 'その他'])(
    '標準カテゴリ「%s」の名前の変更はAPIの拒否の文言をダイアログに示し、照会を無効にしない',
    async (name) => {
      const rename = vi.fn<GraphQLHandler>(() =>
        failure({
          code: 'report_category_protected',
          message: PROTECTED_MESSAGE,
          status: 422,
        }),
      );
      const router = await renderCategoriesPage('MODERATOR', { rename });
      await waitForList();
      const invalidated = watchReportQueries(
        router.options.context.queryClient,
      );

      await userEvent.click(rowButton(name, '編集'));
      await userEvent.fill(nameBox(`カテゴリ「${name}」を編集`), '別の名前');
      await userEvent.click(
        dialogOf(`カテゴリ「${name}」を編集`).getByRole('button', {
          name: '保存',
        }),
      );

      await expect
        .element(dialogOf(`カテゴリ「${name}」を編集`).getByRole('alert'))
        .toHaveTextContent(PROTECTED_MESSAGE);
      expect(rename).toHaveBeenCalledTimes(1);
      expect(invalidated()).toStrictEqual(NONE_INVALIDATED);
    },
  );

  test('削除の確認に付け替える通報の件数(3桁区切り)と監査ログに記録される旨を示し、確定するとIDを送ってカテゴリを取り直し、案件と監査ログの照会を無効にする', async () => {
    const remove = vi.fn<GraphQLHandler>(() =>
      success({ deleteReportCategory: { reassignedCount: 1234 } }),
    );
    const router = await renderCategoriesPage('MODERATOR', { remove });
    await waitForList();

    await userEvent.click(rowButton('スパム', '削除'));
    await expect
      .element(deleteDialog('スパム'))
      .toHaveTextContent(
        'このカテゴリの通報1,234件は「その他」へ付け替えます。',
      );
    await expect
      .element(deleteDialog('スパム'))
      .toHaveTextContent(AUDITED_NOTICE);
    expect(deleteDialog('スパム').getByRole('textbox').elements()).toHaveLength(
      0,
    );
    const invalidated = watchReportQueries(router.options.context.queryClient);
    const fetchedBefore = categoryCalls();

    await userEvent.click(
      deleteDialog('スパム').getByRole('button', { name: '削除' }),
    );

    await expect.element(deleteDialog('スパム')).not.toBeInTheDocument();
    expect(remove).toHaveBeenCalledExactlyOnceWith({ id: SPAM_CATEGORY.id });
    await expect.poll(categoryCalls).toBeGreaterThan(fetchedBefore);
    expect(invalidated()).toStrictEqual(ALL_INVALIDATED);
  });

  test('付け替える通報が無いカテゴリの削除の確認は、カテゴリの削除の確認の既定の説明を示す', async () => {
    await renderCategoriesPage('MODERATOR');
    await waitForList();

    await userEvent.click(rowButton('嫌がらせ', '削除'));

    await expect
      .element(deleteDialog('嫌がらせ'))
      .toHaveTextContent('削除したカテゴリは元に戻せません。');
    expect(deleteDialog('嫌がらせ').element().textContent).not.toContain(
      '付け替え',
    );
    await expect
      .element(deleteDialog('嫌がらせ'))
      .toHaveTextContent(AUDITED_NOTICE);
  });

  test('削除の拒否はAPIの文言を確認のダイアログに示し、照会を無効にしない', async () => {
    const remove = vi.fn<GraphQLHandler>(() =>
      failure({
        code: 'report_category_not_found',
        message: 'カテゴリが見つかりません。',
        status: 404,
      }),
    );
    const router = await renderCategoriesPage('MODERATOR', { remove });
    await waitForList();
    const invalidated = watchReportQueries(router.options.context.queryClient);

    await userEvent.click(rowButton('スパム', '削除'));
    await userEvent.click(
      deleteDialog('スパム').getByRole('button', { name: '削除' }),
    );

    await expect
      .element(deleteDialog('スパム').getByRole('alert'))
      .toHaveTextContent('カテゴリが見つかりません。');
    expect(invalidated()).toStrictEqual(NONE_INVALIDATED);
  });

  test('カテゴリの最初の取得の失敗は区画の見出しの下に問い合わせを促さない文言と再試行で示し、他の区画を止めず、再試行で表示する', async () => {
    let failing = true;
    await renderCategoriesPage('MODERATOR', {
      categories: () =>
        failing ? failure(INTERNAL_ERROR) : success(CATEGORIES),
    });

    await expect
      .element(section().getByRole('alert'))
      .toHaveTextContent(INTERNAL_ERROR.message);
    await expect
      .element(
        main().getByRole('table', { name: '問い合わせカテゴリ', exact: true }),
      )
      .toBeVisible();
    expect(section().getByRole('link').elements()).toHaveLength(0);
    expect(section().element().textContent).not.toContain('お問い合わせ');

    failing = false;
    await userEvent.click(section().getByRole('button', { name: '再試行' }));

    await waitForList();
  });

  test.each(COLOR_SCHEMES)(
    '%sの配色で、通報カテゴリの区画と削除の確認がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderCategoriesPage('MODERATOR');
      await waitForList();

      expect(await runAxe(document.body)).toStrictEqual([]);

      await userEvent.click(rowButton('スパム', '削除'));
      await expect.element(deleteDialog('スパム')).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test('閲覧のみの管理者に示す区画がWCAG 2.2 AAの自動検査に違反しない', async () => {
    await renderCategoriesPage('VIEWER');
    await waitForList();

    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
