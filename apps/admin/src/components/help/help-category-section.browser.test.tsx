import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import { HELP_CATEGORY_OTHER_ID } from '../../../common-lib/help/help-category-constants.ts';
import { Toaster } from '../../../lib/components/feedback/toaster.tsx';
import { RecoverableSlot } from '../../../lib/components/state/recoverable-slot.tsx';
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
import { adminWithRole } from '../../../test/admin-viewer-fixtures.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import { toAdminViewer } from '../../graphql/admin-viewer.ts';
import {
  AdminCreateHelpCategoryDocument,
  AdminDeleteHelpCategoryDocument,
  AdminHelpCategoriesDocument,
  type AdminHelpCategoriesQuery,
  AdminRenameHelpCategoryDocument,
  AdminReorderHelpCategoriesDocument,
  type AdminRole,
} from '../../graphql/generated/graphql.ts';
import { AdminViewerProvider } from '../layout/admin-viewer-context.tsx';
import { HelpCategorySection } from './help-category-section.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

// ログイン中の管理者の取得の補助が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

vi.mock('../../../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

type Category = AdminHelpCategoriesQuery['adminHelpCategories'][number];

const TITLE = 'ヘルプ記事カテゴリ';

const ORDER_LIST_LABEL = 'ヘルプ記事カテゴリの並び順';

const AUDITED_NOTICE = 'この操作は監査ログに記録されます。';

const OUTDATED_MESSAGE =
  '並び順が別の画面で変更されました。最新の並びを読み込んでから並べ替えてください。';

const PRICING = Object.freeze({
  id: '01JD0HCAT00000000000000002',
  name: '料金',
  systemDefault: false,
  sortOrder: 1,
  articleCount: 1234,
});

const OTHER = Object.freeze({
  id: HELP_CATEGORY_OTHER_ID,
  name: 'その他',
  systemDefault: true,
  sortOrder: 2,
  articleCount: 0,
});

const USAGE = Object.freeze({
  id: '01JD0HCAT00000000000000001',
  name: '使い方',
  systemDefault: false,
  sortOrder: 3,
  articleCount: 3,
});

const ACCOUNT = Object.freeze({
  id: '01JD0HCAT00000000000000003',
  name: 'アカウント',
  systemDefault: false,
  sortOrder: 4,
  articleCount: 0,
});

// 名前の順やIDの順と異なる、管理者が指定した並び順
const CATEGORIES: readonly Category[] = Object.freeze([PRICING, OTHER, USAGE]);

const categoriesOf = (
  categories: readonly Category[],
): AdminHelpCategoriesQuery => ({
  adminHelpCategories: categories.map((category) => ({ ...category })),
});

const INTERNAL_ERROR = Object.freeze({
  code: 'internal_error',
  message: 'サーバーで問題が発生しました。時間をおいて再度お試しください。',
  status: 500,
});

const unexpectedOperation = (): Promise<unknown> =>
  Promise.reject(new Error('想定していない操作が実行されました。'));

interface SectionHandlers {
  readonly categories?: GraphQLHandler;
  readonly create?: GraphQLHandler;
  readonly rename?: GraphQLHandler;
  readonly remove?: GraphQLHandler;
  readonly reorder?: GraphQLHandler;
}

const respond = ({
  categories = () => success(categoriesOf(CATEGORIES)),
  create = unexpectedOperation,
  rename = unexpectedOperation,
  remove = unexpectedOperation,
  reorder = unexpectedOperation,
}: SectionHandlers = {}): void => {
  const handlers = new Map<unknown, GraphQLHandler>([
    [AdminHelpCategoriesDocument, categories],
    [AdminCreateHelpCategoryDocument, create],
    [AdminRenameHelpCategoryDocument, rename],
    [AdminDeleteHelpCategoryDocument, remove],
    [AdminReorderHelpCategoriesDocument, reorder],
  ]);
  executeGraphQL.mockImplementation((document: unknown, variables: unknown) => {
    const handler = handlers.get(document);
    return handler === undefined ? unexpectedOperation() : handler(variables);
  });
};

// カテゴリのページが包むのと同じく区画のエラーの境界に包み、ログイン中の管理者を外側に置く
async function renderSection(
  role: AdminRole,
  handlers: SectionHandlers = {},
): Promise<void> {
  respond(handlers);
  const viewer = toAdminViewer(adminWithRole(role));
  if (viewer === null) {
    throw new Error('ログイン中の管理者を作れませんでした。');
  }
  await render(<Toaster />);
  await renderInRouter(
    <AdminViewerProvider viewer={viewer}>
      <main className="p-4">
        <RecoverableSlot contactAvailable={false}>
          <HelpCategorySection />
        </RecoverableSlot>
      </main>
    </AdminViewerProvider>,
  );
  await expect
    .element(table().getByText(PRICING.name, { exact: true }))
    .toBeVisible();
}

const section = () => page.getByRole('region', { name: TITLE });
const table = () => section().getByRole('table', { name: TITLE });
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
const editOrderButton = () =>
  section().getByRole('button', { name: '並び順を変更', exact: true });
const orderList = () => section().getByRole('list', { name: ORDER_LIST_LABEL });
const moveButton = (name: string, direction: '上' | '下') =>
  section().getByRole('button', {
    name: `${name}を${direction}へ移動`,
    exact: true,
  });
const saveButton = () =>
  section().getByRole('button', { name: '保存', exact: true });
const cancelButton = () =>
  section().getByRole('button', { name: 'キャンセル', exact: true });
const reloadButton = () =>
  section().getByRole('button', { name: '最新の並びを読み込む', exact: true });

const rowNames = () =>
  table()
    .getByRole('row')
    .elements()
    .slice(1)
    .map((row) => row.querySelector('td')?.textContent);

const orderNames = () =>
  orderList()
    .getByRole('listitem')
    .elements()
    .map(
      (item) =>
        item.querySelector('[data-slot="help-category-name"]')?.textContent,
    );

const categoryCalls = () =>
  callsOf(executeGraphQL, AdminHelpCategoriesDocument).length;

beforeEach(() => {
  executeGraphQL.mockReset();
});

afterEach(() => {
  toast.dismiss();
  applyColorScheme('light');
});

describe('カテゴリの一覧と追加・名前の変更・削除', () => {
  test('区画の見出しの下に、カテゴリをAPIが返した順のまま並べる', async () => {
    await renderSection('MODERATOR');

    await expect
      .element(section().getByRole('heading', { level: 2, name: TITLE }))
      .toBeVisible();
    expect(rowNames()).toStrictEqual(['料金', 'その他システム標準', '使い方']);
    await expect.element(editOrderButton()).toBeVisible();
    expect(orderList().query()).toBeNull();
  });

  test('カテゴリを追加すると名前を送り、一覧を取り直す', async () => {
    const create = vi.fn<GraphQLHandler>(() =>
      success({ createHelpCategory: { ...ACCOUNT } }),
    );
    await renderSection('MODERATOR', { create });
    const fetchedBefore = categoryCalls();

    await userEvent.click(addButton());
    await userEvent.fill(nameBox('カテゴリを追加'), 'アカウント');
    await userEvent.click(
      dialogOf('カテゴリを追加').getByRole('button', { name: '追加' }),
    );

    await expect.element(dialogOf('カテゴリを追加')).not.toBeInTheDocument();
    expect(create).toHaveBeenCalledExactlyOnceWith({ name: 'アカウント' });
    await expect.poll(categoryCalls).toBeGreaterThan(fetchedBefore);
  });

  test('同じ名前のカテゴリがあると、追加のダイアログを開いたままAPIの文言を示す', async () => {
    const message = '同じ名前のカテゴリが既にあります。';
    await renderSection('MODERATOR', {
      create: () =>
        failure({ code: 'help_category_name_taken', message, status: 409 }),
    });

    await userEvent.click(addButton());
    await userEvent.fill(nameBox('カテゴリを追加'), '料金');
    await userEvent.click(
      dialogOf('カテゴリを追加').getByRole('button', { name: '追加' }),
    );

    await expect
      .element(dialogOf('カテゴリを追加').getByRole('alert'))
      .toHaveTextContent(message);
  });

  test('標準カテゴリ「その他」は削除の操作を描かず、名前の変更はAPIの拒否の文言を示す', async () => {
    const message = '標準カテゴリ「その他」は変更・削除できません。';
    const rename = vi.fn<GraphQLHandler>(() =>
      failure({ code: 'help_category_protected', message, status: 409 }),
    );
    await renderSection('MODERATOR', { rename });

    expect(rowButton('その他', '削除').query()).toBeNull();
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
    expect(rename).toHaveBeenCalledExactlyOnceWith({
      id: HELP_CATEGORY_OTHER_ID,
      name: 'そのほか',
    });
  });

  test('削除の確認に付け替わる記事の件数と「その他」の末尾に並ぶ旨と監査ログに記録される旨を示し、確定するとIDを送って一覧を取り直す', async () => {
    const remove = vi.fn<GraphQLHandler>(() =>
      success({
        deleteHelpCategory: { id: USAGE.id, reassignedCount: 3 },
      }),
    );
    await renderSection('MODERATOR', { remove });

    await userEvent.click(rowButton('料金', '削除'));
    await expect
      .element(deleteDialog('料金'))
      .toHaveTextContent(
        '付け替わる記事は1,234件です。付け替えた記事は「その他」の末尾に並びます。',
      );
    await expect
      .element(deleteDialog('料金'))
      .toHaveTextContent(AUDITED_NOTICE);
    await userEvent.click(
      deleteDialog('料金').getByRole('button', { name: 'キャンセル' }),
    );
    await expect.element(deleteDialog('料金')).not.toBeInTheDocument();

    await userEvent.click(rowButton('使い方', '削除'));
    await expect
      .element(deleteDialog('使い方'))
      .toHaveTextContent(
        '付け替わる記事は3件です。付け替えた記事は「その他」の末尾に並びます。',
      );
    const fetchedBefore = categoryCalls();
    await userEvent.click(
      deleteDialog('使い方').getByRole('button', { name: '削除' }),
    );

    await expect.element(deleteDialog('使い方')).not.toBeInTheDocument();
    expect(remove).toHaveBeenCalledExactlyOnceWith({ id: USAGE.id });
    await expect.poll(categoryCalls).toBeGreaterThan(fetchedBefore);
  });

  test('削除するカテゴリが既に無いと、確認のダイアログにAPIの文言を示す', async () => {
    const message = 'このカテゴリは削除されています。';
    await renderSection('MODERATOR', {
      remove: () =>
        failure({ code: 'help_category_not_found', message, status: 404 }),
    });

    await userEvent.click(rowButton('料金', '削除'));
    await userEvent.click(
      deleteDialog('料金').getByRole('button', { name: '削除' }),
    );

    await expect
      .element(deleteDialog('料金').getByRole('alert'))
      .toHaveTextContent(message);
  });
});

describe('カテゴリの並べ替え', () => {
  test('「並び順を変更」で全カテゴリの並べ替えの一覧と保存・キャンセルを表示し、続きの操作へフォーカスを移す', async () => {
    await renderSection('MODERATOR');

    await userEvent.click(editOrderButton());

    await expect.element(orderList()).toBeVisible();
    expect(orderNames()).toStrictEqual(['料金', 'その他', '使い方']);
    await expect.element(moveButton('料金', '下')).toHaveFocus();
    await expect.element(saveButton()).toBeVisible();
    await expect.element(cancelButton()).toBeVisible();
    await expect.element(section()).toHaveTextContent(AUDITED_NOTICE);
    expect(editOrderButton().query()).toBeNull();
  });

  test('上下の移動の結果のIDの並びを保存し、成功を知らせて一覧を新しい並びにし、「並び順を変更」へフォーカスを戻す', async () => {
    const saved = [USAGE, PRICING, OTHER];
    const reorder = vi.fn<GraphQLHandler>(() =>
      success({
        reorderHelpCategories: categoriesOf(saved).adminHelpCategories,
      }),
    );
    let current: readonly Category[] = CATEGORIES;
    await renderSection('MODERATOR', {
      categories: () => success(categoriesOf(current)),
      reorder: (variables) => {
        current = saved;
        return reorder(variables);
      },
    });

    await userEvent.click(editOrderButton());
    await userEvent.click(moveButton('使い方', '上'));
    await userEvent.click(moveButton('使い方', '上'));
    expect(orderNames()).toStrictEqual(['使い方', '料金', 'その他']);
    await userEvent.click(saveButton());

    await expect
      .element(page.getByText('並び順を保存しました。', { exact: true }))
      .toBeVisible();
    expect(reorder).toHaveBeenCalledExactlyOnceWith({
      orderedIds: [USAGE.id, PRICING.id, OTHER.id],
    });
    await expect.element(orderList()).not.toBeInTheDocument();
    await expect.element(editOrderButton()).toHaveFocus();
    expect(rowNames()).toStrictEqual(['使い方', '料金', 'その他システム標準']);
  });

  test('キャンセルで保存せずに編集の前の並びへ戻し、「並び順を変更」へフォーカスを戻す', async () => {
    await renderSection('MODERATOR');

    await userEvent.click(editOrderButton());
    await userEvent.click(moveButton('料金', '下'));
    expect(orderNames()).toStrictEqual(['その他', '料金', '使い方']);
    await userEvent.click(cancelButton());

    await expect.element(orderList()).not.toBeInTheDocument();
    await expect.element(editOrderButton()).toHaveFocus();
    expect(
      callsOf(executeGraphQL, AdminReorderHelpCategoriesDocument),
    ).toHaveLength(0);
    expect(rowNames()).toStrictEqual(['料金', 'その他システム標準', '使い方']);

    await userEvent.click(editOrderButton());
    expect(orderNames()).toStrictEqual(['料金', 'その他', '使い方']);
  });

  test('並べ替えを始めた後にカテゴリが増えていると、古い並びの案内と「最新の並びを読み込む」を示し、読み込むと最新の並びで並べ替えを続けられる', async () => {
    let current: readonly Category[] = CATEGORIES;
    const reorder = vi.fn<GraphQLHandler>(() =>
      failure({
        code: 'help_order_outdated',
        message: OUTDATED_MESSAGE,
        status: 409,
      }),
    );
    await renderSection('MODERATOR', {
      categories: () => success(categoriesOf(current)),
      reorder,
    });

    await userEvent.click(editOrderButton());
    current = [...CATEGORIES, ACCOUNT];
    await userEvent.click(moveButton('使い方', '上'));
    await userEvent.click(saveButton());

    await expect
      .element(section().getByRole('alert'))
      .toHaveTextContent(OUTDATED_MESSAGE);
    await expect.element(reloadButton()).toBeVisible();
    expect(orderNames()).toStrictEqual(['料金', '使い方', 'その他']);

    await userEvent.click(reloadButton());

    await expect.element(reloadButton()).not.toBeInTheDocument();
    expect(section().getByRole('alert').query()).toBeNull();
    expect(orderNames()).toStrictEqual([
      '料金',
      'その他',
      '使い方',
      'アカウント',
    ]);
    await expect.element(moveButton('料金', '下')).toHaveFocus();
    await expect
      .element(table().getByText('アカウント', { exact: true }))
      .toBeVisible();

    reorder.mockImplementation(() =>
      success({
        reorderHelpCategories: categoriesOf(current).adminHelpCategories,
      }),
    );
    await userEvent.click(saveButton());

    await expect.element(orderList()).not.toBeInTheDocument();
    expect(reorder).toHaveBeenLastCalledWith({
      orderedIds: [PRICING.id, OTHER.id, USAGE.id, ACCOUNT.id],
    });
  });

  test('読み込みの間は「キャンセル」を押せないことを伝えて編集を続け、読み込みのボタンの外へ移したフォーカスを読み込みの後に奪わない', async () => {
    let reloading: Promise<unknown> | null = null;
    let finishReload: (value: unknown) => void = () => undefined;
    await renderSection('MODERATOR', {
      categories: () => reloading ?? success(categoriesOf(CATEGORIES)),
      reorder: () =>
        failure({
          code: 'help_order_outdated',
          message: OUTDATED_MESSAGE,
          status: 409,
        }),
    });

    await userEvent.click(editOrderButton());
    await userEvent.click(moveButton('使い方', '上'));
    await userEvent.click(saveButton());
    await expect.element(reloadButton()).toBeVisible();
    reloading = new Promise((resolve) => {
      finishReload = resolve;
    });

    await userEvent.click(reloadButton());
    await expect
      .element(cancelButton())
      .toHaveAttribute('aria-disabled', 'true');
    cancelButton().element().focus();
    await userEvent.keyboard('{Enter}');

    await expect.element(orderList()).toBeVisible();
    expect(orderNames()).toStrictEqual(['料金', '使い方', 'その他']);
    await expect.element(cancelButton()).toHaveFocus();

    finishReload(success(categoriesOf([...CATEGORIES, ACCOUNT])));

    await expect.element(reloadButton()).not.toBeInTheDocument();
    await expect
      .poll(orderNames)
      .toStrictEqual(['料金', 'その他', '使い方', 'アカウント']);
    await expect.element(cancelButton()).toHaveFocus();
    await expect.element(cancelButton()).not.toHaveAttribute('aria-disabled');
  });

  test('並べ替えの途中に表でカテゴリの名前を変えると、手元の並びを保ったまま新しい名前で示す', async () => {
    let current: readonly Category[] = CATEGORIES;
    const renamed = { ...USAGE, name: '使い方のヒント' };
    const reorder = vi.fn<GraphQLHandler>(() =>
      success({
        reorderHelpCategories: categoriesOf(current).adminHelpCategories,
      }),
    );
    await renderSection('MODERATOR', {
      categories: () => success(categoriesOf(current)),
      rename: () => {
        current = [PRICING, OTHER, renamed];
        return success({ renameHelpCategory: renamed });
      },
      reorder,
    });

    await userEvent.click(editOrderButton());
    await userEvent.click(moveButton('使い方', '上'));
    await userEvent.click(rowButton('使い方', '編集'));
    await userEvent.fill(nameBox('カテゴリ「使い方」を編集'), renamed.name);
    await userEvent.click(
      dialogOf('カテゴリ「使い方」を編集').getByRole('button', {
        name: '保存',
      }),
    );

    await expect
      .element(table().getByText(renamed.name, { exact: true }))
      .toBeVisible();
    expect(orderNames()).toStrictEqual(['料金', renamed.name, 'その他']);
    await expect.element(moveButton(renamed.name, '上')).toBeVisible();
    await userEvent.click(saveButton());

    await expect.element(orderList()).not.toBeInTheDocument();
    expect(reorder).toHaveBeenCalledExactlyOnceWith({
      orderedIds: [PRICING.id, USAGE.id, OTHER.id],
    });
  });

  test('古い並び以外の保存の失敗はAPIの文言を示し、「最新の並びを読み込む」を出さずに編集を続ける', async () => {
    await renderSection('MODERATOR', {
      reorder: () => failure(INTERNAL_ERROR),
    });

    await userEvent.click(editOrderButton());
    await userEvent.click(saveButton());

    await expect
      .element(section().getByRole('alert'))
      .toHaveTextContent(INTERNAL_ERROR.message);
    expect(reloadButton().query()).toBeNull();
    await expect.element(orderList()).toBeVisible();
    await expect.element(saveButton()).toHaveFocus();
  });
});

describe('閲覧のみの管理者', () => {
  test('カテゴリの並びだけを見せ、追加・編集・削除・並べ替えの導線を描かない', async () => {
    await renderSection('VIEWER');

    expect(rowNames()).toStrictEqual(['料金', 'その他システム標準', '使い方']);
    expect(addButton().query()).toBeNull();
    expect(rowButton('料金', '編集').query()).toBeNull();
    expect(rowButton('料金', '削除').query()).toBeNull();
    expect(rowButton('その他', '編集').query()).toBeNull();
    expect(
      table().getByRole('columnheader', { name: '操作' }).query(),
    ).toBeNull();
    expect(editOrderButton().query()).toBeNull();
    expect(orderList().query()).toBeNull();
    expect(section().getByRole('button').elements()).toHaveLength(0);
    expect(
      section()
        .getByText('カテゴリを追加・編集・削除する権限がありません。')
        .query(),
    ).toBeNull();
  });
});

describe('アクセシビリティ', () => {
  test.each(COLOR_SCHEMES)(
    '%sの配色で、一覧・並べ替え・古い並びの案内・削除の確認がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderSection('MODERATOR', {
        reorder: () =>
          failure({
            code: 'help_order_outdated',
            message: OUTDATED_MESSAGE,
            status: 409,
          }),
      });

      expect(await runAxe(document.body)).toStrictEqual([]);

      await userEvent.click(editOrderButton());
      await userEvent.click(saveButton());
      await expect.element(reloadButton()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);

      await userEvent.click(rowButton('料金', '削除'));
      await expect.element(deleteDialog('料金')).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test('閲覧のみの管理者の表示がWCAG 2.2 AAの自動検査に違反しない', async () => {
    await renderSection('VIEWER');

    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
