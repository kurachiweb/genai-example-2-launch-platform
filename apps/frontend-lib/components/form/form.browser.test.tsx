import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { useState } from 'react';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../../test/computed-style.ts';
import {
  errorMessageOf,
  type FieldErrorDetail,
  GraphQLClientError,
} from '../../utilities/graphql/graphql-result.ts';
import { z } from '../../utilities/validation/zod.ts';
import { Input } from '../ui/input/input.tsx';
import { AppForm, type SubmitErrorContext } from './app-form.tsx';
import { FormField } from './form-field.tsx';
import { FormMessage } from './form-message.tsx';
import { SubmitButton } from './submit-button.tsx';
import { useAppForm } from './use-app-form.ts';

const TITLE_REQUIRED = 'プロダクト名を入力してください。';
const TITLE_TOO_LONG = 'プロダクト名は40文字以内で入力してください。';
const URL_INVALID =
  '外部WebサイトURLは"https://"または"http://"から始まるURLを入力してください。';
const TITLE_DESCRIPTION = 'ディレクトリとプロダクトのページに表示されます。';
const TITLE_DUPLICATED = 'このプロダクト名は既に使われています。';
const DEFAULT_INVALID_MESSAGE = '入力内容を確認してください。';

const productSchema = z.object({
  title: z.string().trim().min(1, TITLE_REQUIRED).max(40, TITLE_TOO_LONG),
  url: z.string().regex(/^https?:\/\/\S+$/, URL_INVALID),
});

type ProductInput = z.input<typeof productSchema>;

interface ProductFormProps {
  readonly onSubmit?: (values: ProductInput) => Promise<void> | void;
  readonly submitDisabled?: boolean;
  readonly onSubmitError?: (
    error: unknown,
    context: SubmitErrorContext,
  ) => void;
}

function ProductForm({
  onSubmit = () => undefined,
  onSubmitError = () => undefined,
  submitDisabled,
}: ProductFormProps) {
  const form = useAppForm(productSchema, {
    defaultValues: { title: '', url: '' },
  });
  return (
    <AppForm
      form={form}
      onSubmit={onSubmit}
      onSubmitError={onSubmitError}
      serverFieldPrefix="input"
      aria-label="プロダクトの登録"
      className="flex flex-col gap-4 p-4"
    >
      <FormField
        control={form.control}
        name="title"
        label="プロダクト名"
        description={TITLE_DESCRIPTION}
      >
        {(control) => <Input {...control} />}
      </FormField>
      <FormField control={form.control} name="url" label="外部WebサイトURL">
        {(control) => <Input type="url" {...control} />}
      </FormField>
      <SubmitButton disabled={submitDisabled}>登録する</SubmitButton>
    </AppForm>
  );
}

interface ProductFormWithSubmitErrorProps {
  readonly contactAvailable: boolean;
  readonly onSubmit: (values: ProductInput) => Promise<void> | void;
}

// 欄に対応しない失敗を、アプリのプロファイルの問い合わせの導線の有無で選んだ文言でフォームの近くに出す利用例
function ProductFormWithSubmitError({
  contactAvailable,
  onSubmit,
}: ProductFormWithSubmitErrorProps) {
  const [submitError, setSubmitError] = useState<string>();
  return (
    <div className="flex flex-col gap-4">
      {submitError === undefined ? null : (
        <FormMessage role="alert">{submitError}</FormMessage>
      )}
      <ProductForm
        onSubmit={onSubmit}
        onSubmitError={(error) => {
          setSubmitError(errorMessageOf(error, contactAvailable));
        }}
      />
    </div>
  );
}

const ROOT_SUBMIT_ERROR = '送信できませんでした。';

// 利用側が欄に対応しない失敗をフォームのrootのエラーとして持つ利用例
function ProductFormWithRootError() {
  const form = useAppForm(productSchema, {
    defaultValues: { title: '', url: '' },
  });
  const rootError = form.formState.errors.root?.['submit']?.message;
  return (
    <AppForm
      form={form}
      onSubmit={() => {
        throw new Error('想定外の失敗');
      }}
      onSubmitError={() => {
        form.setError('root.submit', {
          type: 'server',
          message: ROOT_SUBMIT_ERROR,
        });
      }}
      aria-label="プロダクトの登録"
    >
      {rootError === undefined ? null : (
        <FormMessage role="alert">{rootError}</FormMessage>
      )}
      <FormField control={form.control} name="title" label="プロダクト名">
        {(control) => <Input {...control} />}
      </FormField>
      <FormField control={form.control} name="url" label="外部WebサイトURL">
        {(control) => <Input type="url" {...control} />}
      </FormField>
      <SubmitButton>登録する</SubmitButton>
    </AppForm>
  );
}

const contactSchema = z.object({ email: z.email() });

function ContactForm() {
  const form = useAppForm(contactSchema, { defaultValues: { email: '' } });
  return (
    <AppForm
      form={form}
      onSubmit={() => undefined}
      onSubmitError={() => undefined}
      aria-label="連絡先"
    >
      <FormField control={form.control} name="email" label="メールアドレス">
        {(control) => <Input type="email" {...control} />}
      </FormField>
      <SubmitButton>保存する</SubmitButton>
    </AppForm>
  );
}

const contactMethodSchema = z.object({
  contact: z.object({ type: z.string(), address: z.string() }),
});

// 欄をまとめた値の子の欄に、欄のエラーの末端の判定に使う名前を使う誤った利用例
function ContactMethodForm() {
  const form = useAppForm(contactMethodSchema, {
    defaultValues: { contact: { type: '', address: '' } },
  });
  return (
    <AppForm
      form={form}
      onSubmit={() => undefined}
      onSubmitError={() => undefined}
      aria-label="連絡方法"
    >
      <FormField control={form.control} name="contact.type" label="種類">
        {(control) => <Input {...control} />}
      </FormField>
      <SubmitButton>保存する</SubmitButton>
    </AppForm>
  );
}

const titleInput = () => page.getByRole('textbox', { name: 'プロダクト名' });
const urlInput = () => page.getByRole('textbox', { name: '外部WebサイトURL' });
const submitButton = (name = '登録する') =>
  page.getByRole('button', { name, exact: true });
const productForm = () => page.getByRole('form', { name: 'プロダクトの登録' });

async function fillValidProduct(): Promise<void> {
  await userEvent.fill(titleInput(), 'Pitch Notes');
  await userEvent.fill(urlInput(), 'https://pitch-notes.example');
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function validationError(
  details: readonly FieldErrorDetail[],
): GraphQLClientError {
  return new GraphQLClientError({
    code: 'validation_error',
    message: '入力内容に誤りがあります。',
    status: 400,
    details,
  });
}

function describedTextsOf(element: Element): readonly string[] {
  return (element.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter((id) => id !== '')
    .map((id) => document.getElementById(id)?.textContent ?? '');
}

afterEach(() => {
  applyColorScheme('light');
});

describe('フォーム部品', () => {
  test('最初にフォーカスを外すまではエラーを表示せず、外した時に欄の近くへ表示する', async () => {
    await render(<ProductForm />);

    await userEvent.click(titleInput());
    await userEvent.keyboard('P'.repeat(41));

    await expect
      .element(page.getByText(TITLE_TOO_LONG))
      .not.toBeInTheDocument();

    await userEvent.tab();

    await expect.element(page.getByText(TITLE_TOO_LONG)).toBeVisible();
  });

  test('フォーカスを外してエラーを表示した後は、入力のたびに検証し直す', async () => {
    await render(<ProductForm />);
    await userEvent.click(titleInput());
    await userEvent.tab();
    await expect.element(page.getByText(TITLE_REQUIRED)).toBeVisible();

    await userEvent.click(titleInput());
    await userEvent.keyboard('P');

    await expect
      .element(page.getByText(TITLE_REQUIRED))
      .not.toBeInTheDocument();

    await userEvent.keyboard('{Backspace}');

    await expect.element(page.getByText(TITLE_REQUIRED)).toBeVisible();
    await expect.element(titleInput()).toHaveFocus();
  });

  test('ラベルと説明を入力欄に関連付け、エラーは文言とアイコンで示して説明とともに関連付ける', async () => {
    await render(<ProductForm />);

    await expect
      .element(titleInput())
      .toHaveAccessibleDescription(TITLE_DESCRIPTION);
    await expect.element(titleInput()).not.toHaveAttribute('aria-invalid');

    await userEvent.click(titleInput());
    await userEvent.tab();

    await expect.element(titleInput()).toHaveAttribute('aria-invalid', 'true');
    await expect
      .element(titleInput())
      .toHaveAccessibleDescription(`${TITLE_DESCRIPTION} ${TITLE_REQUIRED}`);
    const message = page.getByText(TITLE_REQUIRED).element();
    const icon = message
      .closest('[data-slot="form-message"]')
      ?.querySelector('svg');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
  });

  test('エラーの文言は「です・ます」調で末尾に「。」を付ける', async () => {
    await render(<ProductForm />);

    await userEvent.click(titleInput());
    await userEvent.tab();
    await userEvent.fill(urlInput(), 'ftp://pitch-notes.example');
    await userEvent.tab();

    await expect.element(page.getByText(URL_INVALID)).toBeVisible();
    const messages = [titleInput(), urlInput()].flatMap((input) =>
      describedTextsOf(input.element()).filter(
        (text) => text !== TITLE_DESCRIPTION,
      ),
    );
    expect(messages).toStrictEqual([TITLE_REQUIRED, URL_INVALID]);
    for (const text of messages) {
      expect(text).toMatch(/(?:です|ます|ください|ません)。$/u);
    }
  });

  test('検証規則に文言が無いエラーは、文言規則に沿った既定の文言で示す', async () => {
    await render(<ContactForm />);
    const email = page.getByRole('textbox', { name: 'メールアドレス' });

    await userEvent.fill(email, 'not-an-email');
    await userEvent.tab();

    await expect
      .element(email)
      .toHaveAccessibleDescription(DEFAULT_INVALID_MESSAGE);
  });

  test('未入力の必須項目または検証エラーが残っている間は、送信ボタンを無効にする', async () => {
    await render(<ProductForm />);

    await expect.element(submitButton()).toBeDisabled();

    await userEvent.fill(titleInput(), 'Pitch Notes');

    await expect.element(submitButton()).toBeDisabled();

    await userEvent.fill(urlInput(), 'https://pitch-notes.example');

    await expect.element(submitButton()).toBeEnabled();

    await userEvent.fill(urlInput(), 'pitch-notes.example');

    await expect.element(submitButton()).toBeDisabled();
  });

  test('送信ボタンにdisabledを渡すと他の条件によらず無効にし、外すと入力の状態による判定に戻す', async () => {
    const screen = await render(<ProductForm submitDisabled />);
    await fillValidProduct();

    await expect.element(submitButton()).toBeDisabled();

    await screen.rerender(<ProductForm />);

    await expect.element(submitButton()).toBeEnabled();

    await userEvent.fill(urlInput(), 'pitch-notes.example');

    await expect.element(submitButton()).toBeDisabled();
  });

  test('送信の処理中は送信ボタンを操作できないことと送信中であることを示し、終わると元に戻す', async () => {
    const pending = deferred();
    const onSubmit = vi.fn(() => pending.promise);
    await render(<ProductForm onSubmit={onSubmit} />);
    await fillValidProduct();

    await userEvent.click(submitButton());

    await expect
      .element(submitButton('送信中'))
      .toHaveAttribute('aria-disabled', 'true');
    await expect
      .element(submitButton('送信中'))
      .toHaveAttribute('aria-busy', 'true');
    await expect
      .poll(() => getComputedStyle(submitButton('送信中').element()).opacity)
      .toBe('0.5');
    expect(onSubmit).toHaveBeenCalledWith({
      title: 'Pitch Notes',
      url: 'https://pitch-notes.example',
    });

    pending.resolve();

    await expect.element(submitButton()).toBeEnabled();
    await expect.element(submitButton()).not.toHaveAttribute('aria-disabled');
    await expect.element(submitButton()).not.toHaveAttribute('aria-busy');
  });

  test.each([
    { outcome: '成功', failure: undefined },
    { outcome: '失敗', failure: new Error('想定外の失敗') },
  ])(
    'ボタンにフォーカスしてEnterで送信すると、送信中も送信の$outcome後もフォーカスがボタンに残る',
    async ({ failure }) => {
      const pending = deferred();
      const onSubmitError = vi.fn();
      await render(
        <ProductForm
          onSubmit={async () => {
            await pending.promise;
            if (failure !== undefined) {
              throw failure;
            }
          }}
          onSubmitError={onSubmitError}
        />,
      );
      await fillValidProduct();
      await userEvent.click(urlInput());
      await userEvent.tab();
      await expect.element(submitButton()).toHaveFocus();

      await userEvent.keyboard('{Enter}');

      await expect.element(submitButton('送信中')).toHaveFocus();

      pending.resolve();

      await expect.element(submitButton()).toBeEnabled();
      await expect.element(submitButton()).toHaveFocus();
      expect(onSubmitError).toHaveBeenCalledTimes(
        failure === undefined ? 0 : 1,
      );
    },
  );

  test('送信の処理中に重ねて送信しても、送信の処理を1回だけ呼ぶ', async () => {
    const pending = deferred();
    const onSubmit = vi.fn(() => pending.promise);
    await render(<ProductForm onSubmit={onSubmit} />);
    await fillValidProduct();
    const form = productForm().element();
    if (!(form instanceof HTMLFormElement)) {
      throw new TypeError('フォームの要素が見つかりません。');
    }

    form.requestSubmit();
    form.requestSubmit();
    await userEvent.click(urlInput());
    await userEvent.keyboard('{Enter}');
    await userEvent.tab();
    await expect.element(submitButton('送信中')).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');

    await expect
      .element(submitButton('送信中'))
      .toHaveAttribute('aria-disabled', 'true');
    expect(onSubmit).toHaveBeenCalledTimes(1);

    pending.resolve();
    await expect.element(submitButton()).toBeEnabled();
    form.requestSubmit();

    await expect.poll(() => onSubmit).toHaveBeenCalledTimes(2);
  });

  test('送信の失敗を受け取る処理が例外を投げても、未処理の拒否にせずエラーの報告へ渡し、再び送信できる', async () => {
    const reportError = vi
      .spyOn(globalThis, 'reportError')
      .mockImplementation(() => undefined);
    const handlerFailure = new Error('失敗の処理での想定外の失敗');
    await render(
      <ProductForm
        onSubmit={() => {
          throw new Error('想定外の失敗');
        }}
        onSubmitError={() => {
          throw handlerFailure;
        }}
      />,
    );
    await fillValidProduct();

    await userEvent.click(submitButton());

    await expect.poll(() => reportError).toHaveBeenCalledWith(handlerFailure);
    await expect.element(submitButton()).toBeEnabled();
    reportError.mockRestore();
  });

  test('サーバーが返した項目ごとの詳細を欄のエラーとして表示し、最初のエラーの欄へフォーカスを移す', async () => {
    const onSubmitError = vi.fn();
    await render(
      <ProductForm
        onSubmit={() => {
          throw validationError([
            { field: 'input.url', code: 'unreachable', message: URL_INVALID },
            {
              field: 'input.title',
              code: 'duplicated',
              message: TITLE_DUPLICATED,
            },
          ]);
        }}
        onSubmitError={onSubmitError}
      />,
    );
    await fillValidProduct();

    await userEvent.click(submitButton());

    await expect.element(urlInput()).toHaveFocus();
    await expect.element(urlInput()).toHaveAccessibleDescription(URL_INVALID);
    await expect.element(urlInput()).toHaveAttribute('aria-invalid', 'true');
    await expect
      .element(titleInput())
      .toHaveAccessibleDescription(`${TITLE_DESCRIPTION} ${TITLE_DUPLICATED}`);
    expect(onSubmitError).not.toHaveBeenCalled();

    await userEvent.fill(titleInput(), 'Pitch Notes 2');

    await expect
      .element(page.getByText(TITLE_DUPLICATED))
      .not.toBeInTheDocument();
  });

  test('サーバーが返した欄のエラーが1つでも残る間は送信ボタンを無効にし、直した欄のエラーだけを消す', async () => {
    const URL_UNREACHABLE = '外部WebサイトURLに接続できませんでした。';
    await render(
      <ProductForm
        onSubmit={() => {
          throw validationError([
            {
              field: 'input.title',
              code: 'duplicated',
              message: TITLE_DUPLICATED,
            },
            {
              field: 'input.url',
              code: 'unreachable',
              message: URL_UNREACHABLE,
            },
          ]);
        }}
      />,
    );
    await fillValidProduct();
    await userEvent.click(submitButton());
    await expect.element(page.getByText(TITLE_DUPLICATED)).toBeVisible();
    await expect.element(page.getByText(URL_UNREACHABLE)).toBeVisible();
    await expect.element(submitButton()).toBeDisabled();

    await userEvent.fill(titleInput(), 'Pitch Notes 2');

    await expect
      .element(page.getByText(TITLE_DUPLICATED))
      .not.toBeInTheDocument();
    await expect
      .element(urlInput())
      .toHaveAccessibleDescription(URL_UNREACHABLE);
    await expect.element(submitButton()).toBeDisabled();

    await userEvent.fill(urlInput(), 'https://pitch-notes.example/about');

    await expect
      .element(page.getByText(URL_UNREACHABLE))
      .not.toBeInTheDocument();
    await expect.element(submitButton()).toBeEnabled();
  });

  test('利用側がrootに付けたエラーだけが残る間は、欄の検証が通れば送信ボタンを有効にする', async () => {
    await render(<ProductFormWithRootError />);
    await fillValidProduct();
    await userEvent.click(submitButton());
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(ROOT_SUBMIT_ERROR);

    await userEvent.fill(titleInput(), 'Pitch Notes 2');

    await expect.element(submitButton()).toBeEnabled();
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(ROOT_SUBMIT_ERROR);
  });

  test('欄に対応しない詳細や詳細の無い失敗は、欄に対応しない詳細とともに送信の失敗として渡す', async () => {
    const unknownDetail = {
      field: 'input.category',
      code: 'invalid',
      message: 'カテゴリを選んでください。',
    };
    const failures: readonly unknown[] = [
      validationError([unknownDetail]),
      new Error('想定外の失敗'),
    ];
    let attempt = 0;
    const onSubmitError = vi.fn();
    await render(
      <ProductForm
        onSubmit={() => {
          const failure = failures[attempt];
          attempt += 1;
          throw failure;
        }}
        onSubmitError={onSubmitError}
      />,
    );
    await fillValidProduct();

    await userEvent.click(submitButton());

    await expect.poll(() => onSubmitError).toHaveBeenCalledTimes(1);
    expect(onSubmitError).toHaveBeenLastCalledWith(failures[0], {
      unmatched: [{ ...unknownDetail, field: 'category' }],
    });
    await expect.element(submitButton()).toBeEnabled();

    await userEvent.click(submitButton());

    await expect.poll(() => onSubmitError).toHaveBeenCalledTimes(2);
    expect(onSubmitError).toHaveBeenLastCalledWith(failures[1], {
      unmatched: [],
    });
  });

  test('既定値の入れ子のキーに欄のエラーの末端と見分けられない名前があると、開発時とテストではフォームを作る時に経路を示す例外を投げる', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await expect(render(<ContactMethodForm />)).rejects.toThrow(
      /contact\.type/u,
    );
    await expect
      .element(page.getByRole('form', { name: '連絡方法' }))
      .not.toBeInTheDocument();
    consoleError.mockRestore();
  });

  describe('送信の失敗の文言', () => {
    const CONTACT_GUIDANCE = '解決しない場合はお問い合わせください。';
    const UNEXPECTED_FAILURE = new Error('Cannot read properties of undefined');

    test('問い合わせの導線が無い側では、想定外の例外に代えて問い合わせを促さない文言を出し、例外の文言を出さない', async () => {
      await render(
        <ProductFormWithSubmitError
          contactAvailable={false}
          onSubmit={() => {
            throw UNEXPECTED_FAILURE;
          }}
        />,
      );
      await fillValidProduct();

      await userEvent.click(submitButton());

      const alert = page.getByRole('alert');
      await expect
        .element(alert)
        .toHaveTextContent(
          'ページを表示できませんでした。時間をおいて再度お試しください。',
        );
      expect(alert.element().textContent).not.toContain(CONTACT_GUIDANCE);
      expect(alert.element().textContent).not.toContain(
        UNEXPECTED_FAILURE.message,
      );
    });

    test('問い合わせの導線がある側では、想定外の例外に代えて問い合わせを案内する文言を出す', async () => {
      await render(
        <ProductFormWithSubmitError
          contactAvailable
          onSubmit={() => {
            throw UNEXPECTED_FAILURE;
          }}
        />,
      );
      await fillValidProduct();

      await userEvent.click(submitButton());

      await expect
        .element(page.getByRole('alert'))
        .toHaveTextContent(
          'ページを表示できませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。',
        );
    });

    test('GraphQLの失敗は、問い合わせの導線の有無によらずその文言を出す', async () => {
      const failure = new GraphQLClientError({
        code: 'internal_error',
        message: '問題が発生しました。時間をおいて再度お試しください。',
        status: 500,
      });
      await render(
        <ProductFormWithSubmitError
          contactAvailable={false}
          onSubmit={() => {
            throw failure;
          }}
        />,
      );
      await fillValidProduct();

      await userEvent.click(submitButton());

      await expect
        .element(page.getByRole('alert'))
        .toHaveTextContent(failure.message);
    });
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('説明とエラーを表示した状態で、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await render(<ProductForm />);
      await userEvent.click(titleInput());
      await userEvent.tab();
      await userEvent.fill(urlInput(), 'pitch-notes.example');
      await userEvent.tab();
      await expect.element(page.getByText(URL_INVALID)).toBeVisible();

      expect(await runAxe(container)).toStrictEqual([]);
    });
  });
});
