import { describe, expect, test } from 'bun:test';

import { PUBLIC_API_INVALID_TYPE_MESSAGE } from './common.ts';
import { MyProductDescriptionBodySchema } from './my-products.ts';

interface Issue {
  readonly field: string;
  readonly message: string;
}

function issuesOf(body: unknown): Issue[] {
  const result = MyProductDescriptionBodySchema.safeParse(body);
  if (result.success) {
    throw new Error('検証に通ってしまいました');
  }
  return result.error.issues.map((issue) => ({
    field: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

const REQUIRED = {
  field: 'description_markdown',
  message: '説明文を入力してください。',
};

describe('MyProductDescriptionBodySchema', () => {
  test('説明文の空白と改行を変えずに受け付ける', () => {
    expect(
      MyProductDescriptionBodySchema.parse({
        description_markdown: '  # 概要\n\n本文\n',
      }),
    ).toEqual({ description_markdown: '  # 概要\n\n本文\n' });
  });

  test('20,000文字ちょうどの説明文は受け付ける', () => {
    expect(
      MyProductDescriptionBodySchema.safeParse({
        description_markdown: '👍'.repeat(20_000),
      }).success,
    ).toBe(true);
  });

  test.each([
    ['空の', ''],
    ['空白だけの', ' \n\t'],
  ])('%s説明文はプロダクトの編集画面と同じ文言で拒否する', (_name, value) => {
    expect(issuesOf({ description_markdown: value })).toEqual([REQUIRED]);
  });

  test('説明文の無い本文は空の説明文と同じ文言で拒否する', () => {
    expect(issuesOf({})).toEqual([REQUIRED]);
  });

  test('20,000書記素を超える説明文は文字数の超過として拒否する', () => {
    expect(issuesOf({ description_markdown: '👍'.repeat(20_001) })).toEqual([
      {
        field: 'description_markdown',
        message: '説明文は20,000文字以内で入力してください。',
      },
    ]);
  });

  test('使用できない文字を含む説明文は拒否する', () => {
    expect(issuesOf({ description_markdown: 'a\u0007b' })).toEqual([
      {
        field: 'description_markdown',
        message: '説明文に使用できない文字が含まれています。',
      },
    ]);
  });

  test.each([
    ['null', null],
    ['数値', 1],
    ['配列', ['a']],
  ])('説明文が%sなら型の誤りとして拒否する', (_name, value) => {
    expect(issuesOf({ description_markdown: value })).toEqual([
      {
        field: 'description_markdown',
        message: PUBLIC_API_INVALID_TYPE_MESSAGE,
      },
    ]);
  });

  test.each([
    ['null', null],
    ['配列', []],
    ['文字列', 'description'],
  ])('本文が%sなら型の誤りとして拒否する', (_name, body) => {
    expect(issuesOf(body)).toEqual([
      { field: '', message: PUBLIC_API_INVALID_TYPE_MESSAGE },
    ]);
  });
});
