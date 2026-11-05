import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { INQUIRY_CATEGORY_OTHER_ID } from '../../../common-lib/inquiry/inquiry-category-constants.ts';
import type { InquiryStatus } from '../../../common-lib/inquiry/inquiry-status.ts';
import { guestInquiries } from '../../../db/schema/inquiry/guest-inquiries.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import type {
  GuestInquiryStore,
  NewGuestInquiry,
} from '../../application/inquiry/ports.ts';
import { D1GuestInquiryStore } from './d1-guest-inquiry-store.ts';
import {
  after,
  categoryIdOf,
  db,
  guestInquiryIdOf,
  insertCategory,
  insertGuestInquiry,
  readGuestInquiryRows,
  resetInquiryTables,
  T0,
} from './testing/inquiry-store-fixtures.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

function createStore(): GuestInquiryStore {
  return new D1GuestInquiryStore(db);
}

function newInquiryOf(columns: Partial<NewGuestInquiry> = {}): NewGuestInquiry {
  return {
    id: guestInquiryIdOf(1),
    categoryId: INQUIRY_CATEGORY_OTHER_ID,
    nickname: '  ゲスト  ',
    email: 'guest@mail.example',
    body: '  ログインできません。\n手順を書きます。  ',
    at: after(5),
    ...columns,
  };
}

async function rejectionOf(write: Promise<unknown>): Promise<unknown> {
  try {
    await write;
  } catch (error) {
    return error;
  }
  return undefined;
}

async function remainingIds(): Promise<string[]> {
  return (await readGuestInquiryRows()).map((row) => row.id);
}

beforeEach(async () => {
  await resetInquiryTables();
});

describe('D1GuestInquiryStore', () => {
  describe('insert', () => {
    test('入力の値を変えずに、未対応で受付日時をステータスの変更日時として保存する', async () => {
      await createStore().insert(newInquiryOf());

      await expect(readGuestInquiryRows()).resolves.toEqual([
        {
          id: guestInquiryIdOf(1),
          categoryId: INQUIRY_CATEGORY_OTHER_ID,
          nickname: '  ゲスト  ',
          email: 'guest@mail.example',
          body: '  ログインできません。\n手順を書きます。  ',
          status: 'open',
          statusChangedAt: after(5),
          createdAt: after(5),
          updatedAt: after(5),
        },
      ]);
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
      await expect(readGuestInquiryRows()).resolves.toEqual([]);
    });

    test('カテゴリの不在以外の失敗はそのまま投げる', async () => {
      await createStore().insert(newInquiryOf());

      const error = await rejectionOf(createStore().insert(newInquiryOf()));

      expect(error).not.toBeInstanceOf(AppError);
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('deleteClosedBefore', () => {
    const THRESHOLD = new Date(T0.getTime() + 20 * DAY_MS);

    async function seedClosedAround(
      status: InquiryStatus,
      firstIndex: number,
    ): Promise<void> {
      await insertGuestInquiry(firstIndex, {
        categoryId: INQUIRY_CATEGORY_OTHER_ID,
        status,
        statusChangedAt: new Date(THRESHOLD.getTime() - 1),
      });
      await insertGuestInquiry(firstIndex + 1, {
        categoryId: INQUIRY_CATEGORY_OTHER_ID,
        status,
        statusChangedAt: THRESHOLD,
      });
      await insertGuestInquiry(firstIndex + 2, {
        categoryId: INQUIRY_CATEGORY_OTHER_ID,
        status,
        statusChangedAt: new Date(THRESHOLD.getTime() + 1),
      });
    }

    test('対応済・却下で変更日時が閾値ちょうどか前の行だけを消し、閾値より後の行を残す', async () => {
      await seedClosedAround('resolved', 1);
      await seedClosedAround('rejected', 4);

      const deleted = await createStore().deleteClosedBefore(THRESHOLD, 500);

      expect(deleted).toBe(4);
      await expect(remainingIds()).resolves.toEqual([
        guestInquiryIdOf(3),
        guestInquiryIdOf(6),
      ]);
    });

    test('未対応・対応中の行は、変更日時が閾値より前でも消さない', async () => {
      await seedClosedAround('open', 1);
      await seedClosedAround('in_progress', 4);

      const deleted = await createStore().deleteClosedBefore(THRESHOLD, 500);

      expect(deleted).toBe(0);
      await expect(remainingIds()).resolves.toHaveLength(6);
    });

    test('対応済から対応中へ戻した行は、対応済にした日時が閾値より前でも消さない', async () => {
      await insertGuestInquiry(1, {
        categoryId: INQUIRY_CATEGORY_OTHER_ID,
        status: 'resolved',
        statusChangedAt: new Date(THRESHOLD.getTime() - 15 * DAY_MS),
      });
      await insertGuestInquiry(2, {
        categoryId: INQUIRY_CATEGORY_OTHER_ID,
        status: 'resolved',
        statusChangedAt: new Date(THRESHOLD.getTime() - 15 * DAY_MS),
      });
      await db
        .update(guestInquiries)
        .set({ status: 'in_progress', statusChangedAt: THRESHOLD })
        .where(eq(guestInquiries.id, guestInquiryIdOf(2)));

      const deleted = await createStore().deleteClosedBefore(THRESHOLD, 500);

      expect(deleted).toBe(1);
      await expect(remainingIds()).resolves.toEqual([guestInquiryIdOf(2)]);
    });

    test('上限の件数まで変更日時の古い順に消し、繰り返すと残りを消して0件になる', async () => {
      await insertCategory(1, 'Billing');
      for (const index of [1, 2, 3]) {
        await insertGuestInquiry(index, {
          categoryId: categoryIdOf(1),
          status: 'resolved',
          statusChangedAt: new Date(THRESHOLD.getTime() - (4 - index) * DAY_MS),
        });
      }
      const store = createStore();

      await expect(store.deleteClosedBefore(THRESHOLD, 2)).resolves.toBe(2);
      await expect(remainingIds()).resolves.toEqual([guestInquiryIdOf(3)]);
      await expect(store.deleteClosedBefore(THRESHOLD, 2)).resolves.toBe(1);
      await expect(store.deleteClosedBefore(THRESHOLD, 2)).resolves.toBe(0);
      await expect(remainingIds()).resolves.toEqual([]);
    });
  });
});
