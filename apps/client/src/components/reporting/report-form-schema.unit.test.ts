import { describe, expect, test } from 'bun:test';

import {
  REPORT_CATEGORY_INFRINGEMENT_ID,
  REPORT_CATEGORY_OTHER_ID,
} from '../../../common-lib/reporting/report-rules.ts';
import {
  REPORT_FORM_SCHEMA,
  REPORT_FORM_WITH_CONTACT_SCHEMA,
} from './report-form-schema.ts';

const VALID = Object.freeze({
  categoryId: REPORT_CATEGORY_OTHER_ID,
  reason: '他の人の作品をそのまま載せています。',
  contactEmail: '',
});

const VALID_WITH_CONTACT = Object.freeze({
  categoryId: REPORT_CATEGORY_INFRINGEMENT_ID,
  reason: '私が撮影した写真が無断で使われています。',
  contactEmail: 'owner@rights.example',
});

const messagesOf = (result: {
  readonly success: boolean;
  readonly error?: { readonly issues: readonly { message: string }[] };
}): readonly string[] =>
  result.error?.issues.map(({ message }) => message) ?? [];

const pathsOf = (result: {
  readonly error?: {
    readonly issues: readonly { path: readonly PropertyKey[] }[];
  };
}): readonly string[] =>
  result.error?.issues.map(({ path }) => path.join('.')) ?? [];

const EMAIL_DOMAIN = '@rights.example';

const emailOf = (length: number): string =>
  `${'a'.repeat(length - EMAIL_DOMAIN.length)}${EMAIL_DOMAIN}`;

describe('REPORT_FORM_SCHEMA', () => {
  test('カテゴリと理由を値を変えずに出力し、連絡先の値が残っていても出力に含めない', () => {
    const result = REPORT_FORM_SCHEMA.parse({
      ...VALID,
      reason: '  1行目\n2行目\n',
      contactEmail: 'left@over.example',
    });

    expect(result).toStrictEqual({
      categoryId: REPORT_CATEGORY_OTHER_ID,
      reason: '  1行目\n2行目\n',
    });
  });

  test('連絡先の形式と文字数を検証しない', () => {
    const result = REPORT_FORM_SCHEMA.safeParse({
      ...VALID,
      contactEmail: `${'x'.repeat(300)}@`,
    });

    expect(result.success).toBe(true);
  });

  test.each([
    ['未選択のカテゴリ', { categoryId: '' }, 'カテゴリを選んでください。'],
    ['未入力の理由', { reason: '' }, '理由を入力してください。'],
    ['空白と改行だけの理由', { reason: ' 　\n' }, '理由を入力してください。'],
    [
      '1,001書記素の理由',
      { reason: 'あ'.repeat(1001) },
      '理由は1,000文字以内で入力してください。',
    ],
  ])('%sは文言規則の文言で拒否する', (_label, override, message) => {
    const result = REPORT_FORM_SCHEMA.safeParse({ ...VALID, ...override });

    expect(messagesOf(result)).toEqual([message]);
  });

  test('理由は前後の空白を除いた書記素で数え、1,000書記素と1文字を受け付ける', () => {
    expect(
      REPORT_FORM_SCHEMA.safeParse({
        ...VALID,
        reason: ` ${'👨‍👩‍👧'.repeat(1000)}\n`,
      }).success,
    ).toBe(true);
    expect(
      REPORT_FORM_SCHEMA.safeParse({ ...VALID, reason: 'a' }).success,
    ).toBe(true);
  });
});

describe('REPORT_FORM_WITH_CONTACT_SCHEMA', () => {
  test('連絡先の前後の空白を除いて出力し、理由は値を変えずに出力する', () => {
    const result = REPORT_FORM_WITH_CONTACT_SCHEMA.parse({
      ...VALID_WITH_CONTACT,
      reason: '  侵害の箇所\n',
      contactEmail: ' owner@rights.example\n',
    });

    expect(result).toStrictEqual({
      ...VALID_WITH_CONTACT,
      reason: '  侵害の箇所\n',
    });
  });

  test.each([
    [
      '未入力の連絡先',
      { contactEmail: '' },
      '連絡先メールアドレスを入力してください。',
    ],
    [
      '空白だけの連絡先',
      { contactEmail: '　 ' },
      '連絡先メールアドレスを入力してください。',
    ],
    [
      '形式の違う連絡先',
      { contactEmail: 'owner@' },
      'メールアドレスの形式が正しくありません。',
    ],
    [
      '255文字の連絡先',
      { contactEmail: emailOf(255) },
      'メールアドレスは254文字以内で入力してください。',
    ],
  ])('%sは連絡先の欄の文言で拒否する', (_label, override, message) => {
    const result = REPORT_FORM_WITH_CONTACT_SCHEMA.safeParse({
      ...VALID_WITH_CONTACT,
      ...override,
    });

    expect(messagesOf(result)).toEqual([message]);
    expect(pathsOf(result)).toEqual(['contactEmail']);
  });

  test('254文字の連絡先を受け付ける', () => {
    const contactEmail = emailOf(254);

    expect(contactEmail).toHaveLength(254);
    expect(
      REPORT_FORM_WITH_CONTACT_SCHEMA.safeParse({
        ...VALID_WITH_CONTACT,
        contactEmail,
      }).success,
    ).toBe(true);
  });

  test('カテゴリと理由も連絡先を含まないスキーマと同じ規則で検証する', () => {
    const result = REPORT_FORM_WITH_CONTACT_SCHEMA.safeParse({
      ...VALID_WITH_CONTACT,
      categoryId: '',
      reason: 'あ'.repeat(1001),
    });

    expect(messagesOf(result)).toEqual([
      'カテゴリを選んでください。',
      '理由は1,000文字以内で入力してください。',
    ]);
  });
});
