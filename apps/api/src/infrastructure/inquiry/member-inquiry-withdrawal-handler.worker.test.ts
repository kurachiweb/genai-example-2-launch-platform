import { beforeEach, describe, expect, test } from 'vitest';

import { INQUIRY_CATEGORY_OTHER_ID } from '../../../common-lib/inquiry/inquiry-category-constants.ts';
import type {
  UserLifecycleEvent,
  UserLifecycleEventType,
} from '../../../lib/core/identity/user-lifecycle.ts';
import {
  clearIdentityTables,
  eventIdOf,
  insertUser,
  userIdOf,
} from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import { MemberInquiryWithdrawalHandler } from './member-inquiry-withdrawal-handler.ts';
import {
  after,
  db,
  insertMemberInquiry,
  memberInquiryIdOf,
  readMemberInquiryRows,
  resetInquiryTables,
  T0,
} from './testing/inquiry-store-fixtures.ts';

const TARGET = 1;

const OTHER = 2;

const AT = after(60_000);

const EARLIER_DELETED_AT = after(1_000);

const OPEN_INQUIRY_ID = memberInquiryIdOf(1);

const RESOLVED_INQUIRY_ID = memberInquiryIdOf(2);

const DELETED_INQUIRY_ID = memberInquiryIdOf(3);

const OTHER_INQUIRY_ID = memberInquiryIdOf(4);

function eventOf(type: UserLifecycleEventType): UserLifecycleEvent {
  return {
    id: eventIdOf(1),
    userId: userIdOf(TARGET),
    type,
    occurredAt: AT,
  };
}

async function readDeletion() {
  const rows = await readMemberInquiryRows();
  return rows.map(({ id, deletedAt, updatedAt }) => ({
    id,
    deletedAt,
    updatedAt,
  }));
}

const UNTOUCHED = [
  { id: OPEN_INQUIRY_ID, deletedAt: null, updatedAt: T0 },
  { id: RESOLVED_INQUIRY_ID, deletedAt: null, updatedAt: T0 },
  { id: DELETED_INQUIRY_ID, deletedAt: EARLIER_DELETED_AT, updatedAt: T0 },
  { id: OTHER_INQUIRY_ID, deletedAt: null, updatedAt: T0 },
];

const WITHDRAWN = [
  { id: OPEN_INQUIRY_ID, deletedAt: AT, updatedAt: AT },
  { id: RESOLVED_INQUIRY_ID, deletedAt: AT, updatedAt: AT },
  { id: DELETED_INQUIRY_ID, deletedAt: EARLIER_DELETED_AT, updatedAt: T0 },
  { id: OTHER_INQUIRY_ID, deletedAt: null, updatedAt: T0 },
];

beforeEach(async () => {
  await resetInquiryTables();
  await clearIdentityTables();
  await insertUser(TARGET);
  await insertUser(OTHER);
  const categoryId = INQUIRY_CATEGORY_OTHER_ID;
  await insertMemberInquiry(1, { categoryId }, TARGET);
  await insertMemberInquiry(2, { categoryId, status: 'resolved' }, TARGET);
  await insertMemberInquiry(
    3,
    { categoryId, deletedAt: EARLIER_DELETED_AT },
    TARGET,
  );
  await insertMemberInquiry(4, { categoryId }, OTHER);
});

describe('MemberInquiryWithdrawalHandler', () => {
  describe('statementsFor', () => {
    test('退会では1文を返し、実行すると利用者の未削除の問い合わせだけに退会の日時で論理削除の日時を入れる', async () => {
      const statements =
        await new MemberInquiryWithdrawalHandler().statementsFor(
          eventOf('withdrawn'),
          db,
        );

      expect(statements).toHaveLength(1);
      await expect(readDeletion()).resolves.toEqual(UNTOUCHED);

      const [statement] = statements;
      if (statement === undefined) {
        throw new Error('文が返されませんでした');
      }
      await db.batch([statement]);

      await expect(readDeletion()).resolves.toEqual(WITHDRAWN);
    });

    test.each(['suspended', 'unsuspended', 'purge_due'] as const)(
      '%sでは文を返さない',
      async (type) => {
        const statements =
          await new MemberInquiryWithdrawalHandler().statementsFor(
            eventOf(type),
            db,
          );

        expect(statements).toEqual([]);
        await expect(readDeletion()).resolves.toEqual(UNTOUCHED);
      },
    );
  });
});
