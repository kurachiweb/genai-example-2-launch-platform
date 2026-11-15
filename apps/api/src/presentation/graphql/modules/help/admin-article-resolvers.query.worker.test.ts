import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { ADMIN_AVATAR_UPLOAD_PURPOSE } from '../../../../../common-lib/admin/admin-avatar-upload.ts';
import { HELP_CATEGORY_OTHER_ID } from '../../../../../common-lib/help/help-category-constants.ts';
import { admins } from '../../../../../db/schema/admin/admins.ts';
import {
  db,
  HELP_AUTHOR_ADMIN_ID,
  helpArticleIdOf,
  helpCategoryIdOf,
  insertHelpArticle,
  insertHelpArticlePreviousHandle,
  insertHelpCategory,
  T0,
} from '../../../../../lib/workers/help/testing/help-fixtures.ts';
import {
  clearMediaTables,
  fileIdOf,
  insertFile,
  insertReason,
  objectKeyOf,
} from '../../../../../lib/workers/media/testing/media-file-store-fixtures.ts';
import {
  fetchAdminHelpArticle,
  fetchAdminHelpArticles,
  fetchHelpArticleHandleAvailability,
} from '../../../../../test/support/help-article-graphql-operations.ts';
import {
  asHelpAdmin,
  codesOf,
  detailsOf,
  HELP_ADMINS,
  helpAdminIdOf,
  installHelpAdminGraphQLTest,
} from '../../../../../test/support/help-graphql-operations.ts';

installHelpAdminGraphQLTest();

const { moderator, viewer } = HELP_ADMINS;

const HOUR_MS = 60 * 60 * 1000;

const at = (hours: number): Date => new Date(T0.getTime() + hours * HOUR_MS);

beforeEach(async () => {
  await clearMediaTables();
});

async function setAdminAvatar(
  adminIndex: number,
  fileIndex: number,
): Promise<void> {
  await insertFile(fileIndex, {
    purpose: ADMIN_AVATAR_UPLOAD_PURPOSE,
    ownerKind: 'admin',
    ownerId: helpAdminIdOf(adminIndex),
  });
  await db
    .update(admins)
    .set({ avatarFileId: fileIdOf(fileIndex), title: 'サポート担当' })
    .where(eq(admins.id, helpAdminIdOf(adminIndex)));
}

describe('adminHelpArticles', () => {
  test('閲覧のみの管理者に、下書きを含む全件を並び順・ピン留め・作成日時とともに更新日時の新しい順で返す', async () => {
    await insertHelpCategory(1, { name: '使い方' });
    await insertHelpArticle(1, {
      categoryId: helpCategoryIdOf(1),
      pinned: true,
      sortOrder: 2,
      createdByAdminId: helpAdminIdOf(moderator),
      createdAt: at(1),
      updatedAt: at(5),
    });
    await insertHelpArticle(2, {
      status: 'draft',
      sortOrder: 1,
      createdByAdminId: helpAdminIdOf(moderator),
      createdAt: at(2),
      updatedAt: at(8),
    });

    const response = await fetchAdminHelpArticles(asHelpAdmin(viewer));

    expect(response.errors).toBeUndefined();
    expect(response.data?.adminHelpArticles).toEqual([
      {
        id: helpArticleIdOf(2),
        handle: 'article2',
        title: 'タイトル2',
        categoryId: HELP_CATEGORY_OTHER_ID,
        categoryName: 'その他',
        status: 'DRAFT',
        pinned: false,
        sortOrder: 1,
        creatorAdminId: helpAdminIdOf(moderator),
        creator: {
          nickname: `管理者${String(moderator)}`,
          title: null,
          avatar: null,
        },
        createdAt: at(2).toISOString(),
        updatedAt: at(8).toISOString(),
      },
      {
        id: helpArticleIdOf(1),
        handle: 'article1',
        title: 'タイトル1',
        categoryId: helpCategoryIdOf(1),
        categoryName: '使い方',
        status: 'PUBLISHED',
        pinned: true,
        sortOrder: 2,
        creatorAdminId: helpAdminIdOf(moderator),
        creator: {
          nickname: `管理者${String(moderator)}`,
          title: null,
          avatar: null,
        },
        createdAt: at(1).toISOString(),
        updatedAt: at(5).toISOString(),
      },
    ]);
  });

  test('作成者の画像を返し、隔離中の画像はobjectKeyをnullにする', async () => {
    await setAdminAvatar(moderator, 1);
    await setAdminAvatar(viewer, 2);
    await insertReason(2, 'auto');
    await insertHelpArticle(1, {
      createdByAdminId: helpAdminIdOf(moderator),
      updatedAt: at(2),
    });
    await insertHelpArticle(2, {
      createdByAdminId: helpAdminIdOf(viewer),
      updatedAt: at(1),
    });

    const response = await fetchAdminHelpArticles(asHelpAdmin(viewer));

    expect(response.errors).toBeUndefined();
    expect(
      response.data?.adminHelpArticles?.map(({ creator }) => creator),
    ).toEqual([
      {
        nickname: `管理者${String(moderator)}`,
        title: 'サポート担当',
        avatar: { id: fileIdOf(1), objectKey: objectKeyOf(1) },
      },
      {
        nickname: `管理者${String(viewer)}`,
        title: 'サポート担当',
        avatar: { id: fileIdOf(2), objectKey: null },
      },
    ]);
  });

  test('削除済みの管理者が作成した記事は、作成者をnullにして作成者のIDを返す', async () => {
    // HELP_AUTHOR_ADMIN_IDの管理者は存在せず、管理者の照会口が返さない削除済みの管理者にあたる
    await insertHelpArticle(1, { createdByAdminId: HELP_AUTHOR_ADMIN_ID });

    const response = await fetchAdminHelpArticles(asHelpAdmin(viewer));

    expect(response.errors).toBeUndefined();
    expect(response.data?.adminHelpArticles).toEqual([
      expect.objectContaining({
        creatorAdminId: HELP_AUTHOR_ADMIN_ID,
        creator: null,
      }),
    ]);
  });

  test('記事が無ければ空の配列を返す', async () => {
    const response = await fetchAdminHelpArticles(asHelpAdmin(viewer));

    expect(response.errors).toBeUndefined();
    expect(response.data?.adminHelpArticles).toEqual([]);
  });

  test('管理者のセッションが無ければunauthenticatedで拒否する', async () => {
    const response = await fetchAdminHelpArticles({ caller: 'admin' });

    expect(codesOf(response)).toEqual(['unauthenticated']);
  });
});

describe('adminHelpArticle', () => {
  test('閲覧のみの管理者に、本文・旧ハンドル・版・作成者を含む1件を返す', async () => {
    await setAdminAvatar(moderator, 1);
    await insertHelpCategory(1, { name: '使い方' });
    await insertHelpArticle(1, {
      categoryId: helpCategoryIdOf(1),
      bodyMarkdown: '## 見出し\n\n本文',
      status: 'draft',
      pinned: true,
      revision: 3,
      createdByAdminId: helpAdminIdOf(moderator),
      createdAt: at(1),
      updatedAt: at(2),
    });
    await insertHelpArticlePreviousHandle(1, 'old-article1');

    const response = await fetchAdminHelpArticle(
      helpArticleIdOf(1),
      asHelpAdmin(viewer),
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.adminHelpArticle).toEqual({
      id: helpArticleIdOf(1),
      handle: 'article1',
      previousHandle: 'old-article1',
      title: 'タイトル1',
      subtitle: 'サブタイトル1',
      body: '## 見出し\n\n本文',
      categoryId: helpCategoryIdOf(1),
      categoryName: '使い方',
      status: 'DRAFT',
      pinned: true,
      creator: {
        nickname: `管理者${String(moderator)}`,
        title: 'サポート担当',
        avatar: { id: fileIdOf(1), objectKey: objectKeyOf(1) },
      },
      revision: 3,
      createdAt: at(1).toISOString(),
      updatedAt: at(2).toISOString(),
    });
  });

  test('作成者が削除済みの管理者なら作成者をnullにする', async () => {
    await insertHelpArticle(1);

    const response = await fetchAdminHelpArticle(
      helpArticleIdOf(1),
      asHelpAdmin(viewer),
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.adminHelpArticle?.creator).toBeNull();
  });

  test('存在しない記事にはnullを返す', async () => {
    const response = await fetchAdminHelpArticle(
      helpArticleIdOf(99),
      asHelpAdmin(viewer),
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.adminHelpArticle).toBeNull();
  });

  test('65文字のIDを記事の欄の検証のエラーで拒否する', async () => {
    const response = await fetchAdminHelpArticle(
      'x'.repeat(65),
      asHelpAdmin(viewer),
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      {
        field: 'id',
        code: 'too_big',
        message: 'このヘルプ記事は削除されています。',
      },
    ]);
  });
});

describe('helpArticleHandleAvailability', () => {
  beforeEach(async () => {
    await insertHelpArticle(1, { handle: 'getting-started' });
    await insertHelpArticle(2, { handle: 'billing' });
    await insertHelpArticlePreviousHandle(2, 'old-billing');
  });

  test.each([
    {
      label: '使われていないハンドル',
      handle: 'new-article',
      articleId: null,
      expected: 'AVAILABLE',
    },
    {
      label: '予約語と同じ文字列',
      handle: 'admin',
      articleId: null,
      expected: 'AVAILABLE',
    },
    {
      label: '他の記事の現在のハンドルと大文字小文字だけが違うハンドル',
      handle: 'Getting-Started',
      articleId: null,
      expected: 'UNAVAILABLE',
    },
    {
      label: '他の記事の旧ハンドル',
      handle: 'old-billing',
      articleId: helpArticleIdOf(1),
      expected: 'AVAILABLE_RELEASES_PREVIOUS',
    },
    {
      label: '編集中の記事自身の旧ハンドル',
      handle: 'old-billing',
      articleId: helpArticleIdOf(2),
      expected: 'AVAILABLE',
    },
    {
      label: '形式に違反するハンドル',
      handle: '-billing',
      articleId: null,
      expected: 'INVALID',
    },
    {
      label: '空のハンドル',
      handle: '',
      articleId: null,
      expected: 'INVALID',
    },
  ])(
    '閲覧のみの管理者に、$labelの判定$expectedを返す',
    async ({ handle, articleId, expected }) => {
      const response = await fetchHelpArticleHandleAvailability(
        { handle, articleId },
        asHelpAdmin(viewer),
      );

      expect(response.errors).toBeUndefined();
      expect(response.data?.helpArticleHandleAvailability).toBe(expected);
    },
  );

  test('50文字のハンドルを判定し、51文字のハンドルをハンドルの欄の検証のエラーで拒否する', async () => {
    const accepted = await fetchHelpArticleHandleAvailability(
      { handle: 'a'.repeat(50) },
      asHelpAdmin(moderator),
    );
    const rejected = await fetchHelpArticleHandleAvailability(
      { handle: 'a'.repeat(51) },
      asHelpAdmin(moderator),
    );

    expect(accepted.data?.helpArticleHandleAvailability).toBe('AVAILABLE');
    expect(codesOf(rejected)).toEqual(['validation_error']);
    expect(detailsOf(rejected)).toEqual([
      {
        field: 'handle',
        code: 'too_big',
        message: 'ハンドルは50文字以内で入力してください。',
      },
    ]);
  });

  test('65文字の記事のIDを記事の欄の検証のエラーで拒否する', async () => {
    const response = await fetchHelpArticleHandleAvailability(
      { handle: 'billing', articleId: 'x'.repeat(65) },
      asHelpAdmin(viewer),
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({ field: 'articleId', code: 'too_big' }),
    ]);
  });
});
