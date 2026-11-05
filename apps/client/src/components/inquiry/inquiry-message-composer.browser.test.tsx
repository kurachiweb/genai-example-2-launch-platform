import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import {
  stubUploadFetch,
  uploadedReply,
} from '../../../lib/test/fake-upload-fetch.ts';
import { createDocumentFile } from '../../../lib/test/media-files.ts';
import {
  type GraphQLResult,
  GraphQLClientError,
} from '../../../lib/utilities/graphql/graphql-result.ts';
import { CHAT_INQUIRY_ID } from '../../../test/inquiry-chat-fixtures.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import {
  ClientPostInquiryMessageDocument,
  type ClientPostInquiryMessageMutation,
} from '../../graphql/generated/graphql.ts';
import { InquiryMessageComposer } from './inquiry-message-composer.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const form = () => page.getByRole('form', { name: 'メッセージの送信フォーム' });
const bodyInput = () => page.getByRole('textbox', { name: 'メッセージ(必須)' });
const attachmentButton = () =>
  page.getByRole('button', { name: '添付ファイル ファイルを選択' });
const submitButton = () => page.getByRole('button', { name: /^送信/u });
const alert = () => form().getByRole('alert');
const attachedList = () => page.getByRole('list', { name: '添付するファイル' });
const attachedItems = () => attachedList().getByRole('listitem');
const removeButton = (fileName: string) =>
  page.getByRole('button', { name: `${fileName}を削除` });

type PostResult = GraphQLResult<ClientPostInquiryMessageMutation>;

const posted = (): Promise<PostResult> =>
  Promise.resolve({
    ok: true,
    data: { postInquiryMessage: { id: '01JC0MESSAGE00000000000004' } },
  });

const rejectWith = (error: GraphQLClientError): Promise<PostResult> =>
  Promise.resolve({ ok: false, error });

const renderComposer = () =>
  renderInRouter(<InquiryMessageComposer inquiryId={CHAT_INQUIRY_ID} />, {
    path: `/inquiries/${CHAT_INQUIRY_ID}`,
  });

function fileInput(): HTMLInputElement {
  const input = form()
    .element()
    .querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) {
    throw new Error('ファイルの入力欄が描画されていません。');
  }
  return input;
}

async function uploadGuide(
  upload: ReturnType<typeof stubUploadFetch>,
  fileId = 'file-1',
): Promise<void> {
  const guide = createDocumentFile('guide.pdf', 'application/pdf', 1024);
  await userEvent.upload(fileInput(), [guide]);
  await upload.reply(uploadedReply(guide, fileId));
  await expect
    .element(page.getByText('guide.pdfをアップロードしました。'))
    .toBeInTheDocument();
}

beforeEach(() => {
  executeGraphQL.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  applyColorScheme('light');
});

describe('InquiryMessageComposer', () => {
  test('本文と添付を、対象の問い合わせへの追加メッセージとしてbot判定なしで送る', async () => {
    const upload = stubUploadFetch();
    executeGraphQL.mockImplementation(posted);
    await renderComposer();

    await userEvent.fill(bodyInput(), '  画面の様子を添付します。\n');
    await uploadGuide(upload);
    await userEvent.click(submitButton());

    await expect.poll(() => executeGraphQL.mock.calls.length).toBe(1);
    expect(executeGraphQL).toHaveBeenCalledWith(
      ClientPostInquiryMessageDocument,
      {
        inquiryId: CHAT_INQUIRY_ID,
        input: { body: '  画面の様子を添付します。\n', fileIds: ['file-1'] },
      },
      { turnstileToken: undefined },
    );
    expect(upload.calls.map(({ path }) => path)).toEqual([
      expect.stringContaining('inquiry-attachment') as string,
    ]);
  });

  test('送信中は送信の操作を無効にし、重ねての送信を送らない', async () => {
    let resolvePost: (result: PostResult) => void = () => undefined;
    executeGraphQL.mockImplementation(
      () =>
        new Promise<PostResult>((resolve) => {
          resolvePost = resolve;
        }),
    );
    await renderComposer();

    await userEvent.fill(bodyInput(), '追加の情報です。');
    await userEvent.click(submitButton());

    await expect
      .element(submitButton())
      .toHaveAttribute('aria-disabled', 'true');
    await expect.element(submitButton()).toHaveAttribute('aria-busy', 'true');
    await expect.element(submitButton()).toHaveTextContent('送信中');
    await userEvent.click(submitButton(), { force: true });
    expect(executeGraphQL).toHaveBeenCalledTimes(1);
    resolvePost({
      ok: true,
      data: { postInquiryMessage: { id: '01JC0MESSAGE00000000000004' } },
    });
    await expect.element(submitButton()).toHaveTextContent('送信する');
  });

  test('送信できたら本文と添付を空にし、続けて入力できるよう本文の欄へフォーカスを移す', async () => {
    const upload = stubUploadFetch();
    executeGraphQL.mockImplementation(posted);
    await renderComposer();

    await userEvent.fill(bodyInput(), '追加の情報です。');
    await uploadGuide(upload);
    await userEvent.click(submitButton());

    await expect.element(bodyInput()).toHaveValue('');
    await expect.element(bodyInput()).toHaveFocus();
    expect(attachedList().query()).toBeNull();
    expect(
      page.getByText('guide.pdfをアップロードしました。').query(),
    ).toBeNull();
  });

  test.each([
    ['空白だけの本文', ' \n', 'メッセージを入力してください。'],
    [
      '1,001書記素の本文',
      'あ'.repeat(1001),
      'メッセージは1,000文字以内で入力してください。',
    ],
    [
      '使用できない文字を含む本文',
      '本文\u0007',
      'メッセージに使用できない文字が含まれています。',
    ],
  ])(
    '%sは、フォーカスを外した時点で欄のエラーにして送らない',
    async (_label, body, message) => {
      await renderComposer();

      await userEvent.fill(bodyInput(), body);
      await userEvent.tab();

      await expect
        .element(bodyInput())
        .toHaveAccessibleDescription(
          expect.stringContaining(message) as string,
        );
      await expect.element(submitButton()).toBeDisabled();
      expect(executeGraphQL).not.toHaveBeenCalled();
    },
  );

  test('サーバーが返した本文の詳細を、本文の欄のエラーにする', async () => {
    executeGraphQL.mockImplementation(() =>
      rejectWith(
        new GraphQLClientError({
          code: 'validation_error',
          message: '入力内容を確認してください。',
          status: 400,
          details: [
            {
              field: 'input.body',
              code: 'forbidden-character',
              message: 'メッセージに使用できない文字が含まれています。',
            },
          ],
        }),
      ),
    );
    await renderComposer();

    await userEvent.fill(bodyInput(), '追加の情報です。');
    await userEvent.click(submitButton());

    await expect.element(bodyInput()).toHaveFocus();
    await expect
      .element(bodyInput())
      .toHaveAccessibleDescription(
        expect.stringContaining(
          'メッセージに使用できない文字が含まれています。',
        ) as string,
      );
  });

  test('サーバーが確認できないとしたファイルを一覧で示し、添付の欄へフォーカスを移す', async () => {
    const upload = stubUploadFetch();
    const message =
      '添付ファイルを確認できませんでした。もう一度選択してください。';
    executeGraphQL.mockImplementation(() =>
      rejectWith(
        new GraphQLClientError({
          code: 'inquiry_attachments_invalid',
          message,
          status: 400,
          details: [{ field: 'input.fileIds.0', code: 'invalid', message }],
        }),
      ),
    );
    await renderComposer();

    await userEvent.fill(bodyInput(), '追加の情報です。');
    await uploadGuide(upload);
    await userEvent.click(submitButton());

    await expect
      .element(attachedItems().nth(0))
      .toHaveTextContent(
        'このファイルは添付できません。削除してから送信してください。',
      );
    await expect.element(attachmentButton()).toHaveFocus();
    expect(alert().elements()).toHaveLength(0);
  });

  test.each([
    [
      '問い合わせが見つからない',
      new GraphQLClientError({
        code: 'inquiry_not_found',
        message: '問い合わせが見つかりません。',
        status: 404,
      }),
    ],
    [
      '停止中になった後の送信の拒否',
      new GraphQLClientError({
        code: 'account_unavailable',
        message:
          'このアカウントは現在ご利用いただけません。詳しくはお問い合わせください。',
        status: 403,
      }),
    ],
  ])('%sの失敗は、フォームの文言で示す', async (_label, error) => {
    executeGraphQL.mockImplementation(() => rejectWith(error));
    await renderComposer();

    await userEvent.fill(bodyInput(), '追加の情報です。');
    await userEvent.click(submitButton());

    await expect.element(alert()).toHaveTextContent(error.message);
  });

  test('添付の想定外の応答は、問い合わせを促す文言で示す', async () => {
    const upload = stubUploadFetch();
    await renderComposer();

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

  test('アップロード中に前の選択のファイルを削除しても、アップロードを続けて終わったファイルを添付に足す', async () => {
    const upload = stubUploadFetch();
    executeGraphQL.mockImplementation(posted);
    await renderComposer();
    await userEvent.fill(bodyInput(), '追加の情報です。');
    await uploadGuide(upload);
    const notes = createDocumentFile('notes.txt', 'text/plain', 10);

    await userEvent.upload(fileInput(), [notes]);
    await expect.poll(() => upload.pendingCount()).toBe(1);
    await userEvent.click(removeButton('guide.pdf'));
    await upload.reply(uploadedReply(notes, 'file-2'));

    await expect.element(removeButton('notes.txt')).toBeInTheDocument();
    expect(removeButton('guide.pdf').query()).toBeNull();
    expect(upload.calls[1]?.signal?.aborted).toBe(false);
    await userEvent.click(submitButton());
    await expect.poll(() => executeGraphQL.mock.calls.length).toBe(1);
    expect(executeGraphQL).toHaveBeenCalledWith(
      ClientPostInquiryMessageDocument,
      {
        inquiryId: CHAT_INQUIRY_ID,
        input: { body: '追加の情報です。', fileIds: ['file-2'] },
      },
      expect.anything(),
    );
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('欄のエラーと添付の一覧の表示中に、アクセシビリティの検査の違反が0件', async () => {
      const upload = stubUploadFetch();
      await renderComposer();

      await uploadGuide(upload);
      await userEvent.fill(bodyInput(), ' ');
      await userEvent.tab();
      await expect.element(bodyInput()).toHaveAttribute('aria-invalid', 'true');

      expect(await runAxe(form().element())).toStrictEqual([]);
    });
  });
});
