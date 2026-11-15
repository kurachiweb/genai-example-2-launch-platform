import { describe, expect, test } from 'bun:test';

import { SENDER_INFO_FORM_SCHEMA } from './sender-info-form-schema.ts';

const VALID = Object.freeze({
  businessName: '運営事務局',
  contactEmail: 'support@launch.example',
  postalAddress: '東京都千代田区1-2-3',
});

const messagesOf = (input: Record<string, string>) =>
  (SENDER_INFO_FORM_SCHEMA.safeParse(input).error?.issues ?? []).map(
    ({ path, message }) => [path.join('.'), message],
  );

describe('SENDER_INFO_FORM_SCHEMA', () => {
  test('前後の空白を除いた3項目を送る値にする', () => {
    expect(
      SENDER_INFO_FORM_SCHEMA.parse({
        businessName: ' 運営事務局 ',
        contactEmail: '\tsupport@launch.example\n',
        postalAddress: '　東京都千代田区1-2-3　',
      }),
    ).toStrictEqual(VALID);
  });

  test('空と空白だけの項目は、項目ごとに未入力の文言を示す', () => {
    expect(
      messagesOf({ businessName: '', contactEmail: '  ', postalAddress: '' }),
    ).toStrictEqual([
      ['businessName', '事業者名を入力してください。'],
      ['contactEmail', '連絡先メールアドレスを入力してください。'],
      ['postalAddress', '物理的郵送先住所を入力してください。'],
    ]);
  });

  test('200書記素は受け付け、201書記素は文字数超過の文言を示す', () => {
    expect(
      messagesOf({ ...VALID, businessName: '👨‍👩‍👧'.repeat(200) }),
    ).toStrictEqual([]);
    expect(
      messagesOf({ ...VALID, postalAddress: 'あ'.repeat(201) }),
    ).toStrictEqual([
      ['postalAddress', '物理的郵送先住所は200文字以内で入力してください。'],
    ]);
  });

  test('連絡先メールアドレスは、前後の空白を除いた値をWHATWGの形式で判定し、形式の違反だけを示す', () => {
    expect(
      messagesOf({ ...VALID, contactEmail: ' support@localhost ' }),
    ).toStrictEqual([]);
    expect(
      messagesOf({ ...VALID, contactEmail: 'support@@launch.example' }),
    ).toStrictEqual([
      ['contactEmail', 'メールアドレスの形式が正しくありません。'],
    ]);
  });

  test('連絡先メールアドレスの文字数超過は、形式の違反より先に1つだけ示す', () => {
    expect(
      messagesOf({ ...VALID, contactEmail: `${'a'.repeat(201)}@@` }),
    ).toStrictEqual([
      ['contactEmail', '連絡先メールアドレスは200文字以内で入力してください。'],
    ]);
  });
});
