import { beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT } from '../../../lib/utilities/messages/state-messages.ts';
import { failure, success } from '../../../test/admin-accounts-fixtures.ts';
import {
  alert,
  ARTICLE,
  button,
  CATEGORY_MOVE_NOTICE,
  categoryTrigger,
  CONFLICT_MESSAGE,
  fillAndBlur,
  graphql,
  HANDLE_UNAVAILABLE_MESSAGE,
  type Handler,
  handleInput,
  NOT_FOUND_MESSAGE,
  option,
  OTHER,
  pinnedCheckbox,
  PREVIOUS_HANDLE_GUIDANCE,
  reasonInput,
  renderCreateForm,
  renderEditForm,
  respond,
  savedArticleOf,
  statusRadio,
  subtitleInput,
  titleInput,
  USAGE,
  waitForEditor,
} from './help-article-form-testing.tsx';

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

vi.mock('../../../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

const VALIDATION_MESSAGE = '入力内容を確認してください。';

const validationError = (
  details: readonly { readonly field: string; readonly message: string }[],
) =>
  failure({
    code: 'validation_error',
    message: VALIDATION_MESSAGE,
    status: 400,
    details: details.map((detail) => ({ ...detail, code: 'custom' })),
  });

const listLink = () =>
  page.getByRole('link', { name: 'ヘルプ記事の一覧へ', exact: true });

beforeEach(() => {
  graphql.mockReset();
  respond();
});

describe('送信', () => {
  test('作成は入力した値をCreateHelpArticleInputの形で送り、作成した記事を渡す', async () => {
    const create = vi.fn<Handler>(() =>
      success({ createHelpArticle: savedArticleOf({ pinned: false }) }),
    );
    respond({ create });
    const { onSaved } = await renderCreateForm();
    const body = await waitForEditor();

    await userEvent.fill(titleInput(), '  Upvoteの仕組み ');
    await userEvent.fill(subtitleInput(), '投票の数え方');
    await fillAndBlur(handleInput(), 'How-Upvote-Works');
    await userEvent.click(categoryTrigger());
    await userEvent.click(option(USAGE.name));
    await userEvent.click(statusRadio('公開'));
    await userEvent.click(body);
    await userEvent.keyboard('1人1票です。');
    await userEvent.fill(reasonInput(), '新しい機能の説明');
    await userEvent.click(button('作成する'));

    await expect.poll(() => onSaved.mock.calls.length).toBe(1);
    expect(create.mock.calls[0]?.[0]).toEqual({
      input: {
        fields: {
          title: 'Upvoteの仕組み',
          subtitle: '投票の数え方',
          handle: 'How-Upvote-Works',
          categoryId: USAGE.id,
          pinned: false,
          status: 'PUBLISHED',
          body: '1人1票です。',
        },
        reason: '新しい機能の説明',
      },
    });
    expect(onSaved.mock.calls[0]?.[0]).toMatchObject({
      id: ARTICLE.id,
      status: 'published',
      pinned: false,
      revision: ARTICLE.revision + 1,
    });
  });

  test('編集は記事のIDと読み込んだ版を足してUpdateHelpArticleInputの形で送り、保存した記事を渡す', async () => {
    const update = vi.fn<Handler>(() =>
      success({
        updateHelpArticle: savedArticleOf({
          categoryId: OTHER.id,
          categoryName: OTHER.name,
        }),
      }),
    );
    respond({ update });
    const { onSaved } = await renderEditForm();

    await userEvent.click(categoryTrigger());
    await userEvent.click(option(OTHER.name));
    await userEvent.click(pinnedCheckbox());
    await userEvent.click(statusRadio('下書き'));
    await userEvent.click(button('保存する'));

    await expect.poll(() => onSaved.mock.calls.length).toBe(1);
    expect(update.mock.calls[0]?.[0]).toEqual({
      input: {
        id: ARTICLE.id,
        expectedRevision: ARTICLE.revision,
        fields: {
          title: ARTICLE.title,
          subtitle: ARTICLE.subtitle,
          handle: ARTICLE.handle,
          categoryId: OTHER.id,
          pinned: false,
          status: 'DRAFT',
          body: ARTICLE.body,
        },
      },
    });
    expect(onSaved.mock.calls[0]?.[0]).toMatchObject({
      categoryId: OTHER.id,
      revision: ARTICLE.revision + 1,
    });
  });
});

describe('サーバーのエラー', () => {
  test('使用中のハンドルは、ハンドルの欄に示してフォーカスを移す', async () => {
    respond({
      update: () =>
        failure({
          code: 'help_article_handle_unavailable',
          message: HANDLE_UNAVAILABLE_MESSAGE,
          status: 409,
          details: [
            {
              field: 'input.fields.handle',
              code: 'unavailable',
              message: HANDLE_UNAVAILABLE_MESSAGE,
            },
          ],
        }),
    });
    await renderEditForm();

    await userEvent.click(button('保存する'));

    await expect
      .element(handleInput())
      .toHaveAccessibleDescription(
        `${PREVIOUS_HANDLE_GUIDANCE} ${HANDLE_UNAVAILABLE_MESSAGE}`,
      );
    await expect.element(handleInput()).toHaveFocus();
    expect(alert().query()).toBeNull();
  });

  test('カテゴリの不在は、カテゴリの欄に選び直すよう示す', async () => {
    respond({
      update: () =>
        validationError([
          {
            field: 'input.fields.categoryId',
            message: 'カテゴリを選択してください。',
          },
        ]),
    });
    await renderEditForm();

    await userEvent.click(button('保存する'));

    await expect
      .element(categoryTrigger())
      .toHaveAccessibleDescription(
        `${CATEGORY_MOVE_NOTICE} カテゴリを選択してください。`,
      );
    expect(alert().query()).toBeNull();
  });

  test('欄ごとの詳細(input.fields.<名前>・input.reason)をその欄に示す', async () => {
    respond({
      update: () =>
        validationError([
          {
            field: 'input.fields.title',
            message: 'タイトルに使用できない文字が含まれています。',
          },
          {
            field: 'input.reason',
            message: '理由は500文字以内で入力してください。',
          },
        ]),
    });
    await renderEditForm();

    await userEvent.click(button('保存する'));

    await expect
      .element(titleInput())
      .toHaveAccessibleDescription(
        'タイトルに使用できない文字が含まれています。',
      );
    await expect
      .element(reasonInput())
      .toHaveAccessibleDescription(
        '理由には、ユーザーや管理者のメールアドレス・氏名などの個人情報を含めないでください。 理由は500文字以内で入力してください。',
      );
  });

  test('欄をまとめたinput.fieldsそのものの詳細は、フォーム全体の失敗として示し、保存のボタンを無効のまま残さない', async () => {
    respond({
      update: () =>
        validationError([
          { field: 'input.fields', message: VALIDATION_MESSAGE },
        ]),
    });
    await renderEditForm();

    await userEvent.click(button('保存する'));

    await expect.element(alert()).toHaveTextContent(VALIDATION_MESSAGE);
    await expect.element(button('保存する')).toBeEnabled();
  });

  test('競合は最新の内容を読み込んでから保存するよう示す', async () => {
    respond({
      update: () =>
        failure({
          code: 'help_article_conflict',
          message: CONFLICT_MESSAGE,
          status: 409,
        }),
    });
    await renderEditForm();

    await userEvent.click(button('保存する'));

    await expect.element(alert()).toHaveTextContent(CONFLICT_MESSAGE);
    expect(listLink().query()).toBeNull();
  });

  test('削除済みは記事が削除された旨と一覧への導線を示す', async () => {
    respond({
      update: () =>
        failure({
          code: 'help_article_not_found',
          message: NOT_FOUND_MESSAGE,
          status: 404,
        }),
    });
    await renderEditForm();

    await userEvent.click(button('保存する'));

    await expect.element(alert()).toHaveTextContent(NOT_FOUND_MESSAGE);
    await expect.element(listLink()).toHaveAttribute('href', '/help-articles');
  });

  test('GraphQLClientErrorでない例外は、問い合わせを促さない文言を示す', async () => {
    respond({ update: () => Promise.reject(new TypeError('Failed to fetch')) });
    await renderEditForm();

    await userEvent.click(button('保存する'));

    await expect
      .element(alert())
      .toHaveTextContent(UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT);
    expect(alert().element().textContent).not.toContain('問い合わせ');
  });

  test('次の送信で前の失敗の表示を消す', async () => {
    let attempt = 0;
    respond({
      update: () => {
        attempt += 1;
        return attempt === 1
          ? failure({
              code: 'help_article_conflict',
              message: CONFLICT_MESSAGE,
              status: 409,
            })
          : success({ updateHelpArticle: savedArticleOf() });
      },
    });
    const { onSaved } = await renderEditForm();

    await userEvent.click(button('保存する'));
    await expect.element(alert()).toBeVisible();
    await userEvent.click(button('保存する'));

    await expect.poll(() => onSaved.mock.calls.length).toBe(1);
    expect(alert().query()).toBeNull();
  });
});
