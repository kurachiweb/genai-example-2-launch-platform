import { eq } from 'drizzle-orm';
import {
  type GraphQLType,
  isInterfaceType,
  isObjectType,
  isUnionType,
} from 'graphql';
import { beforeEach, describe, expect, test } from 'vitest';

import { ADMIN_AVATAR_UPLOAD_PURPOSE } from '../../../../../common-lib/admin/admin-avatar-upload.ts';
import {
  HELP_CATEGORY_OTHER_ID,
  HELP_CATEGORY_OTHER_NAME,
} from '../../../../../common-lib/help/help-category-constants.ts';
import { admins } from '../../../../../db/schema/admin/admins.ts';
import { helpArticles } from '../../../../../db/schema/help/help-articles.ts';
import { helpCategories } from '../../../../../db/schema/help/help-categories.ts';
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
  objectKeyOf,
} from '../../../../../lib/workers/media/testing/media-file-store-fixtures.ts';
import {
  HELP_ADMINS,
  asHelpAdmin,
  codesOf,
  helpAdminIdOf,
  installHelpAdminGraphQLTest,
} from '../../../../../test/support/help-graphql-operations.ts';
import {
  fetchHelpArticle,
  fetchHelpCenter,
  fetchPinnedHelpArticles,
  searchHelpArticles,
} from '../../../../../test/support/help-public-graphql-operations.ts';
import { indexPublishedHelpArticle } from '../../../../infrastructure/help/testing/help-article-store-fixtures.ts';
import { composeGatewaySchema } from '../../schema-composer.ts';
import { mediaSchemaModule } from '../media/index.ts';
import { helpSchemaModule } from './index.ts';

installHelpAdminGraphQLTest();

const { moderator, viewer } = HELP_ADMINS;

const USAGE = 1;
const EMPTY = 2;

const UPDATED_AT = new Date('2026-11-03T04:05:06.000Z');

const summaryOf = (index: number, pinned = false) => ({
  handle: `article${String(index)}`,
  title: `タイトル${String(index)}`,
  subtitle: `サブタイトル${String(index)}`,
  pinned,
});

beforeEach(async () => {
  await clearMediaTables();
});

// 「使い方」・標準カテゴリ・公開の記事の無いカテゴリの順に並べ、下書きの記事を混ぜる
async function insertHelpCenterArticles(): Promise<void> {
  await db
    .update(helpCategories)
    .set({ sortOrder: 2 })
    .where(eq(helpCategories.id, HELP_CATEGORY_OTHER_ID));
  await insertHelpCategory(USAGE, { name: '使い方', sortOrder: 1 });
  await insertHelpCategory(EMPTY, { name: '空のカテゴリ', sortOrder: 3 });
  await insertHelpArticle(1, {
    categoryId: helpCategoryIdOf(USAGE),
    pinned: true,
    sortOrder: 3,
  });
  await insertHelpArticle(2, {
    categoryId: helpCategoryIdOf(USAGE),
    sortOrder: 1,
  });
  await insertHelpArticle(3, {
    categoryId: helpCategoryIdOf(USAGE),
    pinned: true,
    status: 'draft',
    sortOrder: 2,
  });
  await insertHelpArticle(4, { pinned: true, sortOrder: 1 });
  await insertHelpArticle(5, {
    categoryId: helpCategoryIdOf(EMPTY),
    status: 'draft',
  });
}

describe('helpCenter', () => {
  test('ログイン無しで、公開の記事をカテゴリの並び順・ピン留めの群・記事の並び順で返し、公開の記事の無いカテゴリを除く', async () => {
    await insertHelpCenterArticles();

    const response = await fetchHelpCenter();

    expect(response.errors).toBeUndefined();
    expect(response.data?.helpCenter).toEqual([
      { name: '使い方', articles: [summaryOf(1, true), summaryOf(2)] },
      { name: HELP_CATEGORY_OTHER_NAME, articles: [summaryOf(4, true)] },
    ]);
  });

  test('公開の記事が無ければ空の配列を返す', async () => {
    await insertHelpArticle(1, { status: 'draft' });

    const response = await fetchHelpCenter();

    expect(response.errors).toBeUndefined();
    expect(response.data?.helpCenter).toEqual([]);
  });
});

describe('pinnedHelpArticles', () => {
  test('ログイン無しで、公開のピン留めの記事だけをヘルプトップと同じ順のハンドルとタイトルで返す', async () => {
    await insertHelpCenterArticles();

    const response = await fetchPinnedHelpArticles();

    expect(response.errors).toBeUndefined();
    expect(response.data?.pinnedHelpArticles).toEqual([
      { handle: 'article1', title: 'タイトル1' },
      { handle: 'article4', title: 'タイトル4' },
    ]);
  });
});

describe('helpArticle', () => {
  async function setAuthorAvatar(adminIndex: number): Promise<void> {
    await insertFile(1, {
      purpose: ADMIN_AVATAR_UPLOAD_PURPOSE,
      ownerKind: 'admin',
      ownerId: helpAdminIdOf(adminIndex),
    });
    await db
      .update(admins)
      .set({ avatarFileId: fileIdOf(1), title: 'サポート担当' })
      .where(eq(admins.id, helpAdminIdOf(adminIndex)));
  }

  test('ログイン無しで、公開の記事をハンドルの大文字小文字を区別せずに解決し、作成者と同カテゴリの公開の記事を返す', async () => {
    await insertHelpCenterArticles();
    await setAuthorAvatar(moderator);
    await db
      .update(helpArticles)
      .set({
        handle: 'Getting-Started',
        bodyMarkdown: '## 使い方\n\n本文です。',
        createdByAdminId: helpAdminIdOf(moderator),
        updatedAt: UPDATED_AT,
      })
      .where(eq(helpArticles.id, helpArticleIdOf(2)));

    const response = await fetchHelpArticle('getting-started');

    expect(response.errors).toBeUndefined();
    expect(response.data?.helpArticle).toEqual({
      __typename: 'HelpArticle',
      handle: 'Getting-Started',
      title: 'タイトル2',
      subtitle: 'サブタイトル2',
      body: '## 使い方\n\n本文です。',
      categoryName: '使い方',
      author: {
        nickname: `管理者${String(moderator)}`,
        title: 'サポート担当',
        avatar: { id: fileIdOf(1), objectKey: objectKeyOf(1) },
      },
      updatedAt: UPDATED_AT.toISOString(),
      relatedArticles: [summaryOf(1, true)],
    });
  });

  test('作成者の管理者が削除されていればauthorをnullにする', async () => {
    await insertHelpArticle(1, { createdByAdminId: HELP_AUTHOR_ADMIN_ID });

    const response = await fetchHelpArticle('article1');

    expect(response.errors).toBeUndefined();
    expect(response.data?.helpArticle).toMatchObject({
      __typename: 'HelpArticle',
      handle: 'article1',
      author: null,
      updatedAt: T0.toISOString(),
      relatedArticles: [],
    });
  });

  test('公開の記事の旧ハンドルは、現在のハンドルの表記への転送を返す', async () => {
    await insertHelpArticle(1, { handle: 'New-Handle' });
    await insertHelpArticlePreviousHandle(1, 'old-handle');

    const response = await fetchHelpArticle('OLD-handle');

    expect(response.errors).toBeUndefined();
    expect(response.data?.helpArticle).toEqual({
      __typename: 'HelpArticleRedirect',
      handle: 'New-Handle',
    });
  });

  test.each([
    ['下書きの記事の現在のハンドル', 'article3'],
    ['下書きの記事の旧ハンドル', 'draft-old'],
    ['存在しないハンドル', 'missing'],
    ['文字種が形式に合わないハンドル', 'bad handle!'],
    ['51文字のハンドル', 'a'.repeat(51)],
  ])('%sはエラーにせずnullを返す', async (_label, handle) => {
    await insertHelpCenterArticles();
    await insertHelpArticlePreviousHandle(3, 'draft-old');

    const response = await fetchHelpArticle(handle);

    expect(response.errors).toBeUndefined();
    expect(response.data).toEqual({ helpArticle: null });
  });
});

describe('helpArticleSearch', () => {
  const FIFTY = 'a'.repeat(50);

  beforeEach(async () => {
    await insertHelpCategory(USAGE, { name: '使い方', sortOrder: 1 });
    await insertHelpArticle(1, {
      handle: 'rocketship',
      title: 'Rocketship',
      subtitle: 'Fly to the moon',
      categoryId: helpCategoryIdOf(USAGE),
      pinned: true,
    });
    await insertHelpArticle(2, { title: FIFTY, subtitle: 'Long word' });
    await insertHelpArticle(3, { title: 'Rocket draft', subtitle: 'Moon' });
    await indexPublishedHelpArticle(1);
    await indexPublishedHelpArticle(2);
    await indexPublishedHelpArticle(3);
    await db
      .update(helpArticles)
      .set({ status: 'draft' })
      .where(eq(helpArticles.id, helpArticleIdOf(3)));
  });

  test('ログイン無しで、公開の記事だけをハンドル・タイトル・サブタイトル・カテゴリ名で返す', async () => {
    const response = await searchHelpArticles('rocket');

    expect(response.errors).toBeUndefined();
    expect(response.data?.helpArticleSearch).toEqual([
      {
        handle: 'rocketship',
        title: 'Rocketship',
        subtitle: 'Fly to the moon',
        categoryName: '使い方',
      },
    ]);
  });

  test('51文字の検索語を拒否せず、前後の空白を除いて50文字に切り詰めて検索する', async () => {
    const response = await searchHelpArticles(`  ${FIFTY}b  `);

    expect(response.errors).toBeUndefined();
    expect(response.data?.helpArticleSearch).toEqual([
      {
        handle: 'article2',
        title: FIFTY,
        subtitle: 'Long word',
        categoryName: HELP_CATEGORY_OTHER_NAME,
      },
    ]);
  });

  test.each([
    ['空', ''],
    ['空白だけ', ' 　 '],
  ])('検索語が%sなら空の配列を返す', async (_label, query) => {
    const response = await searchHelpArticles(query);

    expect(response.errors).toBeUndefined();
    expect(response.data?.helpArticleSearch).toEqual([]);
  });

  test('検索式の構文や記号を含む検索語でも失敗しない', async () => {
    const response = await searchHelpArticles('"rocket* OR (moon) NEAR -');

    expect(response.errors).toBeUndefined();
    expect(response.data?.helpArticleSearch).toEqual([]);
  });
});

describe('呼び出し元の確認', () => {
  test.each([
    ['helpCenter', () => fetchHelpCenter(asHelpAdmin(viewer))],
    ['pinnedHelpArticles', () => fetchPinnedHelpArticles(asHelpAdmin(viewer))],
    [
      'helpArticle(形式違反のハンドル)',
      () => fetchHelpArticle('bad handle!', asHelpAdmin(viewer)),
    ],
    [
      'helpArticleSearch(51文字の検索語)',
      () => searchHelpArticles('a'.repeat(51), asHelpAdmin(viewer)),
    ],
  ])(
    '管理者側の呼び出し元からの%sを、入力の検証より前にforbiddenにする',
    async (_label, call) => {
      await insertHelpCenterArticles();

      const response = await call();

      expect(codesOf(response)).toEqual(['forbidden']);
    },
  );
});

describe('利用者側の型', () => {
  const schema = composeGatewaySchema([mediaSchemaModule, helpSchemaModule]);

  function fieldsOf(typeName: string): Record<string, string> {
    const type = schema.getType(typeName);
    const fields: Readonly<Record<string, { readonly type: GraphQLType }>> =
      isObjectType(type) || isInterfaceType(type) ? type.getFields() : {};
    return Object.fromEntries(
      Object.entries(fields).map(([name, field]) => [name, String(field.type)]),
    );
  }

  function membersOf(typeName: string): string[] {
    const type = schema.getType(typeName);
    return isUnionType(type) ? type.getTypes().map(({ name }) => name) : [];
  }

  test('4つの照会を設計どおりの引数と戻り値で持つ', () => {
    const query = schema.getQueryType()?.getFields();
    const signatureOf = (name: string) => ({
      type: String(query?.[name]?.type),
      args: query?.[name]?.args.map((arg) => [arg.name, String(arg.type)]),
    });

    expect(signatureOf('helpCenter')).toEqual({
      type: '[HelpCenterCategory!]!',
      args: [],
    });
    expect(signatureOf('helpArticle')).toEqual({
      type: 'HelpArticleResult',
      args: [['handle', 'String!']],
    });
    expect(signatureOf('helpArticleSearch')).toEqual({
      type: '[HelpSearchHit!]!',
      args: [['query', 'String!']],
    });
    expect(signatureOf('pinnedHelpArticles')).toEqual({
      type: '[HelpArticleLink!]!',
      args: [],
    });
    expect(membersOf('HelpArticleResult')).toEqual([
      'HelpArticle',
      'HelpArticleRedirect',
    ]);
  });

  test('利用者側の型は記事のIDと管理者のIDを持たない', () => {
    expect(fieldsOf('HelpCenterCategory')).toEqual({
      name: 'String!',
      articles: '[HelpArticleSummary!]!',
    });
    expect(fieldsOf('HelpArticleSummary')).toEqual({
      handle: 'String!',
      title: 'String!',
      subtitle: 'String!',
      pinned: 'Boolean!',
    });
    expect(fieldsOf('HelpArticle')).toEqual({
      handle: 'String!',
      title: 'String!',
      subtitle: 'String!',
      body: 'String!',
      categoryName: 'String!',
      author: 'HelpArticleAuthor',
      updatedAt: 'DateTime!',
      relatedArticles: '[HelpArticleSummary!]!',
    });
    expect(fieldsOf('HelpArticleRedirect')).toEqual({ handle: 'String!' });
    expect(fieldsOf('HelpArticleLink')).toEqual({
      handle: 'String!',
      title: 'String!',
    });
    expect(fieldsOf('HelpSearchHit')).toEqual({
      handle: 'String!',
      title: 'String!',
      subtitle: 'String!',
      categoryName: 'String!',
    });
    expect(fieldsOf('HelpArticleAuthor')).toEqual({
      nickname: 'String!',
      title: 'String',
      avatar: 'MediaImage',
    });
  });
});
