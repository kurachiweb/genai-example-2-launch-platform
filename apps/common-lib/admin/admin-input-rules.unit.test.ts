import { describe, expect, test } from 'bun:test';

import {
  ADMIN_NICKNAME_MAX,
  ADMIN_TITLE_MAX,
  AUDIT_REASON_MAX,
  CATEGORY_NAME_MAX,
  checkAdminNickname,
  checkAdminTitle,
  checkAuditReason,
  checkCategoryName,
} from './admin-input-rules.ts';

const FAMILY_EMOJI = '👨‍👩‍👧‍👦';

const COMBINED_KANA = '\u304b\u3099';

const VARIATION_HEART = '\u2764\ufe0f';

const SURROUNDING_SPACES = [' \u3000\t', '\r\n\u3000 '] as const;

const WHITE_SPACE_ONLY_VALUES = [
  ['空文字列', ''],
  ['半角スペースだけ', '   '],
  ['全角空白・タブ・改行だけ', '\u3000\t\r\n\u3000'],
] as const;

const surround = (value: string): string =>
  `${SURROUNDING_SPACES[0]}${value}${SURROUNDING_SPACES[1]}`;

const withinLimitValues = (max: number) =>
  [
    ['半角英字', 'a'.repeat(max)],
    ['ZWJで結合した絵文字', FAMILY_EMOJI.repeat(max)],
    ['結合文字の濁点', COMBINED_KANA.repeat(max)],
    ['異体字セレクタ付きの絵文字', VARIATION_HEART.repeat(max)],
    ['前後の空白を除いた半角英字', surround('a'.repeat(max))],
  ] as const;

const overLimitValues = (max: number) =>
  [
    ['半角英字', 'a'.repeat(max + 1)],
    ['ZWJで結合した絵文字', FAMILY_EMOJI.repeat(max + 1)],
    ['結合文字の濁点', COMBINED_KANA.repeat(max + 1)],
    ['異体字セレクタ付きの絵文字', VARIATION_HEART.repeat(max + 1)],
    ['前後の空白を除いた半角英字', surround('a'.repeat(max + 1))],
  ] as const;

describe('入力の上限の定数', () => {
  test('要件の値と一致する', () => {
    expect({
      ADMIN_NICKNAME_MAX,
      ADMIN_TITLE_MAX,
      AUDIT_REASON_MAX,
      CATEGORY_NAME_MAX,
    }).toEqual({
      ADMIN_NICKNAME_MAX: 25,
      ADMIN_TITLE_MAX: 50,
      AUDIT_REASON_MAX: 500,
      CATEGORY_NAME_MAX: 30,
    });
  });
});

describe('checkAdminNickname', () => {
  test.each(withinLimitValues(25))('%sの25書記素を受け付ける', (_, value) => {
    expect(checkAdminNickname(value)).toBeUndefined();
  });

  test('1書記素を受け付ける', () => {
    expect(checkAdminNickname('a')).toBeUndefined();
  });

  test.each(overLimitValues(25))(
    '%sの26書記素を長すぎると判定する',
    (_, value) => {
      expect(checkAdminNickname(value)).toBe('too-long');
    },
  );

  test('途中の空白を含めて数える', () => {
    expect(checkAdminNickname(`${'a'.repeat(12)} ${'a'.repeat(13)}`)).toBe(
      'too-long',
    );
  });

  test.each(WHITE_SPACE_ONLY_VALUES)('%sを空と判定する', (_, value) => {
    expect(checkAdminNickname(value)).toBe('empty');
  });

  test('上限を超える空白だけの入力を空と判定する', () => {
    expect(checkAdminNickname(' '.repeat(100))).toBe('empty');
  });
});

describe('checkAdminTitle', () => {
  test.each(withinLimitValues(50))('%sの50書記素を受け付ける', (_, value) => {
    expect(checkAdminTitle(value)).toBeUndefined();
  });

  test.each(overLimitValues(50))(
    '%sの51書記素を長すぎると判定する',
    (_, value) => {
      expect(checkAdminTitle(value)).toBe('too-long');
    },
  );

  test.each(WHITE_SPACE_ONLY_VALUES)(
    '任意の項目のため%sを受け付ける',
    (_, value) => {
      expect(checkAdminTitle(value)).toBeUndefined();
    },
  );
});

describe('checkAuditReason', () => {
  test.each(withinLimitValues(500))('%sの500書記素を受け付ける', (_, value) => {
    expect(checkAuditReason(value)).toBeUndefined();
  });

  test.each(overLimitValues(500))(
    '%sの501書記素を長すぎると判定する',
    (_, value) => {
      expect(checkAuditReason(value)).toBe('too-long');
    },
  );

  test.each(WHITE_SPACE_ONLY_VALUES)(
    '理由の要否は操作種別が決めるため%sを受け付ける',
    (_, value) => {
      expect(checkAuditReason(value)).toBeUndefined();
    },
  );
});

describe('checkCategoryName', () => {
  test.each(withinLimitValues(30))('%sの30書記素を受け付ける', (_, value) => {
    expect(checkCategoryName(value)).toBeUndefined();
  });

  test('1書記素を受け付ける', () => {
    expect(checkCategoryName('a')).toBeUndefined();
  });

  test.each(overLimitValues(30))(
    '%sの31書記素を長すぎると判定する',
    (_, value) => {
      expect(checkCategoryName(value)).toBe('too-long');
    },
  );

  test.each(WHITE_SPACE_ONLY_VALUES)('%sを空と判定する', (_, value) => {
    expect(checkCategoryName(value)).toBe('empty');
  });
});
