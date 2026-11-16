import { beforeEach, describe, expect, test } from 'vitest';

import type {
  CommentExportRecord,
  RatingExportRecord,
} from '../../core/engagement/ports.ts';
import { D1CommentExport, D1RatingExport } from './d1-engagement-export.ts';
import {
  after,
  clearEngagementTables,
  commentIdOf,
  db,
  insertComments,
  insertLaunch,
  insertProduct,
  insertRatings,
  insertUser,
  launchIdOf,
  productIdOf,
  T0,
  userIdOf,
} from './testing/engagement-fixtures.ts';

const OWNER = 1;
const MEMBER = 2;
const OTHER_MEMBER = 3;
const PRODUCT = 1;
const OTHER_PRODUCT = 2;
const THIRD_PRODUCT = 3;
const LAUNCH = 1;

const comments = new D1CommentExport(db);
const ratings = new D1RatingExport(db);

beforeEach(async () => {
  await clearEngagementTables();
  await insertUser(OWNER, { emailVerifiedAt: T0 });
  await insertUser(MEMBER, { emailVerifiedAt: T0 });
  await insertUser(OTHER_MEMBER, { emailVerifiedAt: T0 });
  await insertProduct(PRODUCT, OWNER);
  await insertProduct(OTHER_PRODUCT, OWNER);
  await insertProduct(THIRD_PRODUCT, OWNER);
  await insertLaunch(LAUNCH, PRODUCT);
});

describe('D1CommentExport.listByUser', () => {
  test('本人の未匿名化のコメントだけを、削除済み・非公開化を印付きで含めて作成の古い順に返す', async () => {
    await insertComments([
      {
        index: 1,
        product: PRODUCT,
        launch: LAUNCH,
        author: MEMBER,
        columns: { body: '**原文**', createdAt: after(2) },
      },
      {
        index: 2,
        product: PRODUCT,
        launch: LAUNCH,
        author: MEMBER,
        columns: { createdAt: after(1), deletedAt: after(5) },
      },
      {
        index: 3,
        product: PRODUCT,
        launch: LAUNCH,
        author: MEMBER,
        columns: {
          createdAt: after(3),
          editedAt: after(4),
          hiddenAt: after(6),
        },
      },
      {
        index: 4,
        product: PRODUCT,
        launch: LAUNCH,
        author: MEMBER,
        parent: { index: 1, root: 1 },
        depth: 2,
        columns: { createdAt: after(4) },
      },
      {
        index: 5,
        product: PRODUCT,
        launch: LAUNCH,
        author: MEMBER,
        columns: {
          body: '',
          createdAt: after(1),
          deletedAt: after(2),
          anonymizedAt: after(7),
        },
      },
      {
        index: 6,
        product: PRODUCT,
        launch: LAUNCH,
        author: OTHER_MEMBER,
        columns: { createdAt: after(1) },
      },
      {
        index: 7,
        product: PRODUCT,
        launch: LAUNCH,
        author: null,
        columns: { body: '', createdAt: after(1), anonymizedAt: after(7) },
      },
      {
        index: 8,
        product: PRODUCT,
        launch: LAUNCH,
        author: MEMBER,
        columns: { createdAt: after(2) },
      },
    ]);

    const records = await comments.listByUser(userIdOf(MEMBER));

    expect(records.map((record) => record.id)).toEqual(
      [2, 1, 8, 3, 4].map(commentIdOf),
    );
    expect(records[1]).toEqual<CommentExportRecord>({
      id: commentIdOf(1),
      productId: productIdOf(PRODUCT),
      launchId: launchIdOf(LAUNCH),
      parentId: null,
      bodyMarkdown: '**原文**',
      createdAt: after(2),
      editedAt: null,
      deletedAt: null,
      hiddenByAdmin: false,
    });
    expect(records[0]).toMatchObject<Partial<CommentExportRecord>>({
      deletedAt: after(5),
      hiddenByAdmin: false,
    });
    expect(records[3]).toMatchObject<Partial<CommentExportRecord>>({
      editedAt: after(4),
      deletedAt: null,
      hiddenByAdmin: true,
    });
    expect(records[4]).toMatchObject<Partial<CommentExportRecord>>({
      parentId: commentIdOf(1),
      hiddenByAdmin: false,
    });
  });

  test('コメントの無い利用者は空の一覧を返す', async () => {
    await insertComments([
      { index: 1, product: PRODUCT, launch: LAUNCH, author: OTHER_MEMBER },
    ]);

    await expect(comments.listByUser(userIdOf(MEMBER))).resolves.toEqual([]);
  });
});

describe('D1RatingExport.listByUser', () => {
  test('本人の論理削除されていない評価だけを作成の古い順に返し、無効化した評価はinvalidatedByAdminが真、していない評価は偽になる', async () => {
    await insertRatings([
      {
        index: 1,
        product: PRODUCT,
        user: MEMBER,
        score: 4,
        columns: { createdAt: after(2), updatedAt: after(3) },
      },
      {
        index: 2,
        product: OTHER_PRODUCT,
        user: MEMBER,
        score: 2,
        columns: {
          createdAt: after(1),
          updatedAt: after(1),
          invalidatedAt: after(4),
        },
      },
      {
        index: 3,
        product: THIRD_PRODUCT,
        user: MEMBER,
        score: 5,
        columns: { createdAt: after(1), deletedAt: after(5) },
      },
      {
        index: 4,
        product: PRODUCT,
        user: OTHER_MEMBER,
        score: 1,
        columns: { createdAt: after(1) },
      },
    ]);

    const records = await ratings.listByUser(userIdOf(MEMBER));

    expect(records).toEqual<readonly RatingExportRecord[]>([
      {
        productId: productIdOf(OTHER_PRODUCT),
        score: 2,
        invalidatedByAdmin: true,
        createdAt: after(1),
        updatedAt: after(1),
      },
      {
        productId: productIdOf(PRODUCT),
        score: 4,
        invalidatedByAdmin: false,
        createdAt: after(2),
        updatedAt: after(3),
      },
    ]);
  });

  test('評価の無い利用者は空の一覧を返す', async () => {
    await insertRatings([{ index: 1, product: PRODUCT, user: OTHER_MEMBER }]);

    await expect(ratings.listByUser(userIdOf(MEMBER))).resolves.toEqual([]);
  });
});
