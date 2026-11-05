import { describe, expect, expectTypeOf, test } from 'bun:test';

import {
  INQUIRY_STATUSES,
  type InquiryStatus,
} from '../../../common-lib/inquiry/inquiry-status.ts';
import { guestInquiries } from '../../../db/schema/inquiry/guest-inquiries.ts';
import { memberInquiries } from '../../../db/schema/inquiry/member-inquiries.ts';

// 共用部品とドメイン層はDBディレクトリを読み込めないため、テーブル定義に直書きしたステータスの値と共用部品のステータスの一致を、DBのスキーマを読み込めるapplication層で確かめる
describe('問い合わせのテーブル定義のステータスの値の一覧', () => {
  test.each([
    ['ログインの問い合わせ', memberInquiries.status.enumValues],
    ['未ログインの問い合わせ', guestInquiries.status.enumValues],
  ])(
    '%sのステータスの列の値が共用部品のステータスの一覧と同じ順で同じになる',
    (_, enumValues) => {
      expect([...enumValues]).toEqual([...INQUIRY_STATUSES]);
    },
  );

  test('ステータスの列の値の型が共用部品のステータスの型と同じになる', () => {
    expectTypeOf<
      (typeof memberInquiries.status.enumValues)[number]
    >().toEqualTypeOf<InquiryStatus>();
    expectTypeOf<
      (typeof guestInquiries.status.enumValues)[number]
    >().toEqualTypeOf<InquiryStatus>();
  });
});
