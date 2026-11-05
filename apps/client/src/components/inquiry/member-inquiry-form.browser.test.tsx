import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { resetTurnstileScriptFailure } from '../../../lib/components/bot-protection/turnstile-script-failure.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import {
  lastTurnstileProps,
  resetFakeTurnstile,
} from '../../../lib/test/fake-turnstile.tsx';
import {
  stubUploadFetch,
  uploadedReply,
} from '../../../lib/test/fake-upload-fetch.ts';
import { createDocumentFile } from '../../../lib/test/media-files.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import { VIEWER_NICKNAME } from '../../../test/viewer-fixtures.ts';
import { ClientSubmitMemberInquiryDocument } from '../../graphql/generated/graphql.ts';
import { MemberInquiryForm } from './member-inquiry-form.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../../../lib/test/fake-turnstile.tsx'),
);

vi.mock('../../../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

const BUG_CATEGORY_ID = '01JC0CATEG0RY0000000000001';

const CATEGORIES = Object.freeze([
  { id: BUG_CATEGORY_ID, name: '不具合の報告' },
  { id: '01JC0000000000000000000000', name: 'その他' },
]);

const INQUIRY_ID = '01JC0INQVRY000000000000001';

const MEGABYTE = 1024 * 1024;

const form = () => page.getByRole('form', { name: 'お問い合わせフォーム' });
const categorySelect = () =>
  page.getByRole('combobox', { name: 'カテゴリ(必須)' });
const bodyInput = () => page.getByRole('textbox', { name: 'メッセージ(必須)' });
const attachmentButton = () =>
  page.getByRole('button', { name: '添付ファイル ファイルを選択' });
const submitButton = () => page.getByRole('button', { name: '送信する' });
const alert = () => form().getByRole('alert');
const attachedList = () => page.getByRole('list', { name: '添付するファイル' });
const attachedItems = () => attachedList().getByRole('listitem');
const removeButton = (fileName: string) =>
  page.getByRole('button', { name: `${fileName}を削除` });

const INVALID_ATTACHMENT_MESSAGE =
  '添付ファイルを確認できませんでした。もう一度選択してください。';

const renderForm = () =>
  renderInRouter(
    <MemberInquiryForm
      categories={CATEGORIES}
      composer={{ nickname: VIEWER_NICKNAME, avatar: null }}
    />,
    { path: '/contact' },
  );

function fileInput(): HTMLInputElement {
  const input = form()
    .element()
    .querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) {
    throw new Error('ファイルの入力欄が描画されていません。');
  }
  return input;
}

async function fillValidInput(): Promise<void> {
  await userEvent.selectOptions(categorySelect(), '不具合の報告');
  await userEvent.fill(bodyInput(), '画面が表示されません。');
}

// 別々の選択で2つのファイルをアップロードし、どちらも添付するファイルの一覧に並べる
async function uploadInTwoSelections(
  upload: ReturnType<typeof stubUploadFetch>,
): Promise<void> {
  const guide = createDocumentFile('guide.pdf', 'application/pdf', 1024);
  const notes = createDocumentFile('notes.txt', 'text/plain', 10);
  await userEvent.upload(fileInput(), [guide]);
  await upload.reply(uploadedReply(guide, 'file-1'));
  await expect.element(attachedItems().nth(0)).toBeInTheDocument();
  await userEvent.upload(fileInput(), [notes]);
  await upload.reply(uploadedReply(notes, 'file-2'));
  await expect.poll(() => attachedItems().elements().length).toBe(2);
}

async function passBotCheckAndSubmit(): Promise<void> {
  await userEvent.click(page.getByRole('button', { name: '判定を成功させる' }));
  await userEvent.click(submitButton());
}

const submitted = () =>
  Promise.resolve({
    ok: true,
    data: { submitMemberInquiry: { id: INQUIRY_ID } },
  });

const rejectWith = (error: GraphQLClientError) =>
  Promise.resolve({ ok: false, error });

const attachmentsInvalid = (field: string, code: string, message: string) =>
  new GraphQLClientError({
    code: 'inquiry_attachments_invalid',
    message,
    status: 400,
    details: [{ field, code, message }],
  });

beforeEach(() => {
  executeGraphQL.mockReset();
  resetFakeTurnstile();
  resetTurnstileScriptFailure();
});

afterEach(() => {
  vi.unstubAllGlobals();
  applyColorScheme('light');
});

describe('MemberInquiryForm', () => {
  test('bot判定はログインの問い合わせの操作名の非表示のウィジェットで行う', async () => {
    await renderForm();

    await expect
      .element(page.getByTestId('fake-turnstile'))
      .toBeInTheDocument();
    expect(lastTurnstileProps().options).toMatchObject({
      action: 'inquiry_member',
      size: 'invisible',
    });
  });

  test('アップロードしたファイルを選び直しの分も足して送り、送信の後にその問い合わせのチャットへ移る', async () => {
    const upload = stubUploadFetch();
    executeGraphQL.mockImplementation(submitted);
    const router = await renderForm();
    const guide = createDocumentFile('guide.pdf', 'application/pdf', 1024);
    const notes = createDocumentFile('notes.txt', 'text/plain', 10);

    await fillValidInput();
    await userEvent.upload(fileInput(), [guide]);
    await upload.reply(uploadedReply(guide, 'file-1'));
    await expect
      .element(page.getByText('guide.pdfをアップロードしました。'))
      .toBeInTheDocument();
    await userEvent.upload(fileInput(), [notes]);
    await upload.reply(uploadedReply(notes, 'file-2'));
    await expect
      .element(page.getByText('notes.txtをアップロードしました。'))
      .toBeInTheDocument();
    await passBotCheckAndSubmit();

    await expect
      .poll(() => router.state.location.pathname)
      .toBe(`/inquiries/${INQUIRY_ID}`);
    expect(upload.calls.map(({ path }) => path)).toEqual([
      expect.stringContaining('inquiry-attachment') as string,
      expect.stringContaining('inquiry-attachment') as string,
    ]);
    expect(executeGraphQL).toHaveBeenCalledExactlyOnceWith(
      ClientSubmitMemberInquiryDocument,
      {
        input: {
          categoryId: BUG_CATEGORY_ID,
          body: '画面が表示されません。',
          fileIds: ['file-1', 'file-2'],
        },
      },
      { turnstileToken: 'turnstile-token-1' },
    );
  });

  test('前の選択でアップロードしたファイルも、名前・形式・サイズと削除の操作を添えて添付するファイルの一覧に示す', async () => {
    const upload = stubUploadFetch();
    await renderForm();

    await uploadInTwoSelections(upload);

    await expect
      .element(attachedItems().nth(0))
      .toHaveTextContent(/guide\.pdf.*PDF・1kB/u);
    await expect
      .element(attachedItems().nth(1))
      .toHaveTextContent(/notes\.txt.*テキスト・0\.1kB/u);
    await expect.element(removeButton('guide.pdf')).toBeVisible();
    await expect.element(removeButton('notes.txt')).toBeVisible();
  });

  test('削除したファイルを送る値から除き、フォーカスを次の項目、最後の項目なら選択のボタンへ移す', async () => {
    const upload = stubUploadFetch();
    executeGraphQL.mockImplementation(submitted);
    await renderForm();

    await fillValidInput();
    await uploadInTwoSelections(upload);
    await userEvent.click(removeButton('guide.pdf'));

    await expect.element(removeButton('notes.txt')).toHaveFocus();
    expect(removeButton('guide.pdf').query()).toBeNull();
    expect(page.getByText('guide.pdf', { exact: true }).query()).toBeNull();
    await passBotCheckAndSubmit();

    await expect.poll(() => executeGraphQL.mock.calls.length).toBe(1);
    expect(executeGraphQL).toHaveBeenCalledWith(
      ClientSubmitMemberInquiryDocument,
      {
        input: {
          categoryId: BUG_CATEGORY_ID,
          body: '画面が表示されません。',
          fileIds: ['file-2'],
        },
      },
      expect.anything(),
    );
  });

  test('最後のファイルを削除すると、フォーカスを選択のボタンへ移す', async () => {
    const upload = stubUploadFetch();
    await renderForm();

    await uploadInTwoSelections(upload);
    await userEvent.click(removeButton('notes.txt'));

    await expect.element(attachmentButton()).toHaveFocus();
    await expect.poll(() => attachedItems().elements().length).toBe(1);
  });

  test('サーバーが確認できないとしたファイルを一覧で示し、そのファイルを削除して送り直すと送信できる', async () => {
    const upload = stubUploadFetch();
    executeGraphQL
      .mockImplementationOnce(() =>
        rejectWith(
          attachmentsInvalid(
            'input.fileIds.0',
            'invalid',
            INVALID_ATTACHMENT_MESSAGE,
          ),
        ),
      )
      .mockImplementationOnce(submitted);
    const router = await renderForm();

    await fillValidInput();
    await uploadInTwoSelections(upload);
    await passBotCheckAndSubmit();

    await expect
      .element(attachedItems().nth(0))
      .toHaveTextContent(
        'このファイルは添付できません。削除してから送信してください。',
      );
    await expect
      .element(attachedItems().nth(1))
      .not.toHaveTextContent('添付できません');
    await userEvent.click(removeButton('guide.pdf'));
    await expect.element(submitButton()).toBeEnabled();
    await userEvent.click(submitButton());

    await expect
      .poll(() => router.state.location.pathname)
      .toBe(`/inquiries/${INQUIRY_ID}`);
    expect(executeGraphQL).toHaveBeenLastCalledWith(
      ClientSubmitMemberInquiryDocument,
      {
        input: {
          categoryId: BUG_CATEGORY_ID,
          body: '画面が表示されません。',
          fileIds: ['file-2'],
        },
      },
      expect.anything(),
    );
  });

  test('選んだファイルの件数が上限を超えると、送らずに文言規則のエラーを示す', async () => {
    const upload = stubUploadFetch();
    await renderForm();

    await userEvent.upload(
      fileInput(),
      Array.from({ length: 21 }, (_, index) =>
        createDocumentFile(`note-${String(index)}.txt`, 'text/plain', 1),
      ),
    );

    await expect
      .element(attachmentButton())
      .toHaveAccessibleDescription(
        expect.stringContaining(
          'ファイルは20個以内で選択してください。',
        ) as string,
      );
    expect(upload.calls).toHaveLength(0);
  });

  test('アップロード済みのファイルと合わせた合計サイズが上限を超えると、送らずに文言規則のエラーを示す', async () => {
    const upload = stubUploadFetch();
    await renderForm();
    const large = createDocumentFile(
      'large.pdf',
      'application/pdf',
      15 * MEGABYTE,
    );

    await userEvent.upload(fileInput(), [large]);
    await upload.reply(uploadedReply(large, 'file-1'));
    await expect
      .element(page.getByText('large.pdfをアップロードしました。'))
      .toBeInTheDocument();
    await userEvent.upload(fileInput(), [
      createDocumentFile('more.pdf', 'application/pdf', 6 * MEGABYTE),
    ]);

    await expect
      .element(attachmentButton())
      .toHaveAccessibleDescription(
        expect.stringContaining(
          'ファイルは合計20MB以内で選択してください。',
        ) as string,
      );
    expect(upload.calls).toHaveLength(1);
  });

  test('添付の想定外の応答は、問い合わせを促す文言で示す', async () => {
    const upload = stubUploadFetch();
    await renderForm();

    await userEvent.upload(fileInput(), [
      createDocumentFile('a.txt', 'text/plain', 1),
    ]);
    await upload.reply({ status: 502, text: 'Bad Gateway' });

    await expect
      .element(attachmentButton())
      .toHaveAccessibleDescription(
        expect.stringContaining(
          'ページを表示できませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。',
        ) as string,
      );
  });

  test.each([
    [
      '件数の超過',
      'input.fileIds',
      'too-many',
      'ファイルは20個以内で選択してください。',
    ],
    [
      '確認できないファイル',
      'input.fileIds.0',
      'invalid',
      '添付ファイルを確認できませんでした。もう一度選択してください。',
    ],
  ])(
    'サーバーが返した添付の%sを、添付の欄のエラーにして欄へフォーカスを移す',
    async (_label, field, code, message) => {
      const upload = stubUploadFetch();
      executeGraphQL.mockImplementation(() =>
        rejectWith(attachmentsInvalid(field, code, message)),
      );
      await renderForm();
      const guide = createDocumentFile('guide.pdf', 'application/pdf', 1024);

      await fillValidInput();
      await userEvent.upload(fileInput(), [guide]);
      await upload.reply(uploadedReply(guide, 'file-1'));
      await expect
        .element(page.getByText('guide.pdfをアップロードしました。'))
        .toBeInTheDocument();
      await passBotCheckAndSubmit();

      await expect
        .element(attachmentButton())
        .toHaveAccessibleDescription(
          expect.stringContaining(message) as string,
        );
      await expect.element(attachmentButton()).toHaveFocus();
      expect(alert().elements()).toHaveLength(0);
    },
  );

  test('サーバーが返したカテゴリと本文の詳細を欄のエラーにする', async () => {
    executeGraphQL.mockImplementation(() =>
      rejectWith(
        new GraphQLClientError({
          code: 'validation_error',
          message: '入力内容を確認してください。',
          status: 400,
          details: [
            {
              field: 'input.categoryId',
              code: 'not-found',
              message: 'カテゴリを選択してください。',
            },
            {
              field: 'input.body',
              code: 'forbidden-character',
              message: 'メッセージに使用できない文字が含まれています。',
            },
          ],
        }),
      ),
    );
    await renderForm();

    await fillValidInput();
    await passBotCheckAndSubmit();

    await expect.element(categorySelect()).toHaveFocus();
    await expect
      .element(bodyInput())
      .toHaveAccessibleDescription(
        expect.stringContaining(
          'メッセージに使用できない文字が含まれています。',
        ) as string,
      );
  });

  test('停止中になった後の送信の拒否は、フォームの文言で示す', async () => {
    const message =
      'このアカウントは現在ご利用いただけません。詳しくはお問い合わせください。';
    executeGraphQL.mockImplementation(() =>
      rejectWith(
        new GraphQLClientError({
          code: 'account_unavailable',
          message,
          status: 403,
        }),
      ),
    );
    const router = await renderForm();

    await fillValidInput();
    await passBotCheckAndSubmit();

    await expect.element(alert()).toHaveTextContent(message);
    expect(router.state.location.pathname).toBe('/contact');
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('添付するファイルの一覧と確認できないファイルの表示中に、アクセシビリティの検査の違反が0件', async () => {
      const upload = stubUploadFetch();
      executeGraphQL.mockImplementation(() =>
        rejectWith(
          attachmentsInvalid(
            'input.fileIds.1',
            'invalid',
            INVALID_ATTACHMENT_MESSAGE,
          ),
        ),
      );
      await renderForm();

      await fillValidInput();
      await uploadInTwoSelections(upload);
      const listed = await runAxe(form().element());
      await passBotCheckAndSubmit();
      await expect
        .element(attachedItems().nth(1))
        .toHaveTextContent('添付できません');

      expect(listed).toStrictEqual([]);
      expect(await runAxe(form().element())).toStrictEqual([]);
    });

    test('入力前と添付のエラーの表示中に、アクセシビリティの検査の違反が0件', async () => {
      stubUploadFetch();
      await renderForm();
      const initial = await runAxe(form().element());

      await userEvent.upload(
        fileInput(),
        Array.from({ length: 21 }, (_, index) =>
          createDocumentFile(`note-${String(index)}.txt`, 'text/plain', 1),
        ),
      );
      await expect
        .element(attachmentButton())
        .toHaveAttribute('aria-invalid', 'true');

      expect(initial).toStrictEqual([]);
      expect(await runAxe(form().element())).toStrictEqual([]);
    });
  });
});
