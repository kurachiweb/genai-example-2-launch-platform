import { describe, expect, test } from 'bun:test';

import { INQUIRY_REPLY_NOTIFICATION_KIND } from './inquiry.ts';

const FIELDS = {
  nickname: '山田',
  inquiryUrl: 'https://client.example/inquiries/01JBX3M5Q4ZQ7Y8W9V0T1S2R3P',
  repliedAt: '2026-11-02T07:40:00.000Z',
} as const;

function withField(key: string, value: unknown): Record<string, unknown> {
  return { ...FIELDS, [key]: value };
}

describe('メール種別inquiry.reply-notification', () => {
  test('トランザクションメールの凍結した種別である', () => {
    expect(INQUIRY_REPLY_NOTIFICATION_KIND.name).toBe(
      'inquiry.reply-notification',
    );
    expect(INQUIRY_REPLY_NOTIFICATION_KIND.category).toBe('transactional');
    expect(Object.isFrozen(INQUIRY_REPLY_NOTIFICATION_KIND)).toBe(true);
  });

  test('ニックネーム・チャットページのURL・返信の日時を受け付け、返信の本文などの他の項目を取り除く', () => {
    const result = INQUIRY_REPLY_NOTIFICATION_KIND.inputSchema.safeParse({
      ...FIELDS,
      body: '返信の本文',
      to: 'someone@mail.example',
    });

    expect(result).toEqual({ success: true, data: FIELDS });
  });

  test('検証した結果をもう一度検証しても同じ値になる', () => {
    const first = INQUIRY_REPLY_NOTIFICATION_KIND.inputSchema.parse(FIELDS);

    expect(INQUIRY_REPLY_NOTIFICATION_KIND.inputSchema.parse(first)).toEqual(
      first,
    );
  });

  test.each(['', undefined, null, 1])(
    'ニックネーム%pを拒否する',
    (nickname) => {
      expect(
        INQUIRY_REPLY_NOTIFICATION_KIND.inputSchema.safeParse(
          withField('nickname', nickname),
        ).success,
      ).toBe(false);
    },
  );

  test.each([
    'https://client.example/inquiries/01JBX3M5Q4ZQ7Y8W9V0T1S2R3P',
    'http://localhost:48044/inquiries/01JBX3M5Q4ZQ7Y8W9V0T1S2R3P',
  ])('チャットページのURL%sを受け付ける', (url) => {
    expect(
      INQUIRY_REPLY_NOTIFICATION_KIND.inputSchema.safeParse(
        withField('inquiryUrl', url),
      ).success,
    ).toBe(true);
  });

  test.each([
    '',
    'client.example/inquiries/1',
    'http://client.example/inquiries/1',
    'http://localhost.client.example/inquiries/1',
    'javascript:alert(1)',
    '/inquiries/1',
    1,
    undefined,
  ])('https:かhttp://localhostで始まらないURL%pを拒否する', (url) => {
    expect(
      INQUIRY_REPLY_NOTIFICATION_KIND.inputSchema.safeParse(
        withField('inquiryUrl', url),
      ).success,
    ).toBe(false);
  });

  test.each([
    '',
    '2026-11-02',
    '2026-11-02T16:40:00+09:00',
    '2026-13-01T00:00:00Z',
    '明日',
    1_793_000_000_000,
    new Date(FIELDS.repliedAt),
    undefined,
  ])('返信の日時がUTCのISO 8601形式でない入力%pを拒否する', (repliedAt) => {
    expect(
      INQUIRY_REPLY_NOTIFICATION_KIND.inputSchema.safeParse(
        withField('repliedAt', repliedAt),
      ).success,
    ).toBe(false);
  });
});
