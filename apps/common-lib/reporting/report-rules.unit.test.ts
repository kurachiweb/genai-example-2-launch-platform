import { describe, expect, test } from 'bun:test';

import {
  checkReportReason,
  isInfringementCategory,
  REPORT_CATEGORY_INFRINGEMENT_ID,
  REPORT_CATEGORY_INFRINGEMENT_NAME,
  REPORT_CATEGORY_OTHER_ID,
  REPORT_CATEGORY_OTHER_NAME,
  REPORT_CONTACT_EMAIL_MAX,
  REPORT_REASON_MAX,
  REPORT_TARGET_KINDS,
  requiresContactEmail,
  sortReportCategories,
} from './report-rules.ts';

const FAMILY_EMOJI = '👨‍👩‍👧‍👦';

const COMBINED_KANA = '\u304b\u3099';

const VARIATION_HEART = '\u2764\ufe0f';

const surround = (value: string): string => ` \u3000\t${value}\r\n\u3000 `;

const WHITE_SPACE_ONLY_VALUES = [
  ['空文字列', ''],
  ['半角スペースだけ', '   '],
  ['全角空白・タブ・改行だけ', '\u3000\t\r\n\u3000'],
] as const;

const WITHIN_LIMIT_VALUES = [
  ['1書記素', 'a'],
  ['半角英字', 'a'.repeat(1000)],
  ['ZWJで結合した絵文字', FAMILY_EMOJI.repeat(1000)],
  ['結合文字の濁点', COMBINED_KANA.repeat(1000)],
  ['異体字セレクタ付きの絵文字', VARIATION_HEART.repeat(1000)],
  ['前後の空白を除いた半角英字', surround('a'.repeat(1000))],
] as const;

const OVER_LIMIT_VALUES = [
  ['半角英字', 'a'.repeat(1001)],
  ['ZWJで結合した絵文字', FAMILY_EMOJI.repeat(1001)],
  ['結合文字の濁点', COMBINED_KANA.repeat(1001)],
  ['異体字セレクタ付きの絵文字', VARIATION_HEART.repeat(1001)],
  ['前後の空白を除いた半角英字', surround('a'.repeat(1001))],
] as const;

const OTHER_CATEGORY_ID = '01JE0000000000000000000003';

interface CategoryFixture {
  readonly id: string;
  readonly name: string;
  readonly systemDefault: boolean;
  readonly createdAt: Date;
}

const STANDARD_CREATED_AT = new Date('2026-01-01T00:00:00.000Z');

const infringement: CategoryFixture = {
  id: REPORT_CATEGORY_INFRINGEMENT_ID,
  name: REPORT_CATEGORY_INFRINGEMENT_NAME,
  systemDefault: true,
  createdAt: STANDARD_CREATED_AT,
};

const other: CategoryFixture = {
  id: REPORT_CATEGORY_OTHER_ID,
  name: REPORT_CATEGORY_OTHER_NAME,
  systemDefault: true,
  createdAt: STANDARD_CREATED_AT,
};

const added = (id: string, iso: string): CategoryFixture => ({
  id,
  name: `カテゴリ${id}`,
  systemDefault: false,
  createdAt: new Date(iso),
});

describe('通報の対象の種類', () => {
  test('ユーザー・プロダクト・コメントの3種を定める', () => {
    expect(REPORT_TARGET_KINDS).toEqual(['user', 'product', 'comment']);
    expect(Object.isFrozen(REPORT_TARGET_KINDS)).toBe(true);
  });
});

describe('通報の理由の検証', () => {
  test('上限は1,000書記素', () => {
    expect(REPORT_REASON_MAX).toBe(1000);
  });

  test.each(WHITE_SPACE_ONLY_VALUES)('%sは空として拒む', (_, value) => {
    expect(checkReportReason(value)).toBe('empty');
  });

  test.each(WITHIN_LIMIT_VALUES)('%sの上限までは受け付ける', (_, value) => {
    expect(checkReportReason(value)).toBe('ok');
  });

  test.each(OVER_LIMIT_VALUES)('%sの上限を超えると拒む', (_, value) => {
    expect(checkReportReason(value)).toBe('too-long');
  });
});

describe('連絡先メールアドレス', () => {
  test('上限は254文字', () => {
    expect(REPORT_CONTACT_EMAIL_MAX).toBe(254);
  });

  test('未ログインで権利侵害を選んだときだけ要る', () => {
    expect(
      requiresContactEmail({
        reporterKind: 'guest',
        categoryId: REPORT_CATEGORY_INFRINGEMENT_ID,
      }),
    ).toBe(true);
  });

  test.each([
    ['ログイン中で権利侵害', 'member', REPORT_CATEGORY_INFRINGEMENT_ID],
    ['ログイン中でその他', 'member', REPORT_CATEGORY_OTHER_ID],
    ['ログイン中で追加のカテゴリ', 'member', OTHER_CATEGORY_ID],
    ['未ログインでその他', 'guest', REPORT_CATEGORY_OTHER_ID],
    ['未ログインで追加のカテゴリ', 'guest', OTHER_CATEGORY_ID],
  ] as const)('%sでは要らない', (_, reporterKind, categoryId) => {
    expect(requiresContactEmail({ reporterKind, categoryId })).toBe(false);
  });
});

describe('標準カテゴリ', () => {
  test('権利侵害とその他の固定のIDと名前を定める', () => {
    expect(REPORT_CATEGORY_INFRINGEMENT_ID).toBe('01JE0000000000000000000001');
    expect(REPORT_CATEGORY_OTHER_ID).toBe('01JE0000000000000000000002');
    expect(REPORT_CATEGORY_INFRINGEMENT_NAME).toBe('権利侵害');
    expect(REPORT_CATEGORY_OTHER_NAME).toBe('その他');
  });

  test('権利侵害の固定のIDだけを権利侵害と判定する', () => {
    expect(isInfringementCategory(REPORT_CATEGORY_INFRINGEMENT_ID)).toBe(true);
    expect(isInfringementCategory(REPORT_CATEGORY_OTHER_ID)).toBe(false);
    expect(isInfringementCategory(OTHER_CATEGORY_ID)).toBe(false);
    expect(
      isInfringementCategory(REPORT_CATEGORY_INFRINGEMENT_ID.toLowerCase()),
    ).toBe(false);
    expect(isInfringementCategory('')).toBe(false);
  });
});

describe('カテゴリの並び順', () => {
  test('追加の順に並べ、権利侵害・その他の順で末尾に置く', () => {
    const later = added('01JE0000000000000000000005', '2026-03-01T00:00:00Z');
    const earlier = added('01JE0000000000000000000004', '2026-02-01T00:00:00Z');
    const sorted = sortReportCategories([other, later, infringement, earlier]);
    expect(sorted.map(({ id }) => id)).toEqual([
      earlier.id,
      later.id,
      REPORT_CATEGORY_INFRINGEMENT_ID,
      REPORT_CATEGORY_OTHER_ID,
    ]);
  });

  test('追加の日時が同じならIDの順に並べる', () => {
    const second = added('01JE0000000000000000000009', '2026-02-01T00:00:00Z');
    const first = added('01JE0000000000000000000008', '2026-02-01T00:00:00Z');
    expect(sortReportCategories([second, first]).map(({ id }) => id)).toEqual([
      first.id,
      second.id,
    ]);
  });

  test('標準カテゴリだけでも権利侵害・その他の順にする', () => {
    expect(
      sortReportCategories([other, infringement]).map(({ id }) => id),
    ).toEqual([REPORT_CATEGORY_INFRINGEMENT_ID, REPORT_CATEGORY_OTHER_ID]);
  });

  test('受け取った一覧を書き換えない', () => {
    const categories = [other, infringement];
    sortReportCategories(categories);
    expect(categories).toEqual([other, infringement]);
  });

  test('空の一覧は空のまま返す', () => {
    expect(sortReportCategories([])).toEqual([]);
  });
});
