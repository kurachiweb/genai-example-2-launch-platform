import { describe, expect, test } from 'bun:test';

import {
  checkSenderInfoLengths,
  SENDER_INFO_MAX_GRAPHEMES,
} from './sender-info-input-rules.ts';

const FAMILY_EMOJI = '👨‍👩‍👧‍👦';

const SURROUNDING_SPACES = ' \u3000\t\r\n';

const VALID = {
  businessName: '運営者',
  contactEmail: 'support@launch.example',
  postalAddress: '東京都千代田区',
} as const;

describe('SENDER_INFO_MAX_GRAPHEMES', () => {
  test('3項目の上限は200文字になる', () => {
    expect(SENDER_INFO_MAX_GRAPHEMES).toBe(200);
  });
});

describe('checkSenderInfoLengths', () => {
  test('3項目がそろい上限以内なら違反を返さない', () => {
    expect(checkSenderInfoLengths(VALID)).toEqual([]);
  });

  test.each(['businessName', 'contactEmail', 'postalAddress'] as const)(
    '%sが200書記素なら受け付け、201書記素なら長すぎると判定する',
    (field) => {
      expect(
        checkSenderInfoLengths({ ...VALID, [field]: 'あ'.repeat(200) }),
      ).toEqual([]);
      expect(
        checkSenderInfoLengths({ ...VALID, [field]: 'あ'.repeat(201) }),
      ).toEqual([{ field, reason: 'too-long' }]);
    },
  );

  test('結合した絵文字を1文字と数え、200個までを受け付ける', () => {
    expect(
      checkSenderInfoLengths({
        ...VALID,
        businessName: FAMILY_EMOJI.repeat(200),
      }),
    ).toEqual([]);
    expect(
      checkSenderInfoLengths({
        ...VALID,
        businessName: FAMILY_EMOJI.repeat(201),
      }),
    ).toEqual([{ field: 'businessName', reason: 'too-long' }]);
  });

  test('前後の空白を除いた長さで判定する', () => {
    expect(
      checkSenderInfoLengths({
        ...VALID,
        postalAddress: `${SURROUNDING_SPACES}${'あ'.repeat(200)}${SURROUNDING_SPACES}`,
      }),
    ).toEqual([]);
  });

  test.each(['businessName', 'contactEmail', 'postalAddress'] as const)(
    '%sが空や空白だけなら空と判定する',
    (field) => {
      expect(checkSenderInfoLengths({ ...VALID, [field]: '' })).toEqual([
        { field, reason: 'empty' },
      ]);
      expect(
        checkSenderInfoLengths({ ...VALID, [field]: SURROUNDING_SPACES }),
      ).toEqual([{ field, reason: 'empty' }]);
    },
  );

  test('複数の項目の違反を事業者名・連絡先メールアドレス・住所の順に全て返す', () => {
    expect(
      checkSenderInfoLengths({
        businessName: ' ',
        contactEmail: 'a'.repeat(201),
        postalAddress: '',
      }),
    ).toEqual([
      { field: 'businessName', reason: 'empty' },
      { field: 'contactEmail', reason: 'too-long' },
      { field: 'postalAddress', reason: 'empty' },
    ]);
  });

  test('メールアドレスの形式は判定しない', () => {
    expect(
      checkSenderInfoLengths({ ...VALID, contactEmail: 'not-an-email' }),
    ).toEqual([]);
  });
});
