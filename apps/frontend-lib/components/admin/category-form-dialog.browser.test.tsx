import { useState } from 'react';
import { afterEach, describe, expect, type Mock, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../../test/computed-style.ts';
import { GraphQLClientError } from '../../utilities/graphql/graphql-result.ts';
import {
  CategoryFormDialog,
  type CategoryFormDialogProps,
} from './category-form-dialog.tsx';

const OPENER = 'カテゴリを開く';

const TITLE = 'カテゴリを追加';

const SUBMIT_LABEL = '追加';

const FAILURE_MESSAGE = '同じ名前のカテゴリが既にあります。';

const HANDLE_FORMAT_MESSAGE =
  'ハンドルは半角英小文字・数字・ハイフンで入力してください。';

const HANDLE_TAKEN_MESSAGE = 'このハンドルは既に使われています。';

const NAME_REQUIRED_MESSAGE = 'カテゴリ名を入力してください。';

const NAME_TOO_LONG_MESSAGE = 'カテゴリ名は30文字以内で入力してください。';

const NAME_FORBIDDEN_CHARACTER_MESSAGE =
  'カテゴリ名に使用できない文字が含まれています。';

type OnSubmit = CategoryFormDialogProps['onSubmit'];

interface HarnessProps {
  readonly onSubmit: Mock<OnSubmit>;
  readonly withHandle?: boolean;
  readonly initialValues?: CategoryFormDialogProps['initialValues'];
  readonly validateHandle?: CategoryFormDialogProps['validateHandle'];
  readonly failureMessageOf?: Mock<(error: unknown) => string>;
  readonly serverFieldPrefix?: string;
}

function Harness({
  onSubmit,
  withHandle = false,
  initialValues,
  validateHandle,
  failureMessageOf = vi.fn(() => FAILURE_MESSAGE),
  serverFieldPrefix,
}: HarnessProps) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        {OPENER}
      </button>
      <CategoryFormDialog
        open={open}
        onOpenChange={setOpen}
        title={TITLE}
        submitLabel={SUBMIT_LABEL}
        initialValues={initialValues}
        withHandle={withHandle}
        validateHandle={validateHandle}
        onSubmit={onSubmit}
        failureMessageOf={failureMessageOf}
        serverFieldPrefix={serverFieldPrefix}
      />
    </div>
  );
}

const dialog = () => page.getByRole('dialog', { name: TITLE });

const submitButton = () =>
  dialog().getByRole('button', { name: SUBMIT_LABEL, exact: true });

const cancelButton = () =>
  dialog().getByRole('button', { name: 'キャンセル', exact: true });

const closeButton = () =>
  dialog().getByRole('button', { name: '閉じる', exact: true });

const nameBox = () =>
  dialog().getByRole('textbox', { name: 'カテゴリ名(必須)', exact: true });

const handleBox = () =>
  dialog().getByRole('textbox', { name: 'ハンドル', exact: true });

const overlay = () =>
  page.elementLocator(
    document.querySelector('[data-slot="dialog-overlay"]') ?? document.body,
  );

const openDialog = async (): Promise<void> => {
  await page.getByRole('button', { name: OPENER, exact: true }).click();
  await expect.element(dialog()).toBeVisible();
};

const deferred = () => {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const submitMock = (): Mock<OnSubmit> =>
  vi.fn<OnSubmit>(() => Promise.resolve());

const handleFormat = (handle: string): string | undefined =>
  /^[a-z0-9-]+$/u.test(handle) ? undefined : HANDLE_FORMAT_MESSAGE;

afterEach(() => {
  applyColorScheme('light');
});

describe('CategoryFormDialog', () => {
  test('名前が空の間は保存できず、入力すると前後の空白を除いた名前で保存して閉じる', async () => {
    const onSubmit = submitMock();
    await render(<Harness onSubmit={onSubmit} />);
    await openDialog();

    await expect.element(nameBox()).toHaveFocus();
    await expect.element(nameBox()).toHaveValue('');
    await expect.element(nameBox()).toHaveAttribute('aria-required', 'true');
    await expect.element(submitButton()).toHaveAttribute('disabled');
    await nameBox().fill(' 　開発ツール ');
    await submitButton().click();

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ name: '開発ツール' });
    await expect.element(dialog()).not.toBeInTheDocument();
    await expect
      .element(page.getByRole('button', { name: OPENER, exact: true }))
      .toHaveFocus();
  });

  test('ハンドルを持たないカテゴリは、ハンドルの入力欄を描かない', async () => {
    await render(<Harness onSubmit={submitMock()} />);
    await openDialog();

    expect(dialog().getByRole('textbox').elements()).toHaveLength(1);
    expect(
      dialog().getByRole('textbox', { name: 'ハンドル' }).elements(),
    ).toHaveLength(0);
  });

  test.each([
    ['空白だけ', ' 　', NAME_REQUIRED_MESSAGE],
    ['31文字', 'あ'.repeat(31), NAME_TOO_LONG_MESSAGE],
    [
      '使用できない文字を含む',
      '開発\u007f支援',
      NAME_FORBIDDEN_CHARACTER_MESSAGE,
    ],
  ])(
    '名前が%sのとき、フォーカスを外した時点でエラーを示し、保存できない',
    async (_, value, message) => {
      const onSubmit = submitMock();
      await render(<Harness onSubmit={onSubmit} />);
      await openDialog();

      await nameBox().fill(value);
      expect(dialog().getByText(message).elements()).toHaveLength(0);
      await userEvent.tab();

      await expect.element(dialog().getByText(message)).toBeVisible();
      await expect.element(nameBox()).toHaveAttribute('aria-invalid', 'true');
      await expect.element(submitButton()).toHaveAttribute('disabled');
      expect(onSubmit).not.toHaveBeenCalled();
    },
  );

  test('名前は書記素で数え、前後の空白を除いて30文字までは保存できる', async () => {
    const onSubmit = submitMock();
    const name = '👨‍👩‍👧'.repeat(30);
    await render(<Harness onSubmit={onSubmit} />);
    await openDialog();

    await nameBox().fill(` ${name} `);
    await userEvent.tab();

    expect(dialog().getByText(NAME_TOO_LONG_MESSAGE).elements()).toHaveLength(
      0,
    );
    await submitButton().click();
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ name });
  });

  test('編集では、渡した名前とハンドルを入力済みにして開き、保存した値を渡す', async () => {
    const onSubmit = submitMock();
    await render(
      <Harness
        onSubmit={onSubmit}
        withHandle
        validateHandle={handleFormat}
        initialValues={{ name: '開発ツール', handle: 'developer-tools' }}
      />,
    );
    await openDialog();

    await expect.element(nameBox()).toHaveValue('開発ツール');
    await expect.element(handleBox()).toHaveValue('developer-tools');
    await nameBox().fill('開発者ツール');
    await submitButton().click();

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      name: '開発者ツール',
      handle: 'developer-tools',
    });
  });

  test('ハンドルの形式は呼び出す側が渡す検証で、フォーカスを外した時点で示す', async () => {
    const onSubmit = submitMock();
    const validateHandle = vi.fn(handleFormat);
    await render(
      <Harness
        onSubmit={onSubmit}
        withHandle
        validateHandle={validateHandle}
      />,
    );
    await openDialog();
    await nameBox().fill('開発ツール');

    await handleBox().fill('Developer Tools');
    await userEvent.tab();

    await expect
      .element(dialog().getByText(HANDLE_FORMAT_MESSAGE))
      .toBeVisible();
    await expect.element(handleBox()).toHaveAttribute('aria-invalid', 'true');
    await expect.element(submitButton()).toHaveAttribute('disabled');
    expect(validateHandle).toHaveBeenCalledWith('Developer Tools');

    await handleBox().fill(' developer-tools ');
    await userEvent.tab();
    await submitButton().click();

    expect(validateHandle).toHaveBeenLastCalledWith('developer-tools');
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      name: '開発ツール',
      handle: 'developer-tools',
    });
  });

  test('検証を渡さないハンドルの欄は、空のままならハンドルを渡さない', async () => {
    const onSubmit = submitMock();
    await render(<Harness onSubmit={onSubmit} withHandle />);
    await openDialog();

    await nameBox().fill('開発ツール');
    await expect.element(handleBox()).toHaveValue('');
    await submitButton().click();

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ name: '開発ツール' });
  });

  test('保存が拒否されると、ダイアログを開いたまま入力を保ち、呼び出す側が選んだ文言をダイアログの中に示す', async () => {
    const error = new GraphQLClientError({
      code: 'category_name_taken',
      message: FAILURE_MESSAGE,
      status: 409,
    });
    const failureMessageOf = vi.fn(() => FAILURE_MESSAGE);
    await render(
      <Harness
        onSubmit={vi.fn<OnSubmit>(() => Promise.reject(error))}
        failureMessageOf={failureMessageOf}
      />,
    );
    await openDialog();
    await nameBox().fill('開発ツール');

    await submitButton().click();

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent(FAILURE_MESSAGE);
    expect(failureMessageOf).toHaveBeenCalledExactlyOnceWith(error);
    await expect.element(nameBox()).toHaveValue('開発ツール');
    await expect.element(submitButton()).toBeEnabled();
  });

  test('サーバーが名前の欄の違反を返すと、欄のエラーとして示す', async () => {
    const error = new GraphQLClientError({
      code: 'validation_error',
      message: 'validation_error',
      status: 400,
      details: [
        { field: 'name', code: 'name_taken', message: FAILURE_MESSAGE },
      ],
    });
    const failureMessageOf = vi.fn(() => FAILURE_MESSAGE);
    await render(
      <Harness
        onSubmit={vi.fn<OnSubmit>(() => Promise.reject(error))}
        failureMessageOf={failureMessageOf}
      />,
    );
    await openDialog();
    await nameBox().fill('開発ツール');

    await submitButton().click();

    await expect.element(nameBox()).toHaveAttribute('aria-invalid', 'true');
    await expect.element(nameBox()).toHaveFocus();
    await expect.element(dialog().getByText(FAILURE_MESSAGE)).toBeVisible();
    expect(failureMessageOf).not.toHaveBeenCalled();
  });

  test('サーバーの欄の接頭辞を渡すと、接頭辞の下の名前とハンドルの欄の違反を、それぞれの欄のエラーとして示す', async () => {
    const error = new GraphQLClientError({
      code: 'validation_error',
      message: 'validation_error',
      status: 400,
      details: [
        { field: 'input.name', code: 'name_taken', message: FAILURE_MESSAGE },
        {
          field: 'input.handle',
          code: 'handle_taken',
          message: HANDLE_TAKEN_MESSAGE,
        },
      ],
    });
    const failureMessageOf = vi.fn(() => FAILURE_MESSAGE);
    await render(
      <Harness
        onSubmit={vi.fn<OnSubmit>(() => Promise.reject(error))}
        failureMessageOf={failureMessageOf}
        withHandle
        serverFieldPrefix="input"
      />,
    );
    await openDialog();
    await nameBox().fill('開発ツール');
    await handleBox().fill('developer-tools');

    await submitButton().click();

    await expect.element(nameBox()).toHaveAttribute('aria-invalid', 'true');
    await expect.element(handleBox()).toHaveAttribute('aria-invalid', 'true');
    await expect.element(nameBox()).toHaveFocus();
    await expect.element(dialog().getByText(FAILURE_MESSAGE)).toBeVisible();
    await expect
      .element(dialog().getByText(HANDLE_TAKEN_MESSAGE))
      .toBeVisible();
    expect(dialog().getByRole('alert').query()).toBeNull();
    expect(failureMessageOf).not.toHaveBeenCalled();
  });

  test('サーバーの欄の接頭辞を渡さなければ、接頭辞の付いた欄の違反を欄に対応しない失敗としてダイアログの中に示す', async () => {
    const error = new GraphQLClientError({
      code: 'validation_error',
      message: 'validation_error',
      status: 400,
      details: [
        { field: 'input.name', code: 'name_taken', message: FAILURE_MESSAGE },
      ],
    });
    const failureMessageOf = vi.fn(() => FAILURE_MESSAGE);
    await render(
      <Harness
        onSubmit={vi.fn<OnSubmit>(() => Promise.reject(error))}
        failureMessageOf={failureMessageOf}
      />,
    );
    await openDialog();
    await nameBox().fill('開発ツール');

    await submitButton().click();

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent(FAILURE_MESSAGE);
    expect(failureMessageOf).toHaveBeenCalledExactlyOnceWith(error);
    await expect.element(nameBox()).not.toHaveAttribute('aria-invalid', 'true');
  });

  test('保存の処理中は、保存のボタンにフォーカスを保ったまま処理中を示し、右上の「閉じる」を無効にし、取り消し・Escape・ダイアログの外の押下では閉じない', async () => {
    const pending = deferred();
    const onSubmit = vi.fn<OnSubmit>(() => pending.promise);
    await render(<Harness onSubmit={onSubmit} />);
    await openDialog();
    await nameBox().fill('開発ツール');

    await submitButton().click();

    const busyButton = dialog().getByRole('button', { name: '送信中' });
    await expect.element(busyButton).toHaveAttribute('aria-busy', 'true');
    await expect.element(busyButton).toHaveAttribute('aria-disabled', 'true');
    await expect.element(busyButton).toHaveFocus();
    await expect
      .element(cancelButton())
      .toHaveAttribute('aria-disabled', 'true');
    await expect.element(cancelButton()).not.toHaveAttribute('disabled');
    await expect.element(closeButton()).toHaveAttribute('disabled');
    await userEvent.keyboard('{Escape}');
    await cancelButton().click({ force: true });
    await userEvent.click(overlay(), { position: { x: 4, y: 4 } });
    await expect.element(dialog()).toBeVisible();
    expect(document.activeElement).not.toBe(document.body);
    expect(dialog().element().contains(document.activeElement)).toBe(true);

    pending.resolve();

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  test('取り消すと保存せずに閉じ、開き直すと入力を始め直す', async () => {
    const onSubmit = submitMock();
    await render(<Harness onSubmit={onSubmit} />);
    await openDialog();
    await nameBox().fill('入力の途中');

    await cancelButton().click();

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    await openDialog();
    await expect.element(nameBox()).toHaveValue('');
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('名前とハンドルの欄のエラーと保存の失敗を表示したダイアログで、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      await render(
        <Harness
          onSubmit={vi.fn<OnSubmit>(() => Promise.reject(new Error('network')))}
          withHandle
          validateHandle={handleFormat}
        />,
      );
      await openDialog();
      await nameBox().fill('開発ツール');
      await handleBox().fill('developer-tools');
      await submitButton().click();
      await expect.element(dialog().getByRole('alert')).toBeVisible();
      await nameBox().fill('あ'.repeat(31));
      await handleBox().fill('Developer Tools');
      await userEvent.tab();
      await expect
        .element(dialog().getByText(HANDLE_FORMAT_MESSAGE))
        .toBeVisible();
      await expect
        .element(dialog().getByText(NAME_TOO_LONG_MESSAGE))
        .toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
