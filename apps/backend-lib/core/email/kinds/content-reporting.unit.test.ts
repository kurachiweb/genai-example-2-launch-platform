import { describe, expect, test } from 'bun:test';

import {
  INQUIRY_MESSAGE_MAX,
  REPORT_ADMIN_REASON_MAX,
  REPORT_NOTICE_EXCERPT_MAX,
} from '../../../../common-lib/reporting/report-case-rules.ts';
import {
  REPORT_EMAIL_KINDS,
  REPORT_INFRINGEMENT_INQUIRY_EMAIL,
  REPORT_OUTCOME_EMAIL,
  REPORT_REJECTION_TO_POSTER_EMAIL,
} from './content-reporting.ts';
import { EMAIL_KINDS } from './index.ts';

const CONTACT_URL = 'https://client.example/contact';

const OUTCOME_FIELDS = {
  recipientName: '佐藤 たろう',
  outcome: 'resolved' as const,
  targetKind: 'comment' as const,
  targetLabel: 'Pitch Notes',
  excerpt: 'このプロダクトは最低です',
  reason: '他の利用者を中傷する内容のため、コメントを非公開にしました',
  decidedAt: '2026-11-20T07:40:00.000Z',
  contactUrl: CONTACT_URL,
};

const REJECTION_FIELDS = {
  nickname: '山田 はなこ',
  targetKind: 'product' as const,
  targetLabel: 'Pitch Notes',
  excerpt: null,
  reason: '利用規約に反する内容は見当たりませんでした',
  decidedAt: '2026-11-20T07:40:00.000Z',
  contactUrl: CONTACT_URL,
};

const INQUIRY_FIELDS = {
  nickname: '山田 はなこ',
  targetKind: 'product' as const,
  targetLabel: 'Pitch Notes',
  excerpt: null,
  targetUrl: 'https://client.example/p/pitch-notes',
  message: '掲載の画像が第三者の著作物であるとの申出がありました',
  sentAt: '2026-11-20T07:40:00.000Z',
  deadline: '2026-11-27T07:40:00.000Z',
  contactUrl: CONTACT_URL,
};

const KINDS = [
  [
    'content-reporting.report-outcome',
    REPORT_OUTCOME_EMAIL,
    OUTCOME_FIELDS,
    ['decidedAt'],
  ],
  [
    'content-reporting.rejection-to-poster',
    REPORT_REJECTION_TO_POSTER_EMAIL,
    REJECTION_FIELDS,
    ['decidedAt'],
  ],
  [
    'content-reporting.infringement-inquiry',
    REPORT_INFRINGEMENT_INQUIRY_EMAIL,
    INQUIRY_FIELDS,
    ['sentAt', 'deadline'],
  ],
] as const;

const REPORTER_FIELDS = {
  reporterUserId: '01JBX3M5Q4ZQ7Y8W9V0T1S2R3P',
  reporterNickname: '佐藤 たろう',
  reporterHandle: 'sato',
  reporterEmail: 'reporter@mail.example',
  contactEmail: 'guest@mail.example',
  reporterReason: '私の写真が無断で使われています',
  reportReason: '私の写真が無断で使われています',
};

const INVALID_TEXTS = ['', undefined, null, 1];

const INVALID_DATE_TIMES = [
  '',
  '2026-11-20',
  '2026-11-20 07:40:00',
  '2026-11-20T07:40:00+09:00',
  '2026-13-20T07:40:00.000Z',
  new Date('2026-11-20T07:40:00.000Z'),
  undefined,
  null,
];

const INVALID_URLS = [
  '',
  'http://client.example/contact',
  'javascript:alert(1)',
  '/contact',
  undefined,
];

describe('通報のメール種別の集約', () => {
  test('申出者への対応結果・投稿者への却下・権利侵害の照会の3種を凍結して持つ', () => {
    expect(REPORT_EMAIL_KINDS).toEqual([
      REPORT_OUTCOME_EMAIL,
      REPORT_REJECTION_TO_POSTER_EMAIL,
      REPORT_INFRINGEMENT_INQUIRY_EMAIL,
    ]);
    expect(Object.isFrozen(REPORT_EMAIL_KINDS)).toBe(true);
  });

  test('全種別の集約点に載る本specの種別は3種だけである', () => {
    expect(
      EMAIL_KINDS.filter((kind) => kind.name.startsWith('content-reporting.')),
    ).toEqual([...REPORT_EMAIL_KINDS]);
  });
});

describe.each(KINDS)('メール種別%s', (name, kind, fields, dateKeys) => {
  function accepts(input: unknown): boolean {
    return kind.inputSchema.safeParse(input).success;
  }

  function fieldsWith(key: string, value: unknown): unknown {
    return { ...fields, [key]: value };
  }

  test('トランザクションメールの凍結した種別である', () => {
    expect(kind.name).toBe(name);
    expect(kind.category).toBe('transactional');
    expect(Object.isFrozen(kind)).toBe(true);
  });

  test('入力の項目を受け付け、宛先などの他の項目を取り除く', () => {
    const result = kind.inputSchema.safeParse({
      ...fields,
      to: 'someone@mail.example',
      userId: '01JBX3M5Q4ZQ7Y8W9V0T1S2R3P',
    });

    expect(result).toEqual({ success: true, data: fields });
  });

  test('検証した結果をもう一度検証しても同じ値になる', () => {
    const first = kind.inputSchema.parse(fields);

    expect(kind.inputSchema.parse(first)).toEqual(first);
  });

  test.each(['user', 'product', 'comment'])(
    '対象の種類%sを受け付ける',
    (targetKind) => {
      expect(accepts(fieldsWith('targetKind', targetKind))).toBe(true);
    },
  );

  test.each(['', 'rating', 'USER', undefined, null])(
    '対象の種類%pを拒否する',
    (targetKind) => {
      expect(accepts(fieldsWith('targetKind', targetKind))).toBe(false);
    },
  );

  test('対象の表示名が無いとき(対象が引けないとき)はnullで受け付ける', () => {
    expect(accepts(fieldsWith('targetLabel', null))).toBe(true);
  });

  test.each(['', undefined, 1])('対象の表示名%pを拒否する', (targetLabel) => {
    expect(accepts(fieldsWith('targetLabel', targetLabel))).toBe(false);
  });

  test(`抜粋は${String(REPORT_NOTICE_EXCERPT_MAX)}書記素まで受け付け、絵文字も1文字として数え、nullも受け付ける`, () => {
    expect(
      accepts(fieldsWith('excerpt', 'あ'.repeat(REPORT_NOTICE_EXCERPT_MAX))),
    ).toBe(true);
    expect(
      accepts(fieldsWith('excerpt', '👍🏽'.repeat(REPORT_NOTICE_EXCERPT_MAX))),
    ).toBe(true);
    expect(accepts(fieldsWith('excerpt', null))).toBe(true);
    expect(
      accepts(
        fieldsWith('excerpt', 'あ'.repeat(REPORT_NOTICE_EXCERPT_MAX + 1)),
      ),
    ).toBe(false);
  });

  test.each(['', undefined, 1])('抜粋%pを拒否する', (excerpt) => {
    expect(accepts(fieldsWith('excerpt', excerpt))).toBe(false);
  });

  test.each(dateKeys)('日時%sはUTCのISO 8601の文字列で受け付ける', (key) => {
    expect(accepts(fieldsWith(key, '2026-11-20T07:40:00Z'))).toBe(true);
  });

  test.each(
    dateKeys.flatMap((key) =>
      INVALID_DATE_TIMES.map((value) => [key, value] as const),
    ),
  )('日時%sの%pを拒否する', (key, value) => {
    expect(accepts(fieldsWith(key, value))).toBe(false);
  });

  test.each([
    'https://client.example/contact',
    'http://localhost:48044/contact',
  ])('問い合わせのURL%sを受け付ける', (url) => {
    expect(accepts(fieldsWith('contactUrl', url))).toBe(true);
  });

  test.each(INVALID_URLS)('問い合わせのURL%pを拒否する', (url) => {
    expect(accepts(fieldsWith('contactUrl', url))).toBe(false);
  });
});

describe.each([
  ['content-reporting.report-outcome', REPORT_OUTCOME_EMAIL, OUTCOME_FIELDS],
  [
    'content-reporting.rejection-to-poster',
    REPORT_REJECTION_TO_POSTER_EMAIL,
    REJECTION_FIELDS,
  ],
] as const)('メール種別%sの管理者の理由', (_name, kind, fields) => {
  function accepts(reason: unknown): boolean {
    return kind.inputSchema.safeParse({ ...fields, reason }).success;
  }

  test('改行を含む理由をそのまま受け付ける', () => {
    const reason = '1行目の理由\n2行目の理由';

    expect(kind.inputSchema.parse({ ...fields, reason })).toEqual({
      ...fields,
      reason,
    });
  });

  test(`理由は${String(REPORT_ADMIN_REASON_MAX)}書記素まで受け付け、絵文字も1文字として数える`, () => {
    expect(accepts('あ'.repeat(REPORT_ADMIN_REASON_MAX))).toBe(true);
    expect(accepts('👨‍👩‍👧'.repeat(REPORT_ADMIN_REASON_MAX))).toBe(true);
    expect(accepts('あ'.repeat(REPORT_ADMIN_REASON_MAX + 1))).toBe(false);
  });

  test.each([...INVALID_TEXTS, ' ', '\n\t'])('理由%pを拒否する', (reason) => {
    expect(accepts(reason)).toBe(false);
  });
});

describe('メール種別content-reporting.report-outcomeの宛名と結果', () => {
  function accepts(input: unknown): boolean {
    return REPORT_OUTCOME_EMAIL.inputSchema.safeParse(input).success;
  }

  test('未ログインの申出者は宛名をnullで受け付ける', () => {
    expect(
      REPORT_OUTCOME_EMAIL.inputSchema.parse({
        ...OUTCOME_FIELDS,
        recipientName: null,
      }),
    ).toEqual({ ...OUTCOME_FIELDS, recipientName: null });
  });

  test.each(['', undefined, 1])('宛名%pを拒否する', (recipientName) => {
    expect(accepts({ ...OUTCOME_FIELDS, recipientName })).toBe(false);
  });

  test.each(['resolved', 'rejected'])('結果%sを受け付ける', (outcome) => {
    expect(accepts({ ...OUTCOME_FIELDS, outcome })).toBe(true);
  });

  test.each(['open', 'in_progress', '', undefined])(
    '結果%pを拒否する',
    (outcome) => {
      expect(accepts({ ...OUTCOME_FIELDS, outcome })).toBe(false);
    },
  );
});

describe.each([
  [
    'content-reporting.rejection-to-poster',
    REPORT_REJECTION_TO_POSTER_EMAIL,
    REJECTION_FIELDS,
  ],
  [
    'content-reporting.infringement-inquiry',
    REPORT_INFRINGEMENT_INQUIRY_EMAIL,
    INQUIRY_FIELDS,
  ],
] as const)('投稿者向けのメール種別%s', (_name, kind, fields) => {
  test.each(INVALID_TEXTS)('ニックネーム%pを拒否する', (nickname) => {
    expect(kind.inputSchema.safeParse({ ...fields, nickname }).success).toBe(
      false,
    );
  });

  test('申出者を特定できる情報と申出者の理由を入力に持たない', () => {
    const parsed = kind.inputSchema.parse({ ...fields, ...REPORTER_FIELDS });

    expect(parsed).toEqual(fields);
    expect(Object.keys(parsed as object)).not.toContain('recipientName');
  });
});

describe('メール種別content-reporting.infringement-inquiryの照会', () => {
  function accepts(input: unknown): boolean {
    return REPORT_INFRINGEMENT_INQUIRY_EMAIL.inputSchema.safeParse(input)
      .success;
  }

  test('改行を含む照会の内容をそのまま受け付ける', () => {
    const message = '1行目の照会\n2行目の照会';

    expect(
      REPORT_INFRINGEMENT_INQUIRY_EMAIL.inputSchema.parse({
        ...INQUIRY_FIELDS,
        message,
      }),
    ).toEqual({ ...INQUIRY_FIELDS, message });
  });

  test(`照会の内容は${String(INQUIRY_MESSAGE_MAX)}書記素まで受け付け、絵文字も1文字として数える`, () => {
    expect(
      accepts({ ...INQUIRY_FIELDS, message: 'あ'.repeat(INQUIRY_MESSAGE_MAX) }),
    ).toBe(true);
    expect(
      accepts({
        ...INQUIRY_FIELDS,
        message: '👨‍👩‍👧'.repeat(INQUIRY_MESSAGE_MAX),
      }),
    ).toBe(true);
    expect(
      accepts({
        ...INQUIRY_FIELDS,
        message: 'あ'.repeat(INQUIRY_MESSAGE_MAX + 1),
      }),
    ).toBe(false);
  });

  test.each([...INVALID_TEXTS, ' ', '\n\t'])(
    '照会の内容%pを拒否する',
    (message) => {
      expect(accepts({ ...INQUIRY_FIELDS, message })).toBe(false);
    },
  );

  test.each([
    'https://client.example/p/pitch-notes',
    'https://client.example/@hanako',
    'http://localhost:48044/p/pitch-notes',
  ])('対象のURL%sを受け付ける', (targetUrl) => {
    expect(accepts({ ...INQUIRY_FIELDS, targetUrl })).toBe(true);
  });

  test.each([...INVALID_URLS, null])('対象のURL%pを拒否する', (targetUrl) => {
    expect(accepts({ ...INQUIRY_FIELDS, targetUrl })).toBe(false);
  });

  test('管理者の理由を入力に持たない', () => {
    expect(
      REPORT_INFRINGEMENT_INQUIRY_EMAIL.inputSchema.parse({
        ...INQUIRY_FIELDS,
        reason: '照会の理由',
      }),
    ).toEqual(INQUIRY_FIELDS);
  });
});
