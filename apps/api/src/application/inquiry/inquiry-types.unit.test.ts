import { describe, expect, test } from 'bun:test';

import { INQUIRY_TYPES } from './inquiry-types.ts';

const PORT_NAMES = [
  'InquiryCategoryStore',
  'GuestInquiryStore',
  'MemberInquiryStore',
  'InquiryStatusStore',
  'InquiryAdminReader',
  'InquirerProfiles',
  'InquiryMailer',
  'InquirySettings',
  'InquiryIncidentReporter',
  'GuestInquiryRateLimit',
] as const;

const USE_CASE_NAMES = [
  'InquiryCategoryService',
  'GuestInquirySubmission',
  'MemberInquirySubmission',
  'InquiryAttachmentBinder',
  'InquiryChatService',
  'InquiryAdminService',
  'InquiryReplyService',
  'InquiryStatusService',
  'GuestInquiryRetentionJob',
] as const;

const MEDIA_POLICY_NAMES = ['InquiryAttachmentReadPolicy'] as const;

const EXPECTED_NAMES = [
  ...PORT_NAMES,
  ...USE_CASE_NAMES,
  ...MEDIA_POLICY_NAMES,
] as const;

describe('INQUIRY_TYPES', () => {
  test('問い合わせのポート・ユースケース・ジョブ・閲覧の方針の識別子だけを持つ', () => {
    expect(Object.keys(INQUIRY_TYPES).toSorted()).toEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のinquiry.<名前>である',
    (name) => {
      expect<symbol>(INQUIRY_TYPES[name]).toBe(Symbol.for(`inquiry.${name}`));
    },
  );

  test('識別子はすべて互いに異なる', () => {
    expect(new Set(Object.values(INQUIRY_TYPES)).size).toBe(
      EXPECTED_NAMES.length,
    );
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(INQUIRY_TYPES)).toBe(true);
  });
});
