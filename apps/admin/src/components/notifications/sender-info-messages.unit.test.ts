import { describe, expect, test } from 'bun:test';

import {
  SENDER_INFO_DESCRIPTION,
  senderInfoFieldLabelOf,
  senderInfoRequiredMessageOf,
  senderInfoTooLongMessageOf,
} from './sender-info-messages.ts';

describe('送信者情報の文言', () => {
  test('区画の説明に入力規則の上限の文字数を示す', () => {
    expect(SENDER_INFO_DESCRIPTION).toBe(
      '全てのメールの末尾に表示します。各200文字以内で入力してください。',
    );
  });

  test('欄の名前は項目名に必須の旨を添える', () => {
    expect(
      (['businessName', 'contactEmail', 'postalAddress'] as const).map(
        senderInfoFieldLabelOf,
      ),
    ).toStrictEqual([
      '事業者名(必須)',
      '連絡先メールアドレス(必須)',
      '物理的郵送先住所(必須)',
    ]);
  });

  test('未入力と文字数超過の文言は項目名と上限から組み立てる', () => {
    expect(senderInfoRequiredMessageOf('postalAddress')).toBe(
      '物理的郵送先住所を入力してください。',
    );
    expect(senderInfoTooLongMessageOf('contactEmail')).toBe(
      '連絡先メールアドレスは200文字以内で入力してください。',
    );
  });
});
