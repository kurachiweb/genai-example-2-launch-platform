import { asc } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';

import { HELP_BODY_MAX } from '../../../../../common-lib/help/help-input-rules.ts';
import { HELP_CATEGORY_OTHER_ID } from '../../../../../common-lib/help/help-category-constants.ts';
import { adminAuditLogs } from '../../../../../db/schema/admin/admin-audit-logs.ts';
import {
  db,
  helpArticleIdOf,
  helpCategoryIdOf,
  insertHelpArticle,
  insertHelpArticlePreviousHandle,
  insertHelpCategory,
} from '../../../../../lib/workers/help/testing/help-fixtures.ts';
import {
  createHelpArticle,
  deleteHelpArticle,
  helpArticleFieldsOf,
  readHelpArticleRows,
  readHelpPreviousHandles,
  updateHelpArticle,
} from '../../../../../test/support/help-article-graphql-operations.ts';
import {
  asHelpAdmin,
  codesOf,
  detailsOf,
  HELP_ADMINS,
  helpAdminIdOf,
  installHelpAdminGraphQLTest,
} from '../../../../../test/support/help-graphql-operations.ts';
import { readAuditLogSummaries } from '../../../../infrastructure/admin/testing/admin-store-fixtures.ts';

installHelpAdminGraphQLTest();

const { superAdmin, moderator, viewer } = HELP_ADMINS;

const HANDLE_UNAVAILABLE_MESSAGE =
  'このハンドルは既に使われています。別の文字列を入力してください。';

const NOT_FOUND_MESSAGE = 'このヘルプ記事は削除されています。';

function readAuditReasons() {
  return db
    .select({ action: adminAuditLogs.action, reason: adminAuditLogs.reason })
    .from(adminAuditLogs)
    .orderBy(asc(adminAuditLogs.id));
}

describe('createHelpArticle', () => {
  test('モデレーターは、前後の空白を除いたタイトル・サブタイトルの記事をカテゴリの末尾に作成でき、理由とともに監査ログに記録される', async () => {
    await insertHelpCategory(1, { name: '使い方' });
    await insertHelpArticle(1, {
      categoryId: helpCategoryIdOf(1),
      sortOrder: 4,
    });

    const response = await createHelpArticle(
      {
        fields: helpArticleFieldsOf({
          title: ' はじめに ',
          subtitle: '　最初に読む記事 ',
          categoryId: helpCategoryIdOf(1),
          pinned: true,
          status: 'DRAFT',
        }),
        reason: '新しい機能の案内',
      },
      asHelpAdmin(moderator),
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.createHelpArticle).toEqual({
      id: expect.any(String) as string,
      handle: 'getting-started',
      previousHandle: null,
      title: 'はじめに',
      subtitle: '最初に読む記事',
      body: '## 使い方\n\n本文です。',
      categoryId: helpCategoryIdOf(1),
      categoryName: '使い方',
      status: 'DRAFT',
      pinned: true,
      creator: {
        nickname: `管理者${String(moderator)}`,
        title: null,
        avatar: null,
      },
      revision: 1,
      createdAt: expect.any(String) as string,
      updatedAt: expect.any(String) as string,
    });
    expect(await readHelpArticleRows()).toContainEqual(
      expect.objectContaining({
        handle: 'getting-started',
        categoryId: helpCategoryIdOf(1),
        sortOrder: 5,
      }),
    );
    expect(await readAuditReasons()).toEqual([
      { action: 'help-article.create', reason: '新しい機能の案内' },
    ]);
  });

  test('最上位管理者も作成でき、操作者として記録される', async () => {
    const response = await createHelpArticle(
      { fields: helpArticleFieldsOf() },
      asHelpAdmin(superAdmin),
    );

    expect(response.errors).toBeUndefined();
    expect(await readAuditLogSummaries()).toEqual([
      expect.objectContaining({
        action: 'help-article.create',
        operatorAdminId: helpAdminIdOf(superAdmin),
      }),
    ]);
  });

  test('100,000文字の本文を保存できる', async () => {
    const body = 'あ'.repeat(HELP_BODY_MAX);

    const response = await createHelpArticle(
      { fields: helpArticleFieldsOf({ body }) },
      asHelpAdmin(moderator),
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.createHelpArticle?.body).toBe(body);
    expect(await readHelpArticleRows()).toEqual([
      expect.objectContaining({ bodyMarkdown: body }),
    ]);
  });

  test.each(['admin', 'Support', 'launchstadium', 'help'])(
    '予約語と同じ文字列のハンドル「%s」を受け付ける',
    async (handle) => {
      const response = await createHelpArticle(
        { fields: helpArticleFieldsOf({ handle }) },
        asHelpAdmin(moderator),
      );

      expect(response.errors).toBeUndefined();
      expect(response.data?.createHelpArticle?.handle).toBe(handle);
    },
  );

  test('閲覧のみの管理者の作成をforbiddenで拒否し、作成しない', async () => {
    const response = await createHelpArticle(
      { fields: helpArticleFieldsOf() },
      asHelpAdmin(viewer),
    );

    expect(codesOf(response)).toEqual(['forbidden']);
    expect(await readHelpArticleRows()).toEqual([]);
    expect(await readAuditLogSummaries()).toEqual([]);
  });

  test.each([
    {
      field: 'title',
      value: '  ',
      message: 'タイトルを入力してください。',
    },
    {
      field: 'title',
      value: 'あ'.repeat(101),
      message: 'タイトルは100文字以内で入力してください。',
    },
    {
      field: 'title',
      value: 'タイトル\u0000',
      message: 'タイトルに使用できない文字が含まれています。',
    },
    {
      field: 'subtitle',
      value: '',
      message: 'サブタイトルを入力してください。',
    },
    {
      field: 'subtitle',
      value: 'あ'.repeat(101),
      message: 'サブタイトルは100文字以内で入力してください。',
    },
    {
      field: 'subtitle',
      value: '\u000Bサブタイトル',
      message: 'サブタイトルに使用できない文字が含まれています。',
    },
    {
      field: 'handle',
      value: '',
      message: 'ハンドルを入力してください。',
    },
    {
      field: 'handle',
      value: 'a'.repeat(51),
      message: 'ハンドルは50文字以内で入力してください。',
    },
    {
      field: 'handle',
      value: 'getting started',
      message:
        'ハンドルは英数字で始め、英数字・ハイフン・アンダースコアのみで入力してください。',
    },
    {
      field: 'body',
      value: ' \n ',
      message: '本文を入力してください。',
    },
    {
      field: 'body',
      value: 'あ'.repeat(HELP_BODY_MAX + 1),
      message: '本文は100,000文字以内で入力してください。',
    },
    {
      field: 'categoryId',
      value: 'x'.repeat(65),
      message: 'カテゴリを選択してください。',
    },
  ])(
    '$fieldの違反「$message」をinput.fields.$fieldの詳細で拒否する',
    async ({ field, value, message }) => {
      const response = await createHelpArticle(
        { fields: helpArticleFieldsOf({ [field]: value }) },
        asHelpAdmin(moderator),
      );

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(detailsOf(response)).toEqual([
        expect.objectContaining({ field: `input.fields.${field}`, message }),
      ]);
      expect(await readHelpArticleRows()).toEqual([]);
    },
  );

  test('500文字の理由を受け付け、501文字の理由をinput.reasonの詳細で拒否する', async () => {
    const accepted = await createHelpArticle(
      { fields: helpArticleFieldsOf(), reason: 'あ'.repeat(500) },
      asHelpAdmin(moderator),
    );
    const rejected = await createHelpArticle(
      {
        fields: helpArticleFieldsOf({ handle: 'other' }),
        reason: 'あ'.repeat(501),
      },
      asHelpAdmin(moderator),
    );

    expect(accepted.errors).toBeUndefined();
    expect(codesOf(rejected)).toEqual(['validation_error']);
    expect(detailsOf(rejected)).toEqual([
      {
        field: 'input.reason',
        code: 'custom',
        message: '理由は500文字以内で入力してください。',
      },
    ]);
  });

  test('他の記事の現在のハンドルを、input.fields.handleの詳細を付けたhelp_article_handle_unavailableで拒否する', async () => {
    await insertHelpArticle(1, { handle: 'getting-started', status: 'draft' });

    const response = await createHelpArticle(
      { fields: helpArticleFieldsOf({ handle: 'Getting-Started' }) },
      asHelpAdmin(moderator),
    );

    expect(codesOf(response)).toEqual(['help_article_handle_unavailable']);
    expect(response.errors?.[0]?.message).toBe(HANDLE_UNAVAILABLE_MESSAGE);
    expect(detailsOf(response)).toEqual([
      {
        field: 'input.fields.handle',
        code: 'unavailable',
        message: HANDLE_UNAVAILABLE_MESSAGE,
      },
    ]);
  });

  test('他の記事の旧ハンドルを受け付け、その旧ハンドルを解放する', async () => {
    await insertHelpArticle(1, { handle: 'billing' });
    await insertHelpArticlePreviousHandle(1, 'getting-started');

    const response = await createHelpArticle(
      { fields: helpArticleFieldsOf() },
      asHelpAdmin(moderator),
    );

    expect(response.errors).toBeUndefined();
    expect(await readHelpPreviousHandles()).toEqual([]);
  });

  test('存在しないカテゴリへの作成を、input.fields.categoryIdの詳細を付けた検証のエラーで拒否する', async () => {
    const response = await createHelpArticle(
      { fields: helpArticleFieldsOf({ categoryId: helpCategoryIdOf(99) }) },
      asHelpAdmin(moderator),
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      {
        field: 'input.fields.categoryId',
        code: 'not-found',
        message: 'カテゴリを選択してください。',
      },
    ]);
    expect(await readHelpArticleRows()).toEqual([]);
  });
});

describe('updateHelpArticle', () => {
  test('モデレーターがハンドルとカテゴリを変えると、旧ハンドルを残し版を上げた記事を返す', async () => {
    await insertHelpCategory(1, { name: '使い方' });
    await insertHelpArticle(1, {
      handle: 'getting-started',
      createdByAdminId: helpAdminIdOf(superAdmin),
    });

    const response = await updateHelpArticle(
      {
        id: helpArticleIdOf(1),
        expectedRevision: 1,
        fields: helpArticleFieldsOf({
          handle: 'first-steps',
          title: ' 最初の一歩 ',
          categoryId: helpCategoryIdOf(1),
        }),
      },
      asHelpAdmin(moderator),
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.updateHelpArticle).toEqual(
      expect.objectContaining({
        id: helpArticleIdOf(1),
        handle: 'first-steps',
        previousHandle: 'getting-started',
        title: '最初の一歩',
        categoryId: helpCategoryIdOf(1),
        categoryName: '使い方',
        revision: 2,
        creator: expect.objectContaining({
          nickname: `管理者${String(superAdmin)}`,
        }) as unknown,
      }),
    );
    expect(await readAuditLogSummaries()).toEqual([
      expect.objectContaining({
        action: 'help-article.update',
        operatorAdminId: helpAdminIdOf(moderator),
      }),
    ]);
  });

  test('閲覧のみの管理者の編集をforbiddenで拒否し、変えない', async () => {
    await insertHelpArticle(1);

    const response = await updateHelpArticle(
      {
        id: helpArticleIdOf(1),
        expectedRevision: 1,
        fields: helpArticleFieldsOf(),
      },
      asHelpAdmin(viewer),
    );

    expect(codesOf(response)).toEqual(['forbidden']);
    expect(await readHelpArticleRows()).toEqual([
      expect.objectContaining({ handle: 'article1', revision: 1 }),
    ]);
  });

  test('開いた後に別の画面で保存された記事の編集をhelp_article_conflictで拒否する', async () => {
    await insertHelpArticle(1, { revision: 2 });

    const response = await updateHelpArticle(
      {
        id: helpArticleIdOf(1),
        expectedRevision: 1,
        fields: helpArticleFieldsOf(),
      },
      asHelpAdmin(moderator),
    );

    expect(codesOf(response)).toEqual(['help_article_conflict']);
    expect(response.errors?.[0]?.message).toBe(
      'このヘルプ記事は別の画面で変更されました。最新の内容を読み込んでから保存してください。',
    );
  });

  test('削除された記事の編集をhelp_article_not_foundで拒否する', async () => {
    const response = await updateHelpArticle(
      {
        id: helpArticleIdOf(99),
        expectedRevision: 1,
        fields: helpArticleFieldsOf(),
      },
      asHelpAdmin(moderator),
    );

    expect(codesOf(response)).toEqual(['help_article_not_found']);
    expect(response.errors?.[0]?.message).toBe(NOT_FOUND_MESSAGE);
  });

  test('他の記事の現在のハンドルへの変更を、input.fields.handleの詳細を付けたhelp_article_handle_unavailableで拒否する', async () => {
    await insertHelpArticle(1, { handle: 'getting-started' });
    await insertHelpArticle(2, { handle: 'billing' });

    const response = await updateHelpArticle(
      {
        id: helpArticleIdOf(2),
        expectedRevision: 1,
        fields: helpArticleFieldsOf({ handle: 'getting-started' }),
      },
      asHelpAdmin(moderator),
    );

    expect(codesOf(response)).toEqual(['help_article_handle_unavailable']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({ field: 'input.fields.handle' }),
    ]);
  });

  test('65文字の記事のIDを記事の欄の検証のエラーで拒否する', async () => {
    const response = await updateHelpArticle(
      {
        id: 'x'.repeat(65),
        expectedRevision: 1,
        fields: helpArticleFieldsOf(),
      },
      asHelpAdmin(moderator),
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      { field: 'input.id', code: 'too_big', message: NOT_FOUND_MESSAGE },
    ]);
  });

  test('存在しないカテゴリへの変更を、input.fields.categoryIdの詳細を付けた検証のエラーで拒否する', async () => {
    await insertHelpArticle(1);

    const response = await updateHelpArticle(
      {
        id: helpArticleIdOf(1),
        expectedRevision: 1,
        fields: helpArticleFieldsOf({ categoryId: helpCategoryIdOf(99) }),
      },
      asHelpAdmin(moderator),
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({ field: 'input.fields.categoryId' }),
    ]);
    expect(await readHelpArticleRows()).toEqual([
      expect.objectContaining({ categoryId: HELP_CATEGORY_OTHER_ID }),
    ]);
  });
});

describe('deleteHelpArticle', () => {
  test('モデレーターが記事を削除すると、旧ハンドルとともに消え、理由とともに監査ログに記録される', async () => {
    await insertHelpArticle(1);
    await insertHelpArticlePreviousHandle(1, 'old-article1');

    const response = await deleteHelpArticle(
      { id: helpArticleIdOf(1), reason: '古い案内' },
      asHelpAdmin(moderator),
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.deleteHelpArticle).toEqual({
      id: helpArticleIdOf(1),
    });
    expect(await readHelpArticleRows()).toEqual([]);
    expect(await readHelpPreviousHandles()).toEqual([]);
    expect(await readAuditReasons()).toEqual([
      { action: 'help-article.delete', reason: '古い案内' },
    ]);
  });

  test('閲覧のみの管理者の削除をforbiddenで拒否し、削除しない', async () => {
    await insertHelpArticle(1);

    const response = await deleteHelpArticle(
      { id: helpArticleIdOf(1) },
      asHelpAdmin(viewer),
    );

    expect(codesOf(response)).toEqual(['forbidden']);
    expect(await readHelpArticleRows()).toHaveLength(1);
  });

  test('削除済みの記事の削除をhelp_article_not_foundで拒否する', async () => {
    const response = await deleteHelpArticle(
      { id: helpArticleIdOf(99) },
      asHelpAdmin(moderator),
    );

    expect(codesOf(response)).toEqual(['help_article_not_found']);
    expect(response.errors?.[0]?.message).toBe(NOT_FOUND_MESSAGE);
  });

  test('501文字の理由と65文字のIDを、それぞれの欄の検証のエラーで拒否する', async () => {
    await insertHelpArticle(1);

    const response = await deleteHelpArticle(
      { id: 'x'.repeat(65), reason: 'あ'.repeat(501) },
      asHelpAdmin(moderator),
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      { field: 'id', code: 'too_big', message: NOT_FOUND_MESSAGE },
      {
        field: 'reason',
        code: 'custom',
        message: '理由は500文字以内で入力してください。',
      },
    ]);
    expect(await readHelpArticleRows()).toHaveLength(1);
  });
});
