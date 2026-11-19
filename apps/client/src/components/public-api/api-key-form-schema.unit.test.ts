import { describe, expect, test } from 'bun:test';

import { DEFAULT_ISSUE_SCOPES } from '../../../common-lib/public-api/api-key-rules.ts';
import { API_KEY_FORM_MESSAGES } from './api-key-form-messages.ts';
import {
  apiKeyFormSchema,
  type ApiKeyFormValues,
  issueFormValues,
} from './api-key-form-schema.ts';

const VALID_VALUES: ApiKeyFormValues = Object.freeze({
  name: '連携ツール',
  scopes: DEFAULT_ISSUE_SCOPES,
});

const valuesWith = (
  overrides: Partial<ApiKeyFormValues>,
): ApiKeyFormValues => ({
  ...VALID_VALUES,
  ...overrides,
});

const issuesOf = (input: unknown) => {
  const result = apiKeyFormSchema.safeParse(input);
  return (
    result.error?.issues.map(({ path, message }) => ({
      path: path.join('.'),
      message,
    })) ?? []
  );
};

describe('文言(APIサーバーの検証と同じ文言の固定値)', () => {
  test('名前と権限の違反の文言を文言規則どおりに持つ', () => {
    expect(API_KEY_FORM_MESSAGES.nameRequired).toBe('名前を入力してください。');
    expect(API_KEY_FORM_MESSAGES.nameTooLong).toBe(
      '名前は50文字以内で入力してください。',
    );
    expect(API_KEY_FORM_MESSAGES.scopeNotAllowed).toBe(
      '選べない権限が指定されています。',
    );
  });
});

describe('名前の検証', () => {
  test.each([
    ['空', ''],
    ['半角の空白だけ', '   '],
    ['全角の空白だけ', '\u3000\u3000'],
    ['タブと改行だけ', '\t\n'],
  ])('%sなら未入力の文言を1つだけ返す', (_label, name) => {
    expect(issuesOf(valuesWith({ name }))).toEqual([
      { path: 'name', message: '名前を入力してください。' },
    ]);
  });

  test.each([
    ['51文字', 'あ'.repeat(51)],
    ['結合した絵文字を含む51書記素', `${'あ'.repeat(50)}👨‍👩‍👧`],
  ])('%sなら文字数超過の文言を1つだけ返す', (_label, name) => {
    expect(issuesOf(valuesWith({ name }))).toEqual([
      { path: 'name', message: '名前は50文字以内で入力してください。' },
    ]);
  });

  test('結合した絵文字を含む50書記素は受け付ける', () => {
    expect(issuesOf(valuesWith({ name: `${'あ'.repeat(49)}👨‍👩‍👧` }))).toEqual([]);
  });

  test('前後の空白を除いた50文字は受け付け、空白を除いた値を出力する', () => {
    const name = 'あ'.repeat(50);

    const result = apiKeyFormSchema.parse(
      valuesWith({ name: `\u3000 ${name} \t` }),
    );

    expect(result.name).toBe(name);
  });
});

describe('権限の検証', () => {
  test('プロフィールとプロダクトの説明文の読み書きを受け付け、値をそのまま出力する', () => {
    const scopes = {
      ...DEFAULT_ISSUE_SCOPES,
      profile: 'read_write',
      productDescriptions: 'read_write',
    } as const;

    expect(apiKeyFormSchema.parse(valuesWith({ scopes })).scopes).toEqual(
      scopes,
    );
  });

  test.each(['products', 'launches', 'upvotes', 'comments', 'ratings'])(
    '%sの読み書きは選べない権限の文言をその機能の欄に返す',
    (feature) => {
      expect(
        issuesOf({
          ...VALID_VALUES,
          scopes: { ...DEFAULT_ISSUE_SCOPES, [feature]: 'read_write' },
        }),
      ).toEqual([
        {
          path: `scopes.${feature}`,
          message: '選べない権限が指定されています。',
        },
      ]);
    },
  );

  test('どの機能にも無い値は選べない権限の文言を返す', () => {
    expect(
      issuesOf({
        ...VALID_VALUES,
        scopes: { ...DEFAULT_ISSUE_SCOPES, profile: 'admin' },
      }),
    ).toEqual([
      { path: 'scopes.profile', message: '選べない権限が指定されています。' },
    ]);
  });

  test('全ての機能を無効にした値も受け付ける', () => {
    const scopes = {
      products: 'none',
      launches: 'none',
      upvotes: 'none',
      comments: 'none',
      ratings: 'none',
      profile: 'none',
      productDescriptions: 'none',
    } as const;

    expect(issuesOf(valuesWith({ scopes }))).toEqual([]);
  });
});

describe('発行の初期値', () => {
  test('名前を空にし、読み取りの5機能を読み取り、2機能を無効にする', () => {
    expect(issueFormValues()).toEqual({
      name: '',
      scopes: {
        products: 'read',
        launches: 'read',
        upvotes: 'read',
        comments: 'read',
        ratings: 'read',
        profile: 'none',
        productDescriptions: 'none',
      },
    });
  });

  test('呼ぶたびに別のオブジェクトを返し、フォームの変更が共有されない', () => {
    const first = issueFormValues();

    expect(issueFormValues()).not.toBe(first);
    expect(issueFormValues().scopes).not.toBe(first.scopes);
    expect(Object.isFrozen(first.scopes)).toBe(false);
  });
});
