import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, test } from 'vitest';

import { INQUIRY_STATUS_CHANGE_ACTION } from '../../../common-lib/admin/audit-actions/inquiry-chat.ts';
import { INQUIRY_CATEGORY_OTHER_ID } from '../../../common-lib/inquiry/inquiry-category-constants.ts';
import type {
  InquiryKind,
  InquiryStatus,
} from '../../../common-lib/inquiry/inquiry-status.ts';
import { createDatabase } from '../../../db/client.ts';
import type { PreparedAuditEntry } from '../../../lib/core/admin/audit-log.ts';
import {
  clearIdentityTables,
  insertUser,
} from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import { createBatchRecordingD1 } from '../../../test/support/batch-recording-d1.ts';
import type {
  InquiryStatusStore,
  InquiryStatusTarget,
} from '../../application/inquiry/ports.ts';
import { isAuditGuardRejection } from '../admin/audit-log-statements.ts';
import { D1InquiryStatusStore } from './d1-inquiry-status-store.ts';
import {
  after,
  auditLogIdOf,
  db,
  guestInquiryIdOf,
  insertGuestInquiry,
  insertMemberInquiry,
  memberInquiryIdOf,
  OPERATOR_ADMIN_ID,
  preparedAuditEntryOf,
  readAuditLogs,
  readGuestInquiryRows,
  readMemberInquiryRows,
  resetInquiryTables,
  T0,
} from './testing/inquiry-store-fixtures.ts';

const MEMBER_INQUIRY_ID = memberInquiryIdOf(1);

const GUEST_INQUIRY_ID = guestInquiryIdOf(1);

const CHANGED_AT = after(500);

function createStore(): InquiryStatusStore {
  return new D1InquiryStatusStore(db);
}

function createRecordingStore() {
  const recording = createBatchRecordingD1(env.DB);
  return {
    recording,
    store: new D1InquiryStatusStore(createDatabase(recording.d1)),
  };
}

function targetOf(
  kind: InquiryKind,
  status: InquiryStatus = 'open',
): InquiryStatusTarget {
  return {
    kind,
    id: kind === 'member' ? MEMBER_INQUIRY_ID : GUEST_INQUIRY_ID,
    status,
    withdrawn: false,
  };
}

function statusChangeAuditOf(
  index: number,
  target: InquiryStatusTarget,
  next: InquiryStatus,
): PreparedAuditEntry {
  return preparedAuditEntryOf(index, {
    action: INQUIRY_STATUS_CHANGE_ACTION.name,
    targetKind: 'inquiry',
    targetIds: [target.id],
    detail: { kind: target.kind, fromStatus: target.status, toStatus: next },
    occurredAt: CHANGED_AT,
  });
}

async function readMemberRow() {
  const rows = await readMemberInquiryRows();
  return rows.find((row) => row.id === MEMBER_INQUIRY_ID);
}

async function readGuestRow() {
  const rows = await readGuestInquiryRows();
  return rows.find((row) => row.id === GUEST_INQUIRY_ID);
}

async function rejectionOf(write: Promise<unknown>): Promise<unknown> {
  try {
    await write;
  } catch (error) {
    return error;
  }
  return undefined;
}

beforeEach(async () => {
  await resetInquiryTables();
  await clearIdentityTables();
  await insertUser(1);
  await insertMemberInquiry(1, {
    categoryId: INQUIRY_CATEGORY_OTHER_ID,
    statusChangedAt: after(1),
  });
  await insertGuestInquiry(1, {
    categoryId: INQUIRY_CATEGORY_OTHER_ID,
    statusChangedAt: after(1),
  });
});

describe('D1InquiryStatusStore', () => {
  describe('change', () => {
    test('ログインの問い合わせのステータスと変更日時を、監査ログとともに1つの一括の書き込みで変更する', async () => {
      const target = targetOf('member');
      const { recording, store } = createRecordingStore();

      const result = await store.change(
        target,
        'in_progress',
        CHANGED_AT,
        statusChangeAuditOf(1, target, 'in_progress'),
      );

      expect(result).toBe('changed');
      expect(recording.batches).toHaveLength(1);
      expect(recording.statementsOutsideBatches()).toEqual([]);
      await expect(readMemberRow()).resolves.toEqual(
        expect.objectContaining({
          status: 'in_progress',
          statusChangedAt: CHANGED_AT,
          updatedAt: CHANGED_AT,
          lastMessageAt: T0,
        }),
      );
      await expect(readGuestRow()).resolves.toEqual(
        expect.objectContaining({ status: 'open', statusChangedAt: after(1) }),
      );
      await expect(readAuditLogs()).resolves.toEqual([
        {
          id: auditLogIdOf(1),
          operatorAdminId: OPERATOR_ADMIN_ID,
          action: INQUIRY_STATUS_CHANGE_ACTION.name,
          targetKind: 'inquiry',
          detail: {
            kind: 'member',
            fromStatus: 'open',
            toStatus: 'in_progress',
          },
          targetIds: [MEMBER_INQUIRY_ID],
        },
      ]);
    });

    test('未ログインの問い合わせのステータスと変更日時を、監査ログとともに1つの一括の書き込みで変更する', async () => {
      const target = targetOf('guest');
      const { recording, store } = createRecordingStore();

      const result = await store.change(
        target,
        'resolved',
        CHANGED_AT,
        statusChangeAuditOf(1, target, 'resolved'),
      );

      expect(result).toBe('changed');
      expect(recording.batches).toHaveLength(1);
      expect(recording.statementsOutsideBatches()).toEqual([]);
      await expect(readGuestRow()).resolves.toEqual(
        expect.objectContaining({
          status: 'resolved',
          statusChangedAt: CHANGED_AT,
          updatedAt: CHANGED_AT,
        }),
      );
      await expect(readMemberRow()).resolves.toEqual(
        expect.objectContaining({ status: 'open', statusChangedAt: after(1) }),
      );
      await expect(readAuditLogs()).resolves.toEqual([
        expect.objectContaining({
          id: auditLogIdOf(1),
          detail: { kind: 'guest', fromStatus: 'open', toStatus: 'resolved' },
          targetIds: [GUEST_INQUIRY_ID],
        }),
      ]);
    });

    test.each([['member'], ['guest']] as const)(
      '%sの問い合わせで読み取った後にステータスが変わっていたら、監査ログごと取り消してconflictを返す',
      async (kind: InquiryKind) => {
        const target = targetOf(kind, 'in_progress');
        const before = {
          member: await readMemberRow(),
          guest: await readGuestRow(),
        };

        const result = await createStore().change(
          target,
          'resolved',
          CHANGED_AT,
          statusChangeAuditOf(1, target, 'resolved'),
        );

        expect(result).toBe('conflict');
        await expect(readMemberRow()).resolves.toEqual(before.member);
        await expect(readGuestRow()).resolves.toEqual(before.guest);
        await expect(readAuditLogs()).resolves.toEqual([]);
      },
    );

    test('同じ値から同時に変更すると一方だけが確定し、もう一方はconflictになる', async () => {
      const target = targetOf('member');
      const store = createStore();

      const results = await Promise.all([
        store.change(
          target,
          'in_progress',
          CHANGED_AT,
          statusChangeAuditOf(1, target, 'in_progress'),
        ),
        store.change(
          target,
          'rejected',
          CHANGED_AT,
          statusChangeAuditOf(2, target, 'rejected'),
        ),
      ]);

      expect(results.toSorted()).toEqual(['changed', 'conflict']);
      const logs = await readAuditLogs();
      expect(logs).toHaveLength(1);
      const [log] = logs;
      await expect(readMemberRow()).resolves.toEqual(
        expect.objectContaining({ status: log?.detail['toStatus'] }),
      );
    });

    test('退会により論理削除したログインの問い合わせは、読み取った時点のステータスのままでも監査ログごと取り消してconflictを返す', async () => {
      await resetInquiryTables();
      await insertMemberInquiry(1, {
        categoryId: INQUIRY_CATEGORY_OTHER_ID,
        statusChangedAt: after(1),
        deletedAt: after(2),
      });
      const before = await readMemberRow();
      const target = targetOf('member');

      const result = await createStore().change(
        target,
        'in_progress',
        CHANGED_AT,
        statusChangeAuditOf(1, target, 'in_progress'),
      );

      expect(result).toBe('conflict');
      await expect(readMemberRow()).resolves.toEqual(before);
      await expect(readAuditLogs()).resolves.toEqual([]);
    });

    test('無い問い合わせと、種別の異なるテーブルの問い合わせはconflictを返し、何も残さない', async () => {
      const store = createStore();
      const missing: InquiryStatusTarget = {
        kind: 'guest',
        id: guestInquiryIdOf(9),
        status: 'open',
        withdrawn: false,
      };
      const wrongKind: InquiryStatusTarget = {
        kind: 'guest',
        id: MEMBER_INQUIRY_ID,
        status: 'open',
        withdrawn: false,
      };

      await expect(
        store.change(
          missing,
          'resolved',
          CHANGED_AT,
          statusChangeAuditOf(1, missing, 'resolved'),
        ),
      ).resolves.toBe('conflict');
      await expect(
        store.change(
          wrongKind,
          'resolved',
          CHANGED_AT,
          statusChangeAuditOf(2, wrongKind, 'resolved'),
        ),
      ).resolves.toBe('conflict');
      await expect(readMemberRow()).resolves.toEqual(
        expect.objectContaining({ status: 'open' }),
      );
      await expect(readAuditLogs()).resolves.toEqual([]);
    });

    test('監査ログの条件による取り消し以外の失敗は、そのまま投げて何も残さない', async () => {
      const target = targetOf('member');
      const store = createStore();
      await store.change(
        target,
        'in_progress',
        CHANGED_AT,
        statusChangeAuditOf(1, target, 'in_progress'),
      );
      const reverted = targetOf('member', 'in_progress');

      const error = await rejectionOf(
        store.change(
          reverted,
          'open',
          after(600),
          statusChangeAuditOf(1, reverted, 'open'),
        ),
      );

      expect(error).toBeInstanceOf(Error);
      expect(isAuditGuardRejection(error)).toBe(false);
      await expect(readMemberRow()).resolves.toEqual(
        expect.objectContaining({
          status: 'in_progress',
          statusChangedAt: CHANGED_AT,
        }),
      );
      await expect(readAuditLogs()).resolves.toHaveLength(1);
    });
  });
});
