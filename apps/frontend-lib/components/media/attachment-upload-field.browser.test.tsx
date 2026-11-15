import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import type { UploadedFile } from '../../../common-lib/media/upload-protocol.ts';
import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../../test/computed-style.ts';
import {
  errorReply,
  stubUploadFetch,
  uploadedFileOf,
  uploadedReply,
} from '../../test/fake-upload-fetch.ts';
import { createDocumentFile, createImageFile } from '../../test/media-files.ts';
import type { UploadConstraints } from '../../utilities/media/upload-constraints.ts';
import { z } from '../../utilities/validation/zod.ts';
import { AppForm } from '../form/app-form.tsx';
import { FormField } from '../form/form-field.tsx';
import { SubmitButton } from '../form/submit-button.tsx';
import { useAppForm } from '../form/use-app-form.ts';
import {
  AttachmentUploadField,
  type AttachmentUploadFieldProps,
} from './attachment-upload-field.tsx';

vi.mock('../../start/observability/browser-error-reporting.ts', { spy: true });

const LABEL = 'ファイルを選択';

const KILOBYTE = 1024;

const ATTACHMENTS: UploadConstraints = {
  purpose: 'inquiry-attachment',
  allowedTypes: ['image/png', 'application/pdf', 'text/plain'],
  maxBytes: 10 * KILOBYTE,
  subjectLabel: '添付ファイル',
  maxCount: 3,
  maxTotalBytes: 16 * KILOBYTE,
};

const UNEXPECTED_WITHOUT_CONTACT =
  'ページを表示できませんでした。時間をおいて再度お試しください。';

type UploadedMock = ReturnType<
  typeof vi.fn<(files: readonly UploadedFile[]) => void>
>;

const selectButton = () =>
  page.getByRole('button', { name: LABEL, exact: true });
const retryButton = () =>
  page.getByRole('button', { name: '再試行', exact: true });
const listItems = () =>
  page.getByRole('list', { name: '選択したファイル' }).getByRole('listitem');

async function renderField(
  props: Partial<AttachmentUploadFieldProps> = {},
): Promise<{
  readonly container: HTMLElement;
  readonly onUploaded: UploadedMock;
}> {
  const onUploaded: UploadedMock = vi.fn();
  const { container } = await render(
    <div className="bg-background p-4 text-foreground">
      <AttachmentUploadField
        label={LABEL}
        constraints={ATTACHMENTS}
        multiple
        contactAvailable
        onUploaded={onUploaded}
        {...props}
      />
    </div>,
  );
  return { container, onUploaded };
}

// 選択の画面を経たファイルはブラウザが作り直した別のオブジェクトになるため、名前・形式・内容で同じファイルかを確かめる
async function expectSameFile(actual: Blob | undefined, expected: File) {
  expect(actual).toBeInstanceOf(File);
  expect(actual instanceof File ? actual.name : undefined).toBe(expected.name);
  expect(actual?.type).toBe(expected.type);
  expect(await actual?.text()).toBe(await expected.text());
}

function fileInputOf(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) {
    throw new Error('ファイルの入力欄が描画されていません。');
  }
  return input;
}

afterEach(() => {
  vi.unstubAllGlobals();
  applyColorScheme('light');
});

describe('AttachmentUploadField', () => {
  test('画像を含め、編集ダイアログを経ずに選んだファイルを1件ずつ順にそのまま送る', async () => {
    const fetch = stubUploadFetch();
    const image = await createImageFile('screen.png', 'image/png', {
      width: 32,
      height: 32,
    });
    const pdf = createDocumentFile('guide.pdf', 'application/pdf', KILOBYTE);
    const { container, onUploaded } = await renderField();

    await userEvent.upload(fileInputOf(container), [image, pdf]);

    await expect.poll(() => fetch.calls.length).toBe(1);
    expect(page.getByRole('dialog').query()).toBeNull();
    await expectSameFile(fetch.calls[0]?.body, image);
    await fetch.reply(uploadedReply(image, 'file-1'));
    await expect.poll(() => fetch.calls.length).toBe(2);
    await expectSameFile(fetch.calls[1]?.body, pdf);
    expect(fetch.calls[1]?.contentType).toBe('application/pdf');
    await fetch.reply(uploadedReply(pdf, 'file-2'));

    await expect
      .poll(() => onUploaded.mock.calls)
      .toEqual([
        [[uploadedFileOf(image, 'file-1'), uploadedFileOf(pdf, 'file-2')]],
      ]);
    await expect
      .element(listItems().nth(1))
      .toHaveTextContent('アップロード済み');
    await expect
      .element(
        page.getByText('screen.png、guide.pdfの2件をアップロードしました。'),
      )
      .toBeInTheDocument();
  });

  test('選んだファイルのサイズ・合計・個数の上限を超えると送らずにエラーを示す', async () => {
    const fetch = stubUploadFetch();
    const { container } = await renderField();

    await userEvent.upload(fileInputOf(container), [
      createDocumentFile('big.pdf', 'application/pdf', 11 * KILOBYTE),
    ]);
    await expect
      .element(
        page.getByText('添付ファイルは10kB以内のファイルを選択してください。'),
      )
      .toBeInTheDocument();

    await userEvent.upload(fileInputOf(container), [
      createDocumentFile('a.pdf', 'application/pdf', 9 * KILOBYTE),
      createDocumentFile('b.txt', 'text/plain', 9 * KILOBYTE),
    ]);
    await expect
      .element(page.getByText('ファイルは合計16kB以内で選択してください。'))
      .toBeInTheDocument();
    await expect
      .element(
        page.getByText('添付ファイルは10kB以内のファイルを選択してください。'),
      )
      .not.toBeInTheDocument();

    await userEvent.upload(
      fileInputOf(container),
      ['a', 'b', 'c', 'd'].map((name) =>
        createDocumentFile(`${name}.txt`, 'text/plain', 1),
      ),
    );
    await expect
      .element(page.getByText('ファイルは3個以内で選択してください。'))
      .toBeInTheDocument();
    expect(fetch.calls).toHaveLength(0);
  });

  test('管理者側の画面では、想定外の応答で問い合わせを促さない', async () => {
    const fetch = stubUploadFetch();
    const { container } = await renderField({ contactAvailable: false });

    await userEvent.upload(fileInputOf(container), [
      createDocumentFile('a.txt', 'text/plain', 1),
    ]);
    await fetch.reply({ status: 502, body: 'Bad Gateway' });

    await expect
      .element(page.getByText(UNEXPECTED_WITHOUT_CONTACT, { exact: true }))
      .toBeInTheDocument();
    expect(container.textContent).not.toContain('お問い合わせください');
  });

  test('通信に失敗すると、同じファイルで再試行できる', async () => {
    const fetch = stubUploadFetch();
    const file = createDocumentFile('a.txt', 'text/plain', 1);
    const { container } = await renderField();

    await userEvent.upload(fileInputOf(container), [file]);
    await fetch.reply({ networkError: true });
    await userEvent.click(retryButton());

    await expect.poll(() => fetch.calls.length).toBe(2);
    await expectSameFile(fetch.calls[1]?.body, file);
    await expect.element(selectButton()).toHaveFocus();
  });

  test('無効の間は選択も再試行もできない', async () => {
    const fetch = stubUploadFetch();
    const onUploaded: UploadedMock = vi.fn();
    const fieldOf = (disabled: boolean) => (
      <AttachmentUploadField
        label={LABEL}
        constraints={ATTACHMENTS}
        contactAvailable
        disabled={disabled}
        onUploaded={onUploaded}
      />
    );
    const { container, rerender } = await render(fieldOf(false));

    await userEvent.upload(fileInputOf(container), [
      createDocumentFile('a.txt', 'text/plain', 1),
    ]);
    await fetch.reply(errorReply(503, 'storage_unavailable'));
    await expect.element(retryButton()).toBeEnabled();
    await rerender(fieldOf(true));

    await expect.element(selectButton()).toBeDisabled();
    await expect.element(retryButton()).toBeDisabled();
  });

  test('フォームの中で複数のファイルの送信が全て終わるまで、送信を止めて欄へ待つ旨を示す', async () => {
    const fetch = stubUploadFetch();
    const onSubmit = vi.fn<(values: { readonly files: string[] }) => void>();
    const schema = z.object({ files: z.array(z.string()) });
    function InquiryForm() {
      const form = useAppForm(schema, { defaultValues: { files: [] } });
      return (
        <AppForm
          form={form}
          onSubmit={onSubmit}
          onSubmitError={() => undefined}
          aria-label="問い合わせ"
        >
          <FormField control={form.control} name="files" label="添付">
            {(control) => (
              <AttachmentUploadField
                ref={control.ref}
                label={LABEL}
                constraints={ATTACHMENTS}
                multiple
                contactAvailable
                onUploaded={(uploaded) => {
                  control.onChange([
                    ...control.value,
                    ...uploaded.map(({ fileId }) => fileId),
                  ]);
                }}
                aria-labelledby={control.labelId}
                aria-describedby={control['aria-describedby']}
                aria-invalid={control['aria-invalid']}
              />
            )}
          </FormField>
          <SubmitButton>送信する</SubmitButton>
        </AppForm>
      );
    }
    const { container } = await render(<InquiryForm />);
    const named = page.getByRole('button', {
      name: `添付 ${LABEL}`,
      exact: true,
    });
    const submit = page.getByRole('button', { name: '送信する', exact: true });
    const message =
      '添付ファイルのアップロードが終わってから、もう一度お試しください。';
    const first = createDocumentFile('a.txt', 'text/plain', 1);
    const second = createDocumentFile('b.txt', 'text/plain', 1);

    await userEvent.upload(fileInputOf(container), [first, second]);
    await fetch.reply(uploadedReply(first, 'file-1'));
    await expect.poll(() => fetch.calls.length).toBe(2);
    await userEvent.click(submit);

    await expect.element(named).toHaveAccessibleDescription(message);
    await expect.element(named).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();

    await fetch.reply(uploadedReply(second, 'file-2'));
    await expect.element(named).not.toHaveAccessibleDescription(message);
    await userEvent.click(submit);

    await expect
      .poll(() => onSubmit.mock.calls)
      .toStrictEqual([[{ files: ['file-1', 'file-2'] }]]);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('待ち・エラー・送信済みのどれでもアクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const fetch = stubUploadFetch();
      const { container } = await renderField();

      expect(await runAxe(container)).toStrictEqual([]);

      await userEvent.upload(fileInputOf(container), [
        createDocumentFile('a.zip', 'application/zip', 1),
      ]);
      await expect
        .element(
          page.getByText('PNG・PDF・テキストのファイルを選択してください。'),
        )
        .toBeInTheDocument();

      expect(await runAxe(container)).toStrictEqual([]);

      const file = createDocumentFile('a.txt', 'text/plain', 1);
      await userEvent.upload(fileInputOf(container), [file]);
      await fetch.reply(uploadedReply(file, 'file-1'));
      await expect
        .element(listItems().nth(0))
        .toHaveTextContent('アップロード済み');

      expect(await runAxe(container)).toStrictEqual([]);
    });
  });
});
