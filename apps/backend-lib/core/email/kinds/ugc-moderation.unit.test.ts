import { describe, expect, test } from 'bun:test';

import {
  MODERATION_REASON_MAX,
  NOTICE_EXCERPT_MAX,
} from '../../../../common-lib/moderation/moderation-actions.ts';
import { EMAIL_KINDS } from './index.ts';
import {
  MODERATION_COMMENT_HIDDEN_EMAIL,
  MODERATION_EMAIL_KINDS,
  MODERATION_PRODUCT_HIDDEN_EMAIL,
  MODERATION_USER_SUSPENDED_EMAIL,
} from './ugc-moderation.ts';

const CONTACT_URL = 'https://client.example/contact';

const SUSPENDED_FIELDS = {
  nickname: '山田 はなこ',
  reason: '利用規約に反する投稿を繰り返したため',
  suspendedAt: '2026-11-20T07:40:00.000Z',
  contactUrl: CONTACT_URL,
};

const PRODUCT_HIDDEN_FIELDS = {
  nickname: '山田 はなこ',
  productName: 'Pitch Notes',
  reason: '説明文に第三者の権利を侵害する内容が含まれるため',
  hiddenAt: '2026-11-20T07:40:00.000Z',
  contactUrl: CONTACT_URL,
};

const COMMENT_HIDDEN_FIELDS = {
  ...PRODUCT_HIDDEN_FIELDS,
  excerpt: 'このプロダクトは最高です',
  reason: '他の利用者を中傷する内容のため',
};

const KINDS = [
  [
    'ugc-moderation.user-suspended',
    MODERATION_USER_SUSPENDED_EMAIL,
    SUSPENDED_FIELDS,
    'suspendedAt',
  ],
  [
    'ugc-moderation.product-hidden',
    MODERATION_PRODUCT_HIDDEN_EMAIL,
    PRODUCT_HIDDEN_FIELDS,
    'hiddenAt',
  ],
  [
    'ugc-moderation.comment-hidden',
    MODERATION_COMMENT_HIDDEN_EMAIL,
    COMMENT_HIDDEN_FIELDS,
    'hiddenAt',
  ],
] as const;

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

describe('措置の通知のメール種別の集約', () => {
  test('停止・プロダクトの非公開化・コメントの非公開化の3種を凍結して持つ', () => {
    expect(MODERATION_EMAIL_KINDS).toEqual([
      MODERATION_USER_SUSPENDED_EMAIL,
      MODERATION_PRODUCT_HIDDEN_EMAIL,
      MODERATION_COMMENT_HIDDEN_EMAIL,
    ]);
    expect(Object.isFrozen(MODERATION_EMAIL_KINDS)).toBe(true);
  });

  test('全種別の集約点に載る本specの種別は3種だけで、代理の退会の種別を持たない', () => {
    expect(
      EMAIL_KINDS.filter((kind) => kind.name.startsWith('ugc-moderation.')),
    ).toEqual([...MODERATION_EMAIL_KINDS]);
    expect(EMAIL_KINDS.some((kind) => kind.name.includes('withdraw'))).toBe(
      false,
    );
  });
});

describe.each(KINDS)('メール種別%s', (name, kind, fields, dateKey) => {
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

  test.each(INVALID_TEXTS)('ニックネーム%pを拒否する', (nickname) => {
    expect(accepts(fieldsWith('nickname', nickname))).toBe(false);
  });

  test('改行を含む理由をそのまま受け付ける', () => {
    const reason = '1行目の理由\n2行目の理由';

    expect(kind.inputSchema.parse(fieldsWith('reason', reason))).toEqual({
      ...fields,
      reason,
    });
  });

  test(`理由は${String(MODERATION_REASON_MAX)}書記素まで受け付け、絵文字も1文字として数える`, () => {
    expect(
      accepts(fieldsWith('reason', 'あ'.repeat(MODERATION_REASON_MAX))),
    ).toBe(true);
    expect(
      accepts(fieldsWith('reason', '👨‍👩‍👧'.repeat(MODERATION_REASON_MAX))),
    ).toBe(true);
    expect(
      accepts(fieldsWith('reason', 'あ'.repeat(MODERATION_REASON_MAX + 1))),
    ).toBe(false);
  });

  test.each([...INVALID_TEXTS, ' ', '\n\t'])('理由%pを拒否する', (reason) => {
    expect(accepts(fieldsWith('reason', reason))).toBe(false);
  });

  test('措置の日時はUTCのISO 8601の文字列で受け付ける', () => {
    expect(accepts(fieldsWith(dateKey, '2026-11-20T07:40:00Z'))).toBe(true);
  });

  test.each(INVALID_DATE_TIMES)('措置の日時%pを拒否する', (value) => {
    expect(accepts(fieldsWith(dateKey, value))).toBe(false);
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
  ['ugc-moderation.product-hidden', PRODUCT_HIDDEN_FIELDS],
  ['ugc-moderation.comment-hidden', COMMENT_HIDDEN_FIELDS],
] as const)('メール種別%sのプロダクトの名称', (name, fields) => {
  const kind =
    name === 'ugc-moderation.product-hidden'
      ? MODERATION_PRODUCT_HIDDEN_EMAIL
      : MODERATION_COMMENT_HIDDEN_EMAIL;

  test.each(INVALID_TEXTS)('プロダクトの名称%pを拒否する', (productName) => {
    expect(kind.inputSchema.safeParse({ ...fields, productName }).success).toBe(
      false,
    );
  });
});

describe('メール種別ugc-moderation.comment-hiddenの抜粋', () => {
  function accepts(excerpt: unknown): boolean {
    return MODERATION_COMMENT_HIDDEN_EMAIL.inputSchema.safeParse({
      ...COMMENT_HIDDEN_FIELDS,
      excerpt,
    }).success;
  }

  test(`抜粋は${String(NOTICE_EXCERPT_MAX)}書記素まで受け付け、絵文字も1文字として数える`, () => {
    expect(accepts('あ'.repeat(NOTICE_EXCERPT_MAX))).toBe(true);
    expect(accepts('👍🏽'.repeat(NOTICE_EXCERPT_MAX))).toBe(true);
    expect(accepts('あ'.repeat(NOTICE_EXCERPT_MAX + 1))).toBe(false);
  });

  test.each(INVALID_TEXTS)('抜粋%pを拒否する', (excerpt) => {
    expect(accepts(excerpt)).toBe(false);
  });

  test('停止と非公開化の種別は抜粋を持たない', () => {
    expect(
      MODERATION_USER_SUSPENDED_EMAIL.inputSchema.parse({
        ...SUSPENDED_FIELDS,
        excerpt: 'コメント',
        productName: 'Pitch Notes',
      }),
    ).toEqual(SUSPENDED_FIELDS);
    expect(
      MODERATION_PRODUCT_HIDDEN_EMAIL.inputSchema.parse({
        ...PRODUCT_HIDDEN_FIELDS,
        excerpt: 'コメント',
      }),
    ).toEqual(PRODUCT_HIDDEN_FIELDS);
  });
});
