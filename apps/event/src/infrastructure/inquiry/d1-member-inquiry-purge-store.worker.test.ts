import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';

import type { Database } from '../../../db/client.ts';
import {
  clearIdentityTables,
  createRecordingDatabase,
  db,
  expectWithinBindLimit,
  insertUser,
  T0,
  userIdOf,
} from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import type { MemberInquiryPurgeStore } from '../../application/inquiry/ports.ts';
import { D1MemberInquiryPurgeStore } from './d1-member-inquiry-purge-store.ts';
import {
  fileIdOf,
  indexesFrom,
  insertMemberInquiries,
  insertMessageWithAttachments,
  memberInquiryIdOf,
  messageIdOf,
  readMemberInquiryRowsOf,
  resetMemberInquiryRows,
} from './testing/member-inquiry-purge-fixtures.ts';

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const LIMIT = 100;

const PURGED = 1;

const KEPT = 2;

const NO_ROWS = { inquiryIds: [], messageIds: [], fileIds: [] };

function createStore(database: Database = db): MemberInquiryPurgeStore {
  return new D1MemberInquiryPurgeStore(database);
}

// 101件の問い合わせを持つ利用者と、行が残るべき別の利用者を入れる。最初と100件目と101件目の問い合わせに添付つきのメッセージを付ける
async function arrangePurgedAndKeptUsers(): Promise<void> {
  await insertUser(PURGED, { deletedAt: T0 });
  await insertUser(KEPT);
  await insertMemberInquiries(PURGED, indexesFrom(1, 101));
  await insertMemberInquiries(KEPT, [1001], null);
  await insertMessageWithAttachments(1, 1, [1, 2]);
  await insertMessageWithAttachments(2, 1, []);
  await insertMessageWithAttachments(3, 100, [3]);
  await insertMessageWithAttachments(4, 101, [4, 5]);
  await insertMessageWithAttachments(1001, 1001, [1001]);
}

const KEPT_USER_ROWS = {
  inquiryIds: [memberInquiryIdOf(1001)],
  messageIds: [messageIdOf(1001)],
  fileIds: [fileIdOf(1001)],
};

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await resetMemberInquiryRows();
  await clearIdentityTables();
});

describe('D1MemberInquiryPurgeStore.purgeBatch', () => {
  test('IDの昇順に上限の件数の問い合わせを、添付の紐付けとメッセージとともに消し、残りがあれば続きありを返す', async () => {
    await arrangePurgedAndKeptUsers();

    await expect(
      createStore().purgeBatch(userIdOf(PURGED), LIMIT),
    ).resolves.toStrictEqual({ hasMore: true });

    await expect(readMemberInquiryRowsOf(PURGED)).resolves.toStrictEqual({
      inquiryIds: [memberInquiryIdOf(101)],
      messageIds: [messageIdOf(4)],
      fileIds: [fileIdOf(4), fileIdOf(5)],
    });
    await expect(readMemberInquiryRowsOf(KEPT)).resolves.toStrictEqual(
      KEPT_USER_ROWS,
    );
  });

  test('2回目の呼び出しで残りを消して完了を返し、同じ呼び出しを繰り返しても結果が変わらない', async () => {
    await arrangePurgedAndKeptUsers();
    const store = createStore();
    await store.purgeBatch(userIdOf(PURGED), LIMIT);

    await expect(
      store.purgeBatch(userIdOf(PURGED), LIMIT),
    ).resolves.toStrictEqual({ hasMore: false });
    await expect(readMemberInquiryRowsOf(PURGED)).resolves.toStrictEqual(
      NO_ROWS,
    );

    await expect(
      store.purgeBatch(userIdOf(PURGED), LIMIT),
    ).resolves.toStrictEqual({ hasMore: false });
    await expect(readMemberInquiryRowsOf(PURGED)).resolves.toStrictEqual(
      NO_ROWS,
    );
    await expect(readMemberInquiryRowsOf(KEPT)).resolves.toStrictEqual(
      KEPT_USER_ROWS,
    );
  });

  test('問い合わせがちょうど上限の件数なら1回で消して完了を返す', async () => {
    await insertUser(PURGED, { deletedAt: T0 });
    await insertMemberInquiries(PURGED, indexesFrom(1, LIMIT));

    await expect(
      createStore().purgeBatch(userIdOf(PURGED), LIMIT),
    ).resolves.toStrictEqual({ hasMore: false });
    await expect(readMemberInquiryRowsOf(PURGED)).resolves.toStrictEqual(
      NO_ROWS,
    );
  });

  test('論理削除していない問い合わせも消す', async () => {
    await insertUser(PURGED, { deletedAt: T0 });
    await insertMemberInquiries(PURGED, [1], null);
    await insertMemberInquiries(PURGED, [2]);
    await insertMessageWithAttachments(1, 1, [1]);

    await expect(
      createStore().purgeBatch(userIdOf(PURGED), LIMIT),
    ).resolves.toStrictEqual({ hasMore: false });
    await expect(readMemberInquiryRowsOf(PURGED)).resolves.toStrictEqual(
      NO_ROWS,
    );
  });

  test('問い合わせも利用者の行も無ければ、何も消さずに完了を返す', async () => {
    await insertUser(KEPT);
    await insertMemberInquiries(KEPT, [1001], null);
    await insertMessageWithAttachments(1001, 1001, [1001]);

    await expect(
      createStore().purgeBatch(userIdOf(PURGED), LIMIT),
    ).resolves.toStrictEqual({ hasMore: false });
    await expect(readMemberInquiryRowsOf(KEPT)).resolves.toStrictEqual(
      KEPT_USER_ROWS,
    );
  });

  test('上限の件数の問い合わせを消す各文のバインド変数は上限に収まる', async () => {
    await arrangePurgedAndKeptUsers();
    const { database, placeholderCounts } = createRecordingDatabase();

    await createStore(database).purgeBatch(userIdOf(PURGED), LIMIT);

    expectWithinBindLimit(placeholderCounts);
  });

  test('一括の書き込みの途中で失敗すると、添付の紐付けもメッセージも残して失敗を投げる', async () => {
    await arrangePurgedAndKeptUsers();
    await env.DB.exec(
      "CREATE TRIGGER member_inquiries_delete_failure BEFORE DELETE ON member_inquiries BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
    );

    try {
      await expect(
        createStore().purgeBatch(userIdOf(PURGED), LIMIT),
      ).rejects.toThrow();
    } finally {
      await env.DB.exec('DROP TRIGGER member_inquiries_delete_failure');
    }
    const rows = await readMemberInquiryRowsOf(PURGED);
    expect(rows.inquiryIds).toHaveLength(101);
    expect(rows.messageIds).toEqual([
      messageIdOf(1),
      messageIdOf(2),
      messageIdOf(3),
      messageIdOf(4),
    ]);
    expect(rows.fileIds).toEqual([1, 2, 3, 4, 5].map(fileIdOf));
  });
});
