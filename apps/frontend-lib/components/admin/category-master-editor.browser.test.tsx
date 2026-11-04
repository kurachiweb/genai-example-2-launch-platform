import { afterEach, describe, expect, type Mock, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../../test/computed-style.ts';
import { GraphQLClientError } from '../../utilities/graphql/graphql-result.ts';
import {
  CategoryMasterEditor,
  type CategoryMasterEditorProps,
} from './category-master-editor.tsx';

const TITLE = 'プロダクトカテゴリ';

const FAILURE_MESSAGE = 'このカテゴリは使われているため削除できません。';

const CATEGORIES: CategoryMasterEditorProps['categories'] = [
  {
    id: 'c1',
    name: '開発ツール',
    handle: 'developer-tools',
    systemDefault: false,
  },
  { id: 'c2', name: 'デザイン', handle: 'design', systemDefault: false },
  { id: 'c3', name: 'その他', handle: 'other', systemDefault: true },
];

type OnCreate = CategoryMasterEditorProps['onCreate'];
type OnUpdate = CategoryMasterEditorProps['onUpdate'];
type OnDelete = CategoryMasterEditorProps['onDelete'];

interface EditorMocks {
  readonly onCreate: Mock<OnCreate>;
  readonly onUpdate: Mock<OnUpdate>;
  readonly onDelete: Mock<OnDelete>;
  readonly failureMessageOf: Mock<(error: unknown) => string>;
}

const mocks = (overrides: Partial<EditorMocks> = {}): EditorMocks => ({
  onCreate: vi.fn<OnCreate>(() => Promise.resolve()),
  onUpdate: vi.fn<OnUpdate>(() => Promise.resolve()),
  onDelete: vi.fn<OnDelete>(() => Promise.resolve()),
  failureMessageOf: vi.fn(() => FAILURE_MESSAGE),
  ...overrides,
});

const renderEditor = async (
  props: Partial<CategoryMasterEditorProps> = {},
  editorMocks: EditorMocks = mocks(),
): Promise<EditorMocks> => {
  await render(
    <CategoryMasterEditor
      title={TITLE}
      categories={CATEGORIES}
      withHandle
      canEdit
      {...editorMocks}
      {...props}
    />,
  );
  return editorMocks;
};

const table = () => page.getByRole('table', { name: TITLE });

const heading = () => page.getByRole('heading', { name: TITLE, level: 2 });

const addButton = () =>
  page.getByRole('button', { name: 'カテゴリを追加', exact: true });

const rowButton = (name: string, action: '編集' | '削除') =>
  page.getByRole('button', { name: `「${name}」を${action}`, exact: true });

const formDialog = (name: string) => page.getByRole('dialog', { name });

const nameBox = (dialogName: string) =>
  formDialog(dialogName).getByRole('textbox', {
    name: 'カテゴリ名(必須)',
    exact: true,
  });

const deleteDialog = (name: string) =>
  page.getByRole('dialog', { name: `カテゴリ「${name}」を削除しますか?` });

afterEach(() => {
  applyColorScheme('light');
});

describe('CategoryMasterEditor', () => {
  test('題を見出しにし、カテゴリを渡した順に名前とハンドルの列で一覧にする', async () => {
    await renderEditor();

    await expect.element(heading()).toBeVisible();
    await expect.element(table()).toBeVisible();
    const headers = table()
      .getByRole('columnheader')
      .elements()
      .map((element) => element.textContent);
    expect(headers).toStrictEqual(['カテゴリ名', 'ハンドル', '操作']);
    const rows = table().getByRole('row').elements().slice(1);
    expect(
      rows.map((row) => row.querySelector('td')?.textContent),
    ).toStrictEqual(['開発ツール', 'デザイン', 'その他システム標準']);
    await expect
      .element(table().getByRole('cell', { name: 'developer-tools' }))
      .toBeVisible();
  });

  test('ハンドルを持たないカテゴリは、ハンドルの列を描かない', async () => {
    await renderEditor({
      withHandle: false,
      categories: CATEGORIES.map(({ id, name, systemDefault }) => ({
        id,
        name,
        systemDefault,
      })),
    });

    const headers = table()
      .getByRole('columnheader')
      .elements()
      .map((element) => element.textContent);
    expect(headers).toStrictEqual(['カテゴリ名', '操作']);
  });

  test('ハンドルの無いカテゴリは、ハンドルの欄に未設定と示す', async () => {
    await renderEditor({
      categories: [{ id: 'c1', name: '開発ツール', systemDefault: false }],
    });

    await expect
      .element(table().getByRole('cell', { name: '未設定' }))
      .toBeVisible();
  });

  test('読み込み中は表の領域を処理中にし、0件なら空の表示を描く', async () => {
    const { rerender } = await render(
      <CategoryMasterEditor
        title={TITLE}
        categories={undefined}
        withHandle={false}
        canEdit
        {...mocks()}
      />,
    );

    expect(
      document.querySelector(
        '[data-slot="admin-data-table"] [aria-busy="true"]',
      ),
    ).not.toBeNull();

    await rerender(
      <CategoryMasterEditor
        title={TITLE}
        categories={[]}
        withHandle={false}
        canEdit
        {...mocks()}
      />,
    );

    await expect
      .element(page.getByText('カテゴリはまだありません。'))
      .toBeVisible();
  });

  test('システム標準のカテゴリは、印を付けて削除の操作を描かず、削除できない旨を示す', async () => {
    await renderEditor();

    await expect
      .element(table().getByText('システム標準', { exact: true }))
      .toBeVisible();
    expect(rowButton('その他', '削除').elements()).toHaveLength(0);
    await expect.element(rowButton('その他', '編集')).toBeEnabled();
    await expect.element(rowButton('開発ツール', '削除')).toBeEnabled();
    await expect
      .element(page.getByText('システム標準のカテゴリは削除できません。'))
      .toBeVisible();
  });

  test('システム標準のカテゴリが無ければ、削除できない旨を示さない', async () => {
    await renderEditor({
      categories: CATEGORIES.filter((category) => !category.systemDefault),
    });

    expect(
      page.getByText('システム標準のカテゴリは削除できません。').elements(),
    ).toHaveLength(0);
  });

  test('権限が無いときは、追加・編集・削除の操作を無効にし、その旨を示す', async () => {
    await renderEditor({ canEdit: false });

    await expect.element(addButton()).toHaveAttribute('disabled');
    await expect
      .element(rowButton('開発ツール', '編集'))
      .toHaveAttribute('disabled');
    await expect
      .element(rowButton('開発ツール', '削除'))
      .toHaveAttribute('disabled');
    await expect
      .element(rowButton('その他', '編集'))
      .toHaveAttribute('disabled');
    await expect
      .element(
        page.getByText('カテゴリを追加・編集・削除する権限がありません。'),
      )
      .toBeVisible();
  });

  test('権限があるときは、権限が無い旨を示さない', async () => {
    await renderEditor();

    expect(
      page
        .getByText('カテゴリを追加・編集・削除する権限がありません。')
        .elements(),
    ).toHaveLength(0);
  });

  test('追加では、名前とハンドルを入力して保存すると呼び出す側へ渡して閉じる', async () => {
    const validateHandle = vi.fn((handle: string) =>
      /^[a-z0-9-]+$/u.test(handle)
        ? undefined
        : 'ハンドルの形式が正しくありません。',
    );
    const { onCreate } = await renderEditor({ validateHandle });

    await addButton().click();
    const dialogName = 'カテゴリを追加';
    await expect.element(formDialog(dialogName)).toBeVisible();
    await nameBox(dialogName).fill(' 開発支援 ');
    await formDialog(dialogName)
      .getByRole('textbox', { name: 'ハンドル', exact: true })
      .fill('dev-support');
    await formDialog(dialogName)
      .getByRole('button', { name: '追加', exact: true })
      .click();

    expect(onCreate).toHaveBeenCalledExactlyOnceWith({
      name: '開発支援',
      handle: 'dev-support',
    });
    expect(validateHandle).toHaveBeenCalledWith('dev-support');
    await expect.element(formDialog(dialogName)).not.toBeInTheDocument();
    await expect.element(addButton()).toHaveFocus();
  });

  test('ハンドルを持たないカテゴリの追加は、ハンドルの欄を描かず名前だけを渡す', async () => {
    const { onCreate } = await renderEditor({ withHandle: false });

    await addButton().click();
    const dialogName = 'カテゴリを追加';
    expect(formDialog(dialogName).getByRole('textbox').elements()).toHaveLength(
      1,
    );
    await nameBox(dialogName).fill('開発支援');
    await formDialog(dialogName)
      .getByRole('button', { name: '追加', exact: true })
      .click();

    expect(onCreate).toHaveBeenCalledExactlyOnceWith({ name: '開発支援' });
  });

  test('名前の編集では、今の値を入力済みで開き、カテゴリのIDと保存した値を渡す', async () => {
    const { onUpdate } = await renderEditor();

    await rowButton('開発ツール', '編集').click();
    const dialogName = 'カテゴリ「開発ツール」を編集';
    await expect.element(nameBox(dialogName)).toHaveValue('開発ツール');
    await expect
      .element(
        formDialog(dialogName).getByRole('textbox', {
          name: 'ハンドル',
          exact: true,
        }),
      )
      .toHaveValue('developer-tools');
    await nameBox(dialogName).fill('開発者ツール');
    await formDialog(dialogName)
      .getByRole('button', { name: '保存', exact: true })
      .click();

    expect(onUpdate).toHaveBeenCalledExactlyOnceWith('c1', {
      name: '開発者ツール',
      handle: 'developer-tools',
    });
    await expect.element(formDialog(dialogName)).not.toBeInTheDocument();
    await expect.element(rowButton('開発ツール', '編集')).toHaveFocus();
  });

  test.each([
    ['空', '', 'カテゴリ名を入力してください。'],
    ['31文字', 'あ'.repeat(31), 'カテゴリ名は30文字以内で入力してください。'],
  ])(
    '名前の編集で%sにすると、フォーカスを外した時点でエラーを示し、保存できない',
    async (_, value, message) => {
      const { onUpdate } = await renderEditor();
      await rowButton('デザイン', '編集').click();
      const dialogName = 'カテゴリ「デザイン」を編集';

      await nameBox(dialogName).fill(value);
      await userEvent.tab();

      await expect
        .element(formDialog(dialogName).getByText(message))
        .toBeVisible();
      await expect
        .element(
          formDialog(dialogName).getByRole('button', {
            name: '保存',
            exact: true,
          }),
        )
        .toHaveAttribute('disabled');
      expect(onUpdate).not.toHaveBeenCalled();
    },
  );

  test('保存が拒否されると、編集のダイアログを開いたまま呼び出す側が選んだ文言を示す', async () => {
    const error = new GraphQLClientError({
      code: 'category_protected',
      message: 'システム標準のカテゴリは変更できません。',
      status: 422,
    });
    const failureMessageOf = vi.fn(() => FAILURE_MESSAGE);
    await renderEditor(
      {},
      mocks({
        onUpdate: vi.fn<OnUpdate>(() => Promise.reject(error)),
        failureMessageOf,
      }),
    );

    await rowButton('その他', '編集').click();
    const dialogName = 'カテゴリ「その他」を編集';
    await nameBox(dialogName).fill('そのほか');
    await formDialog(dialogName)
      .getByRole('button', { name: '保存', exact: true })
      .click();

    await expect
      .element(formDialog(dialogName).getByRole('alert'))
      .toHaveTextContent(FAILURE_MESSAGE);
    expect(failureMessageOf).toHaveBeenCalledExactlyOnceWith(error);
    await expect.element(nameBox(dialogName)).toHaveValue('そのほか');
  });

  test('削除は確認のダイアログで確定してから呼び出す側へIDを渡し、閉じた後に見出しへフォーカスを移す', async () => {
    const { onDelete } = await renderEditor();

    await rowButton('開発ツール', '削除').click();
    await expect.element(deleteDialog('開発ツール')).toBeVisible();
    await expect
      .element(deleteDialog('開発ツール'))
      .toHaveAccessibleDescription('削除したカテゴリは元に戻せません。');
    expect(onDelete).not.toHaveBeenCalled();
    await deleteDialog('開発ツール')
      .getByRole('button', { name: '削除', exact: true })
      .click();

    expect(onDelete).toHaveBeenCalledExactlyOnceWith('c1');
    await expect.element(deleteDialog('開発ツール')).not.toBeInTheDocument();
    await expect.element(heading()).toHaveFocus();
  });

  test('削除の確認を取り消すと、削除せずに閉じる', async () => {
    const { onDelete } = await renderEditor();

    await rowButton('デザイン', '削除').click();
    await deleteDialog('デザイン')
      .getByRole('button', { name: 'キャンセル', exact: true })
      .click();

    await expect.element(deleteDialog('デザイン')).not.toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
  });

  test.each([
    [
      'キャンセル',
      async () => {
        await deleteDialog('デザイン')
          .getByRole('button', { name: 'キャンセル', exact: true })
          .click();
      },
    ],
    [
      'Escape',
      async () => {
        await userEvent.keyboard('{Escape}');
      },
    ],
    [
      '右上の「閉じる」',
      async () => {
        await deleteDialog('デザイン')
          .getByRole('button', { name: '閉じる', exact: true })
          .click();
      },
    ],
  ])(
    '削除の確認を%sで取り消すと、開いた元の行の削除ボタンへフォーカスを戻す',
    async (_, cancel) => {
      await renderEditor();
      await rowButton('デザイン', '削除').click();
      await expect.element(deleteDialog('デザイン')).toBeVisible();

      await cancel();

      await expect.element(deleteDialog('デザイン')).not.toBeInTheDocument();
      await expect.element(rowButton('デザイン', '削除')).toHaveFocus();
    },
  );

  test('削除が拒否された後に取り消すと、開いた元の行の削除ボタンへフォーカスを戻す', async () => {
    await renderEditor(
      {},
      mocks({
        onDelete: vi.fn<OnDelete>(() => Promise.reject(new Error('in use'))),
      }),
    );
    await rowButton('デザイン', '削除').click();
    await deleteDialog('デザイン')
      .getByRole('button', { name: '削除', exact: true })
      .click();
    await expect
      .element(deleteDialog('デザイン').getByRole('alert'))
      .toBeVisible();

    await deleteDialog('デザイン')
      .getByRole('button', { name: 'キャンセル', exact: true })
      .click();

    await expect.element(deleteDialog('デザイン')).not.toBeInTheDocument();
    await expect.element(rowButton('デザイン', '削除')).toHaveFocus();
  });

  test('編集を閉じた直後に別の行の編集を開くと、その行の値で始める', async () => {
    await renderEditor();
    await rowButton('開発ツール', '編集').click();
    await expect
      .element(nameBox('カテゴリ「開発ツール」を編集'))
      .toHaveValue('開発ツール');

    await userEvent.keyboard('{Escape}');
    // 閉じる動きの間は背景が支援技術から隠れて役割で引けないため、行のボタンを文言で探して押す
    Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent.includes('「デザイン」を編集'))
      ?.click();

    const dialogName = 'カテゴリ「デザイン」を編集';
    await expect.element(formDialog(dialogName)).toBeVisible();
    await expect.element(nameBox(dialogName)).toHaveValue('デザイン');
  });

  test('削除が拒否されると、確認のダイアログを開いたまま呼び出す側が選んだ文言を示す', async () => {
    const error = new GraphQLClientError({
      code: 'category_in_use',
      message: FAILURE_MESSAGE,
      status: 409,
    });
    const failureMessageOf = vi.fn(() => FAILURE_MESSAGE);
    await renderEditor(
      {},
      mocks({
        onDelete: vi.fn<OnDelete>(() => Promise.reject(error)),
        failureMessageOf,
      }),
    );

    await rowButton('開発ツール', '削除').click();
    await deleteDialog('開発ツール')
      .getByRole('button', { name: '削除', exact: true })
      .click();

    await expect
      .element(deleteDialog('開発ツール').getByRole('alert'))
      .toHaveTextContent(FAILURE_MESSAGE);
    expect(failureMessageOf).toHaveBeenCalledExactlyOnceWith(error);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('システム標準のカテゴリとハンドルの列を持つ一覧で、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      await renderEditor();
      await expect.element(table()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });

    test('権限が無く操作を無効にした一覧で、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      await renderEditor({ canEdit: false });
      await expect.element(table()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });

    test('削除の失敗を示した確認のダイアログで、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      await renderEditor(
        {},
        mocks({
          onDelete: vi.fn<OnDelete>(() => Promise.reject(new Error('network'))),
        }),
      );
      await rowButton('開発ツール', '削除').click();
      await deleteDialog('開発ツール')
        .getByRole('button', { name: '削除', exact: true })
        .click();
      await expect
        .element(deleteDialog('開発ツール').getByRole('alert'))
        .toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
