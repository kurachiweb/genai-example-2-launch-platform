import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { INQUIRY_REPLY_ACTION } from '../../../common-lib/admin/audit-actions/inquiry-chat.ts';
import { INQUIRY_CATEGORY_OTHER_ID } from '../../../common-lib/inquiry/inquiry-category-constants.ts';
import {
  INQUIRY_STATUSES,
  type InquiryStatus,
} from '../../../common-lib/inquiry/inquiry-status.ts';
import { createDatabase } from '../../../db/client.ts';
import { memberInquiries } from '../../../db/schema/inquiry/member-inquiries.ts';
import type { PreparedAuditEntry } from '../../../lib/core/admin/audit-log.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import {
  clearIdentityTables,
  insertUser,
  userIdOf,
} from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import { createBatchRecordingD1 } from '../../../test/support/batch-recording-d1.ts';
import type {
  MemberInquiryStore,
  NewInquiryMessage,
  NewMemberInquiry,
} from '../../application/inquiry/ports.ts';
import { statusAfterUserMessage } from '../../domain/inquiry/inquiry-status-rules.ts';
import { isAuditGuardRejection } from '../admin/audit-log-statements.ts';
import { D1MemberInquiryStore } from './d1-member-inquiry-store.ts';
import { encodeInquiryCursor } from './inquiry-cursor.ts';
import {
  after,
  auditLogIdOf,
  categoryIdOf,
  db,
  fileIdOf,
  guestInquiryIdOf,
  insertAttachments,
  insertCategory,
  insertGuestInquiry,
  insertInquiryMessage,
  insertMemberInquiry,
  memberInquiryIdOf,
  messageIdOf,
  OPERATOR_ADMIN_ID,
  preparedAuditEntryOf,
  readAttachmentRows,
  readAuditLogs,
  readMemberInquiryRows,
  readMessageRows,
  resetInquiryTables,
  T0,
} from './testing/inquiry-store-fixtures.ts';

const MAX_BOUND_PARAMETERS = 100;

const INQUIRY_ID = memberInquiryIdOf(1);

function createStore(): MemberInquiryStore {
  return new D1MemberInquiryStore(db);
}

function createRecordingStore() {
  const recording = createBatchRecordingD1(env.DB);
  return {
    recording,
    store: new D1MemberInquiryStore(createDatabase(recording.d1)),
  };
}

function fileIdsOf(count: number): string[] {
  return Array.from({ length: count }, (_, index) => fileIdOf(index + 1));
}

function messageOf(
  index: number,
  columns: Partial<NewInquiryMessage> = {},
): NewInquiryMessage {
  return {
    id: messageIdOf(index),
    body: `  メッセージ${String(index)}\n続き  `,
    fileIds: [],
    at: after(100),
    ...columns,
  };
}

function newInquiryOf(
  columns: Partial<NewMemberInquiry> = {},
): NewMemberInquiry {
  return {
    id: INQUIRY_ID,
    userId: userIdOf(1),
    categoryId: INQUIRY_CATEGORY_OTHER_ID,
    at: after(5),
    firstMessage: messageOf(1, {
      fileIds: [fileIdOf(2), fileIdOf(1)],
      at: after(5),
    }),
    ...columns,
  };
}

function replyAuditOf(index: number, inquiryId: string): PreparedAuditEntry {
  return preparedAuditEntryOf(index, {
    action: INQUIRY_REPLY_ACTION.name,
    targetKind: 'inquiry',
    targetIds: [inquiryId],
    occurredAt: after(200),
  });
}

const REPLY = Object.freeze({
  id: messageIdOf(50),
  adminId: OPERATOR_ADMIN_ID,
  body: '  ご連絡ありがとうございます。  ',
  at: after(200),
});

async function rejectionOf(write: Promise<unknown>): Promise<unknown> {
  try {
    await write;
  } catch (error) {
    return error;
  }
  return undefined;
}

// Drizzleの失敗はD1のエラーをcauseに持つため、原因をたどって文言を集める
function causeMessagesOf(error: unknown): string {
  const messages: string[] = [];
  for (let current = error; current instanceof Error; current = current.cause) {
    messages.push(current.message);
  }
  return messages.join('\n');
}

function expectWithinBoundParameters(queries: readonly string[]): void {
  for (const query of queries) {
    expect(query.match(/\?/gu)?.length ?? 0).toBeLessThanOrEqual(
      MAX_BOUND_PARAMETERS,
    );
  }
}

async function readInquiryRow(id: string) {
  const rows = await readMemberInquiryRows();
  return rows.find((row) => row.id === id);
}

beforeEach(async () => {
  await resetInquiryTables();
  await clearIdentityTables();
  await insertUser(1);
  await insertUser(2);
});

describe('D1MemberInquiryStore', () => {
  describe('insert', () => {
    test('問い合わせを未対応で、最初のメッセージを利用者の送信として、添付を選んだ順の位置で1つの一括の書き込みに保存する', async () => {
      const { recording, store } = createRecordingStore();

      await store.insert(newInquiryOf());

      expect(recording.batches).toHaveLength(1);
      expect(recording.statementsOutsideBatches()).toEqual([]);
      await expect(readMemberInquiryRows()).resolves.toEqual([
        {
          id: INQUIRY_ID,
          userId: userIdOf(1),
          categoryId: INQUIRY_CATEGORY_OTHER_ID,
          status: 'open',
          statusChangedAt: after(5),
          lastMessageAt: after(5),
          createdAt: after(5),
          updatedAt: after(5),
          deletedAt: null,
        },
      ]);
      await expect(readMessageRows()).resolves.toEqual([
        {
          id: messageIdOf(1),
          inquiryId: INQUIRY_ID,
          senderKind: 'user',
          adminId: null,
          body: '  メッセージ1\n続き  ',
          createdAt: after(5),
        },
      ]);
      await expect(readAttachmentRows()).resolves.toEqual([
        { messageId: messageIdOf(1), fileId: fileIdOf(2), position: 0 },
        { messageId: messageIdOf(1), fileId: fileIdOf(1), position: 1 },
      ]);
    });

    test('添付が無い問い合わせは、添付の行を作らずに保存する', async () => {
      await createStore().insert(
        newInquiryOf({ firstMessage: messageOf(1, { at: after(5) }) }),
      );

      await expect(readMessageRows()).resolves.toHaveLength(1);
      await expect(readAttachmentRows()).resolves.toEqual([]);
    });

    test('21件の添付でも、各文のバインド変数が上限に収まり、全件を位置の順に保存する', async () => {
      const fileIds = fileIdsOf(21);
      const { recording, store } = createRecordingStore();

      await store.insert(
        newInquiryOf({ firstMessage: messageOf(1, { fileIds, at: after(5) }) }),
      );

      expect(recording.batches).toHaveLength(1);
      expectWithinBoundParameters(recording.batches.flat());
      const rows = await readAttachmentRows();
      expect(rows.map((row) => row.fileId)).toEqual(fileIds);
      expect(rows.map((row) => row.position)).toEqual(
        fileIds.map((_, index) => index),
      );
    });

    test('存在しないカテゴリを参照する保存は、何も保存せずカテゴリの欄の検証のエラーにする', async () => {
      const error = await rejectionOf(
        createStore().insert(newInquiryOf({ categoryId: categoryIdOf(9) })),
      );

      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        kind: 'bad_request',
        code: 'validation_error',
        details: [{ field: 'categoryId', code: 'not-found' }],
      });
      await expect(readMemberInquiryRows()).resolves.toEqual([]);
      await expect(readMessageRows()).resolves.toEqual([]);
      await expect(readAttachmentRows()).resolves.toEqual([]);
    });

    test('添付の保存が失敗すると、問い合わせとメッセージも残さずに失敗をそのまま投げる', async () => {
      await env.DB.exec(
        "CREATE TRIGGER inquiry_attachments_insert_failure BEFORE INSERT ON inquiry_message_attachments BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
      );

      try {
        const error = await rejectionOf(createStore().insert(newInquiryOf()));

        expect(error).not.toBeInstanceOf(AppError);
        expect(causeMessagesOf(error)).toMatch(/injected failure/u);
      } finally {
        await env.DB.exec('DROP TRIGGER inquiry_attachments_insert_failure');
      }
      await expect(readMemberInquiryRows()).resolves.toEqual([]);
      await expect(readMessageRows()).resolves.toEqual([]);
    });
  });

  describe('findById', () => {
    test('論理削除した問い合わせも削除日時とともに返し、無い問い合わせはundefinedを返す', async () => {
      await insertMemberInquiry(1, {
        categoryId: INQUIRY_CATEGORY_OTHER_ID,
        status: 'resolved',
        statusChangedAt: after(3),
        lastMessageAt: after(4),
        deletedAt: after(9),
      });
      const store = createStore();

      await expect(store.findById(INQUIRY_ID)).resolves.toEqual({
        id: INQUIRY_ID,
        userId: userIdOf(1),
        categoryId: INQUIRY_CATEGORY_OTHER_ID,
        status: 'resolved',
        statusChangedAt: after(3),
        lastMessageAt: after(4),
        createdAt: T0,
        deletedAt: after(9),
      });
      await expect(
        store.findById(memberInquiryIdOf(9)),
      ).resolves.toBeUndefined();
    });
  });

  describe('listMessages', () => {
    test('問い合わせのメッセージだけを送信日時の古い順に、添付を位置の順に返す', async () => {
      await insertMemberInquiry(1, { categoryId: INQUIRY_CATEGORY_OTHER_ID });
      await insertMemberInquiry(2, { categoryId: INQUIRY_CATEGORY_OTHER_ID });
      await insertInquiryMessage(3, {
        inquiryId: INQUIRY_ID,
        createdAt: after(30),
      });
      await insertInquiryMessage(2, {
        inquiryId: INQUIRY_ID,
        senderKind: 'admin',
        adminId: OPERATOR_ADMIN_ID,
        body: '返信です。',
        createdAt: after(20),
      });
      await insertInquiryMessage(1, {
        inquiryId: INQUIRY_ID,
        createdAt: after(20),
      });
      await insertInquiryMessage(4, {
        inquiryId: memberInquiryIdOf(2),
        createdAt: after(10),
      });
      await insertAttachments(messageIdOf(1), [fileIdOf(3), fileIdOf(1)]);
      await insertAttachments(messageIdOf(3), [fileIdOf(2)]);
      await insertAttachments(messageIdOf(4), [fileIdOf(4)]);

      const messages = await createStore().listMessages(INQUIRY_ID);

      expect(messages).toEqual([
        {
          id: messageIdOf(1),
          inquiryId: INQUIRY_ID,
          sender: 'user',
          adminId: null,
          body: 'メッセージ1',
          fileIds: [fileIdOf(3), fileIdOf(1)],
          createdAt: after(20),
        },
        {
          id: messageIdOf(2),
          inquiryId: INQUIRY_ID,
          sender: 'admin',
          adminId: OPERATOR_ADMIN_ID,
          body: '返信です。',
          fileIds: [],
          createdAt: after(20),
        },
        {
          id: messageIdOf(3),
          inquiryId: INQUIRY_ID,
          sender: 'user',
          adminId: null,
          body: 'メッセージ3',
          fileIds: [fileIdOf(2)],
          createdAt: after(30),
        },
      ]);
    });

    test('メッセージの無い問い合わせと無い問い合わせは空の一覧を返す', async () => {
      await insertMemberInquiry(1, { categoryId: INQUIRY_CATEGORY_OTHER_ID });
      const store = createStore();

      await expect(store.listMessages(INQUIRY_ID)).resolves.toEqual([]);
      await expect(store.listMessages(memberInquiryIdOf(9))).resolves.toEqual(
        [],
      );
    });
  });

  describe('listByUser', () => {
    async function seedUserInquiries(count: number): Promise<void> {
      for (let index = 1; index <= count; index += 1) {
        await insertMemberInquiry(index, {
          categoryId: INQUIRY_CATEGORY_OTHER_ID,
          createdAt: after(index * 10),
        });
      }
    }

    test('本人の論理削除していない問い合わせを送信日時の新しい順に20件ずつ読み、次のページのカーソルで残りを読む', async () => {
      await seedUserInquiries(21);
      await insertMemberInquiry(30, {
        categoryId: INQUIRY_CATEGORY_OTHER_ID,
        createdAt: after(1000),
        deletedAt: after(1001),
      });
      await insertMemberInquiry(
        31,
        { categoryId: INQUIRY_CATEGORY_OTHER_ID, createdAt: after(1000) },
        2,
      );
      const store = createStore();

      const first = await store.listByUser(userIdOf(1), { limit: 20 });

      expect(first.items.map((item) => item.id)).toEqual(
        Array.from({ length: 20 }, (_, index) => memberInquiryIdOf(21 - index)),
      );
      expect(first.items[0]).toEqual({
        id: memberInquiryIdOf(21),
        userId: userIdOf(1),
        categoryId: INQUIRY_CATEGORY_OTHER_ID,
        status: 'open',
        statusChangedAt: T0,
        lastMessageAt: T0,
        createdAt: after(210),
        deletedAt: null,
      });
      expect(first.nextCursor).toBe(
        encodeInquiryCursor({ at: after(20), id: memberInquiryIdOf(2) }),
      );

      const second = await store.listByUser(userIdOf(1), {
        after: first.nextCursor ?? '',
        limit: 20,
      });

      expect(second.items.map((item) => item.id)).toEqual([
        memberInquiryIdOf(1),
      ]);
      expect(second.nextCursor).toBeNull();
    });

    test('ちょうど20件なら次のページのカーソルを返さない', async () => {
      await seedUserInquiries(20);

      const page = await createStore().listByUser(userIdOf(1), { limit: 20 });

      expect(page.items).toHaveLength(20);
      expect(page.nextCursor).toBeNull();
    });

    test('送信日時が同じ問い合わせはIDの降順に並べ、カーソルの位置の次から読む', async () => {
      for (const index of [1, 2, 3]) {
        await insertMemberInquiry(index, {
          categoryId: INQUIRY_CATEGORY_OTHER_ID,
          createdAt: after(10),
        });
      }
      const store = createStore();

      const page = await store.listByUser(userIdOf(1), {
        after: encodeInquiryCursor({
          at: after(10),
          id: memberInquiryIdOf(3),
        }),
        limit: 20,
      });

      expect(page.items.map((item) => item.id)).toEqual([
        memberInquiryIdOf(2),
        memberInquiryIdOf(1),
      ]);
    });

    test('問い合わせの無い利用者は空のページを返す', async () => {
      await expect(
        createStore().listByUser(userIdOf(2), { limit: 20 }),
      ).resolves.toEqual({ items: [], nextCursor: null });
    });

    test('不正なカーソルをページの位置の指定の誤りとして拒否する', async () => {
      const error = await rejectionOf(
        createStore().listByUser(userIdOf(1), { after: 'invalid', limit: 20 }),
      );

      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: 'invalid_cursor' });
    });
  });

  describe('appendUserMessage', () => {
    test.each(INQUIRY_STATUSES.map((status) => [status]))(
      'ステータスが%sの問い合わせへの追加は、ステータスを利用者の送信の規則どおりに変え、変わるときだけ変更日時を更新する',
      async (status: InquiryStatus) => {
        await insertMemberInquiry(1, {
          categoryId: INQUIRY_CATEGORY_OTHER_ID,
          status,
          statusChangedAt: after(1),
          lastMessageAt: after(2),
        });
        const next = statusAfterUserMessage(status);

        const result = await createStore().appendUserMessage(
          INQUIRY_ID,
          messageOf(1),
        );

        expect(result).toBe('appended');
        await expect(readInquiryRow(INQUIRY_ID)).resolves.toEqual(
          expect.objectContaining({
            status: next,
            statusChangedAt: next === status ? after(1) : after(100),
            lastMessageAt: after(100),
            updatedAt: after(100),
          }),
        );
      },
    );

    test('メッセージを利用者の送信として、添付と問い合わせの更新を1つの一括の書き込みで保存する', async () => {
      await insertMemberInquiry(1, { categoryId: INQUIRY_CATEGORY_OTHER_ID });
      const { recording, store } = createRecordingStore();

      await store.appendUserMessage(
        INQUIRY_ID,
        messageOf(2, { fileIds: [fileIdOf(5), fileIdOf(4)] }),
      );

      expect(recording.batches).toHaveLength(1);
      expect(recording.statementsOutsideBatches()).toEqual([]);
      await expect(readMessageRows()).resolves.toEqual([
        {
          id: messageIdOf(2),
          inquiryId: INQUIRY_ID,
          senderKind: 'user',
          adminId: null,
          body: '  メッセージ2\n続き  ',
          createdAt: after(100),
        },
      ]);
      await expect(readAttachmentRows()).resolves.toEqual([
        { messageId: messageIdOf(2), fileId: fileIdOf(5), position: 0 },
        { messageId: messageIdOf(2), fileId: fileIdOf(4), position: 1 },
      ]);
    });

    test('読み取った後に管理者が対応済へ変えていても、書き込みの時点のステータスから未対応へ戻す', async () => {
      await insertMemberInquiry(1, {
        categoryId: INQUIRY_CATEGORY_OTHER_ID,
        status: 'in_progress',
        statusChangedAt: after(1),
      });
      const store = createStore();
      await store.findById(INQUIRY_ID);
      await db
        .update(memberInquiries)
        .set({ status: 'resolved', statusChangedAt: after(50) })
        .where(eq(memberInquiries.id, INQUIRY_ID));

      await store.appendUserMessage(INQUIRY_ID, messageOf(1));

      await expect(readInquiryRow(INQUIRY_ID)).resolves.toEqual(
        expect.objectContaining({
          status: 'open',
          statusChangedAt: after(100),
        }),
      );
    });

    test('21件の添付でも、各文のバインド変数が上限に収まり、全件を保存する', async () => {
      await insertMemberInquiry(1, { categoryId: INQUIRY_CATEGORY_OTHER_ID });
      const fileIds = fileIdsOf(21);
      const { recording, store } = createRecordingStore();

      await store.appendUserMessage(INQUIRY_ID, messageOf(1, { fileIds }));

      expect(recording.batches).toHaveLength(1);
      expectWithinBoundParameters(recording.batches.flat());
      const rows = await readAttachmentRows();
      expect(rows.map((row) => row.fileId)).toEqual(fileIds);
    });

    test('論理削除した問い合わせへの追加は、メッセージ・添付・問い合わせの更新のどれも残さずにnot-foundを返す', async () => {
      await insertMemberInquiry(1, {
        categoryId: INQUIRY_CATEGORY_OTHER_ID,
        status: 'resolved',
        statusChangedAt: after(1),
        lastMessageAt: after(2),
        deletedAt: after(3),
      });
      const before = await readInquiryRow(INQUIRY_ID);

      const result = await createStore().appendUserMessage(
        INQUIRY_ID,
        messageOf(1, { fileIds: [fileIdOf(1)] }),
      );

      expect(result).toBe('not-found');
      await expect(readMessageRows()).resolves.toEqual([]);
      await expect(readAttachmentRows()).resolves.toEqual([]);
      await expect(readInquiryRow(INQUIRY_ID)).resolves.toEqual(before);
    });

    test('無い問い合わせへの追加はnot-foundを返し、何も残さない', async () => {
      const result = await createStore().appendUserMessage(
        memberInquiryIdOf(9),
        messageOf(1, { fileIds: [fileIdOf(1)] }),
      );

      expect(result).toBe('not-found');
      await expect(readMessageRows()).resolves.toEqual([]);
      await expect(readAttachmentRows()).resolves.toEqual([]);
    });

    test('問い合わせの不在以外の失敗はそのまま投げる', async () => {
      await insertMemberInquiry(1, { categoryId: INQUIRY_CATEGORY_OTHER_ID });
      await insertInquiryMessage(1, { inquiryId: INQUIRY_ID });

      const error = await rejectionOf(
        createStore().appendUserMessage(INQUIRY_ID, messageOf(1)),
      );

      expect(error).toBeInstanceOf(Error);
      expect(causeMessagesOf(error)).toMatch(/UNIQUE constraint failed/u);
      await expect(readInquiryRow(INQUIRY_ID)).resolves.toEqual(
        expect.objectContaining({ lastMessageAt: T0 }),
      );
    });
  });

  describe('appendAdminReply', () => {
    test('返信を管理者の送信として、最後のメッセージの日時の更新と監査ログとともに1つの一括の書き込みで保存し、ステータスを変えない', async () => {
      await insertMemberInquiry(1, {
        categoryId: INQUIRY_CATEGORY_OTHER_ID,
        status: 'resolved',
        statusChangedAt: after(1),
        lastMessageAt: after(2),
      });
      const { recording, store } = createRecordingStore();

      const result = await store.appendAdminReply(
        INQUIRY_ID,
        REPLY,
        replyAuditOf(1, INQUIRY_ID),
      );

      expect(result).toBe('appended');
      expect(recording.batches).toHaveLength(1);
      expect(recording.statementsOutsideBatches()).toEqual([]);
      await expect(readMessageRows()).resolves.toEqual([
        {
          id: messageIdOf(50),
          inquiryId: INQUIRY_ID,
          senderKind: 'admin',
          adminId: OPERATOR_ADMIN_ID,
          body: '  ご連絡ありがとうございます。  ',
          createdAt: after(200),
        },
      ]);
      await expect(readAttachmentRows()).resolves.toEqual([]);
      await expect(readInquiryRow(INQUIRY_ID)).resolves.toEqual(
        expect.objectContaining({
          status: 'resolved',
          statusChangedAt: after(1),
          lastMessageAt: after(200),
          updatedAt: after(200),
        }),
      );
      await expect(readAuditLogs()).resolves.toEqual([
        {
          id: auditLogIdOf(1),
          operatorAdminId: OPERATOR_ADMIN_ID,
          action: INQUIRY_REPLY_ACTION.name,
          targetKind: 'inquiry',
          detail: {},
          targetIds: [INQUIRY_ID],
        },
      ]);
    });

    test('退会により論理削除した問い合わせへの返信は、監査ログごと取り消してwithdrawnを返す', async () => {
      await insertMemberInquiry(1, {
        categoryId: INQUIRY_CATEGORY_OTHER_ID,
        lastMessageAt: after(2),
        deletedAt: after(3),
      });
      const before = await readInquiryRow(INQUIRY_ID);

      const result = await createStore().appendAdminReply(
        INQUIRY_ID,
        REPLY,
        replyAuditOf(1, INQUIRY_ID),
      );

      expect(result).toBe('withdrawn');
      await expect(readMessageRows()).resolves.toEqual([]);
      await expect(readAuditLogs()).resolves.toEqual([]);
      await expect(readInquiryRow(INQUIRY_ID)).resolves.toEqual(before);
    });

    test('無い問い合わせと未ログインの問い合わせへの返信は、監査ログごと取り消してnot-foundを返す', async () => {
      await insertGuestInquiry(1, { categoryId: INQUIRY_CATEGORY_OTHER_ID });
      const store = createStore();

      await expect(
        store.appendAdminReply(
          memberInquiryIdOf(9),
          REPLY,
          replyAuditOf(1, memberInquiryIdOf(9)),
        ),
      ).resolves.toBe('not-found');
      await expect(
        store.appendAdminReply(
          guestInquiryIdOf(1),
          REPLY,
          replyAuditOf(2, guestInquiryIdOf(1)),
        ),
      ).resolves.toBe('not-found');
      await expect(readMessageRows()).resolves.toEqual([]);
      await expect(readAuditLogs()).resolves.toEqual([]);
    });

    test('監査ログの条件による取り消し以外の失敗は、そのまま投げて何も残さない', async () => {
      await insertMemberInquiry(1, { categoryId: INQUIRY_CATEGORY_OTHER_ID });
      await insertInquiryMessage(50, { inquiryId: INQUIRY_ID });

      const error = await rejectionOf(
        createStore().appendAdminReply(
          INQUIRY_ID,
          REPLY,
          replyAuditOf(1, INQUIRY_ID),
        ),
      );

      expect(isAuditGuardRejection(error)).toBe(false);
      expect(causeMessagesOf(error)).toMatch(/UNIQUE constraint failed/u);
      await expect(readAuditLogs()).resolves.toEqual([]);
      await expect(readInquiryRow(INQUIRY_ID)).resolves.toEqual(
        expect.objectContaining({ lastMessageAt: T0 }),
      );
    });
  });

  test('カテゴリを指定した問い合わせも同じ形で保存する', async () => {
    await insertCategory(1, 'Billing');

    await createStore().insert(newInquiryOf({ categoryId: categoryIdOf(1) }));

    await expect(readInquiryRow(INQUIRY_ID)).resolves.toEqual(
      expect.objectContaining({ categoryId: categoryIdOf(1) }),
    );
  });
});
