import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { INQUIRY_CATEGORY_OTHER_ID } from '../../../common-lib/inquiry/inquiry-category-constants.ts';
import { adminAuthTokens } from '../../../db/schema/admin/admin-auth-tokens.ts';
import { adminLoginChallenges } from '../../../db/schema/admin/admin-login-challenges.ts';
import { adminRecoveryCodes } from '../../../db/schema/admin/admin-recovery-codes.ts';
import { adminSessions } from '../../../db/schema/admin/admin-sessions.ts';
import { adminTotpCredentials } from '../../../db/schema/admin/admin-totp-credentials.ts';
import { admins } from '../../../db/schema/admin/admins.ts';
import { inquiryCategories } from '../../../db/schema/inquiry/inquiry-categories.ts';
import { inquiryMessageAttachments } from '../../../db/schema/inquiry/inquiry-message-attachments.ts';
import { inquiryMessages } from '../../../db/schema/inquiry/inquiry-messages.ts';
import { memberInquiries } from '../../../db/schema/inquiry/member-inquiries.ts';
import { AppError } from '../../core/errors/app-error.ts';
import {
  INQUIRY_EXPORT_PAGE_SIZE,
  type InquiryExportItem,
} from '../../core/inquiry/ports.ts';
import { D1AdminDirectory } from '../admin/d1-admin-directory.ts';
import {
  clearIdentityTables,
  db,
  insertUser,
  userIdOf,
} from '../identity/testing/identity-store-fixtures.ts';
import {
  fileIdOf,
  insertFile,
} from '../media/testing/media-file-store-fixtures.ts';
import {
  clearMediaState,
  createOperations,
  filePurposeRow,
} from '../media/testing/media-operations-fixtures.ts';
import {
  recordLogs,
  resetLogging,
} from '../media/testing/upload-receiver-fixtures.ts';
import { D1InquiryExport } from './d1-inquiry-export.ts';

const OWNER = 1;

const OTHER_USER = 2;

const ACTIVE_ADMIN_ID = '01JC0ADMN00000000000000801';

// 物理削除済みの管理者は管理者の表に行が無い
const DELETED_ADMIN_ID = '01JC0ADMN00000000000000802';

const CATEGORY_ID = '01JC0EXPCATEGQRY0000000001';

const REMOVED_CATEGORY_ID = '01JC0EXPCATEGQRY0000000002';

const ERASED_FILE = 9;

const INQUIRED_AT = new Date('2026-08-01T10:00:00.123Z');

function at(milliseconds: number): Date {
  return new Date(INQUIRED_AT.getTime() + milliseconds);
}

function inquiryIdOf(index: number): string {
  return `01JC0EXPQ${String(index).padStart(17, '0')}`;
}

function messageIdOf(index: number): string {
  return `01JC0EXPM${String(index).padStart(17, '0')}`;
}

function rangeOf(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, offset) => from + offset);
}

async function insertCategory(id: string, name: string): Promise<void> {
  await db.insert(inquiryCategories).values({
    id,
    name,
    createdAt: INQUIRED_AT,
    updatedAt: INQUIRED_AT,
  });
}

interface InquiryColumns {
  readonly userIndex?: number;
  readonly categoryId?: string;
  readonly status?: 'open' | 'in_progress' | 'resolved' | 'rejected';
  readonly deletedAt?: Date | null;
}

async function insertInquiry(
  index: number,
  {
    userIndex = OWNER,
    categoryId = CATEGORY_ID,
    status = 'open',
    deletedAt = null,
  }: InquiryColumns = {},
): Promise<void> {
  await db.insert(memberInquiries).values({
    id: inquiryIdOf(index),
    userId: userIdOf(userIndex),
    categoryId,
    status,
    statusChangedAt: INQUIRED_AT,
    lastMessageAt: INQUIRED_AT,
    createdAt: INQUIRED_AT,
    updatedAt: INQUIRED_AT,
    deletedAt,
  });
}

async function insertInquiries(
  indexes: readonly number[],
  userIndex: number,
): Promise<void> {
  for (const index of indexes) {
    await insertInquiry(index, { userIndex });
  }
}

interface MessageColumns {
  readonly inquiryIndex: number;
  readonly sentAt: Date;
  readonly adminId?: string;
  readonly fileIndexes?: readonly number[];
}

async function insertMessage(
  index: number,
  { inquiryIndex, sentAt, adminId, fileIndexes = [] }: MessageColumns,
): Promise<void> {
  await db.insert(inquiryMessages).values({
    id: messageIdOf(index),
    inquiryId: inquiryIdOf(inquiryIndex),
    senderKind: adminId === undefined ? 'user' : 'admin',
    adminId: adminId ?? null,
    body: `本文${String(index)}`,
    createdAt: sentAt,
  });
  if (fileIndexes.length > 0) {
    await db.insert(inquiryMessageAttachments).values(
      fileIndexes.map((fileIndex, position) => ({
        messageId: messageIdOf(index),
        fileId: fileIdOf(fileIndex),
        position,
      })),
    );
  }
}

async function insertAttachmentFile(
  index: number,
  originalFileName: string,
  contentType: 'application/pdf' | 'image/png',
  byteSize: number,
): Promise<void> {
  await insertFile(index, {
    ...filePurposeRow(),
    originalFileName,
    contentType,
    byteSize,
  });
}

async function insertActiveAdmin(): Promise<void> {
  await db.insert(admins).values({
    id: ACTIVE_ADMIN_ID,
    email: 'support801@mail.example',
    passwordHash: 'pbkdf2-sha256$test',
    nickname: 'サポート担当A',
    role: 'moderator',
    status: 'active',
    activatedAt: INQUIRED_AT,
    createdAt: INQUIRED_AT,
    updatedAt: INQUIRED_AT,
  });
}

async function clearAdmins(): Promise<void> {
  await db.delete(adminRecoveryCodes);
  await db.delete(adminTotpCredentials);
  await db.delete(adminLoginChallenges);
  await db.delete(adminAuthTokens);
  await db.delete(adminSessions);
  await db.delete(admins);
}

// 標準カテゴリはマイグレーションの初期データで入るため残す
async function clearInquiryTables(): Promise<void> {
  await db.delete(inquiryMessageAttachments);
  await db.delete(inquiryMessages);
  await db.delete(memberInquiries);
  await db
    .delete(inquiryCategories)
    .where(eq(inquiryCategories.systemDefault, false));
}

function createExport(): D1InquiryExport {
  return new D1InquiryExport(
    db,
    new D1AdminDirectory(db),
    createOperations().service,
  );
}

function emptyItemOf(index: number): InquiryExportItem {
  return {
    id: inquiryIdOf(index),
    category: '決済について',
    status: 'open',
    createdAt: INQUIRED_AT.toISOString(),
    messages: [],
  };
}

beforeEach(async () => {
  await clearInquiryTables();
  await clearIdentityTables();
  await clearAdmins();
  await clearMediaState();
  await insertUser(OWNER);
  await insertUser(OTHER_USER);
  await insertCategory(CATEGORY_ID, '決済について');
});

afterEach(() => {
  resetLogging();
});

describe('D1InquiryExport', () => {
  test('本人の論理削除されていない問い合わせを、現在のカテゴリ名・ステータス・送信日時の古い順のメッセージとともに返す', async () => {
    await insertActiveAdmin();
    await insertAttachmentFile(1, 'receipt.pdf', 'application/pdf', 48_213);
    await insertAttachmentFile(2, 'screen.png', 'image/png', 2048);
    await insertAttachmentFile(3, 'admin.pdf', 'application/pdf', 512);
    await insertInquiry(1, { status: 'resolved' });
    await insertInquiry(2, { deletedAt: INQUIRED_AT });
    await insertInquiry(3, { userIndex: OTHER_USER });
    await insertMessage(30, {
      inquiryIndex: 1,
      sentAt: at(0),
      fileIndexes: [2, ERASED_FILE, 1],
    });
    await insertMessage(20, {
      inquiryIndex: 1,
      sentAt: at(9_000_000),
      adminId: ACTIVE_ADMIN_ID,
      fileIndexes: [3],
    });
    await insertMessage(10, {
      inquiryIndex: 1,
      sentAt: at(9_000_000),
      adminId: DELETED_ADMIN_ID,
    });
    await insertMessage(40, { inquiryIndex: 2, sentAt: at(0) });
    await insertMessage(50, { inquiryIndex: 3, sentAt: at(0) });

    const page = await createExport().listPage(userIdOf(OWNER), undefined);

    expect(page).toStrictEqual({
      items: [
        {
          id: inquiryIdOf(1),
          category: '決済について',
          status: 'resolved',
          createdAt: '2026-08-01T10:00:00.123Z',
          messages: [
            {
              id: messageIdOf(30),
              sender: 'user',
              adminNickname: null,
              body: '本文30',
              attachments: [
                {
                  fileId: fileIdOf(2),
                  originalFileName: 'screen.png',
                  contentType: 'image/png',
                  size: 2048,
                },
                {
                  fileId: fileIdOf(1),
                  originalFileName: 'receipt.pdf',
                  contentType: 'application/pdf',
                  size: 48_213,
                },
              ],
              createdAt: '2026-08-01T10:00:00.123Z',
            },
            {
              id: messageIdOf(10),
              sender: 'admin',
              adminNickname: null,
              body: '本文10',
              attachments: [],
              createdAt: '2026-08-01T12:30:00.123Z',
            },
            {
              id: messageIdOf(20),
              sender: 'admin',
              adminNickname: 'サポート担当A',
              body: '本文20',
              attachments: [],
              createdAt: '2026-08-01T12:30:00.123Z',
            },
          ],
        },
      ],
      nextCursor: null,
    });
  });

  test('物理削除済みのファイルの添付を除いた件数を、ファイルのIDだけを属性に入れて警告に残す', async () => {
    const logs = recordLogs('event');
    await insertAttachmentFile(1, 'receipt.pdf', 'application/pdf', 48_213);
    await insertInquiry(1);
    await insertMessage(1, {
      inquiryIndex: 1,
      sentAt: at(0),
      fileIndexes: [ERASED_FILE, 1],
    });

    await createExport().listPage(userIdOf(OWNER), undefined);

    const warnings = logs.filter((log) => log.level === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      category: 'event.inquiry.export',
      missingFileCount: 1,
      missingFileIds: [fileIdOf(ERASED_FILE)],
    });
    expect(JSON.stringify(warnings)).not.toContain(userIdOf(OWNER));
  });

  test('削除されたカテゴリから付け替えられた問い合わせは「その他」を返す', async () => {
    await insertCategory(REMOVED_CATEGORY_ID, '削除するカテゴリ');
    await insertInquiry(1, { categoryId: REMOVED_CATEGORY_ID });
    await db.batch([
      db
        .update(memberInquiries)
        .set({ categoryId: INQUIRY_CATEGORY_OTHER_ID })
        .where(eq(memberInquiries.categoryId, REMOVED_CATEGORY_ID)),
      db
        .delete(inquiryCategories)
        .where(eq(inquiryCategories.id, REMOVED_CATEGORY_ID)),
    ]);

    const page = await createExport().listPage(userIdOf(OWNER), undefined);

    expect(page.items.map((item) => item.category)).toStrictEqual(['その他']);
  });

  test('21件の問い合わせは1回目にIDの昇順で20件と次の位置を返し、2回目に残りの1件を返す', async () => {
    await insertInquiries(rangeOf(1, 21), OWNER);
    await insertInquiries(rangeOf(101, 105), OTHER_USER);
    const inquiryExport = createExport();

    const first = await inquiryExport.listPage(userIdOf(OWNER), undefined);
    const second = await inquiryExport.listPage(
      userIdOf(OWNER),
      first.nextCursor ?? undefined,
    );

    expect(INQUIRY_EXPORT_PAGE_SIZE).toBe(20);
    expect(first).toStrictEqual({
      items: rangeOf(1, 20).map(emptyItemOf),
      nextCursor: inquiryIdOf(20),
    });
    expect(second).toStrictEqual({
      items: [emptyItemOf(21)],
      nextCursor: null,
    });
  });

  test('問い合わせが無ければ空のページを返す', async () => {
    await expect(
      createExport().listPage(userIdOf(OWNER), undefined),
    ).resolves.toStrictEqual({ items: [], nextCursor: null });
  });

  test.each([
    ['空文字', ''],
    ['ULIDより短い値', '01JC0EXPQ'],
    ['ULIDで使わない文字を含む値', '01JC0EXPQ0000000000000000I'],
    ['小文字のULID', inquiryIdOf(1).toLowerCase()],
  ])(
    '次の位置が%sならページの位置の指定の誤り(invalid_cursor)を投げる',
    async (_label, after) => {
      await insertInquiry(1);

      const error = await createExport()
        .listPage(userIdOf(OWNER), after)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        kind: 'bad_request',
        code: 'invalid_cursor',
      });
    },
  );
});
