import { describe, expect, test } from 'bun:test';

import {
  COMMENT_MAX_GRAPHEMES,
  commentBodySchema,
  ratingScoreSchema,
} from '../../../common-lib/engagement/engagement-rules.ts';
import {
  type CommentFormInput,
  commentFormSchema,
  type CommentWithRatingFormInput,
  commentWithRatingFormSchema,
} from './comment-form-schema.ts';

const messagesOf = (result: {
  readonly success: boolean;
  readonly error?: { readonly issues: readonly { message: string }[] };
}): readonly string[] =>
  result.error?.issues.map(({ message }) => message) ?? [];

const sharedBodyMessageOf = (body: string): string | undefined =>
  commentBodySchema.safeParse(body).error?.issues[0]?.message;

const sharedRatingMessageOf = (rating: number): string | undefined =>
  ratingScoreSchema.safeParse(rating).error?.issues[0]?.message;

const INVALID_BODIES = Object.freeze([
  ['空', ''],
  ['空白と改行だけ', ' \n　 '],
  ['上限を1文字超える', 'あ'.repeat(COMMENT_MAX_GRAPHEMES + 1)],
  ['使用できない文字を含む', '感想\u0000です'],
] as const);

describe('commentFormSchema(本文だけの投稿欄)', () => {
  test('本文をマークダウンの原文のまま変えずに出力する', () => {
    const body = '  **良い**プロダクトです。\n\n- 速い\n';

    expect(commentFormSchema.parse({ body })).toEqual({ body });
  });

  test('上限ちょうどの本文を受け付ける', () => {
    const body = '👍🏽'.repeat(COMMENT_MAX_GRAPHEMES);

    expect(commentFormSchema.safeParse({ body }).success).toBe(true);
  });

  test.each(INVALID_BODIES)(
    '%sの本文は共有の本文の規則と同じ文言で拒否する',
    (_, body) => {
      const result = commentFormSchema.safeParse({ body });

      expect(result.success).toBe(false);
      expect(messagesOf(result)).toEqual([sharedBodyMessageOf(body) ?? '']);
    },
  );

  test('文言規則の文言を本文の欄の誤りとして返す', () => {
    const result = commentFormSchema.safeParse({
      body: 'あ'.repeat(COMMENT_MAX_GRAPHEMES + 1),
    });

    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        path: ['body'],
        message: 'コメントは2,000文字以内で入力してください。',
      }),
    ]);
  });

  test('評価の欄を出力に含めない', () => {
    const input: CommentFormInput = { body: '感想です。' };

    expect(commentFormSchema.parse({ ...input, rating: 5 })).toEqual({
      body: '感想です。',
    });
  });
});

describe('commentWithRatingFormSchema(本文と評価の投稿欄)', () => {
  const inputOf = (
    overrides: Partial<CommentWithRatingFormInput> = {},
  ): CommentWithRatingFormInput => ({
    body: '感想です。',
    rating: null,
    ...overrides,
  });

  test('評価を選ばない入力はratingをnullのまま出力する', () => {
    expect(commentWithRatingFormSchema.parse(inputOf())).toEqual({
      body: '感想です。',
      rating: null,
    });
  });

  test.each([1, 2, 3, 4, 5])('評価%pを受け付けて出力する', (rating) => {
    expect(commentWithRatingFormSchema.parse(inputOf({ rating }))).toEqual({
      body: '感想です。',
      rating,
    });
  });

  test.each([0, 6, 2.5])(
    '評価%pは共有の評価の規則と同じ文言で評価の欄の誤りにする',
    (rating) => {
      const result = commentWithRatingFormSchema.safeParse(inputOf({ rating }));

      expect(result.error?.issues).toEqual([
        expect.objectContaining({
          path: ['rating'],
          message: sharedRatingMessageOf(rating),
        }),
      ]);
      expect(messagesOf(result)).toEqual(['評価は1〜5で選んでください。']);
    },
  );

  test.each(INVALID_BODIES)(
    '%sの本文は本文だけの投稿欄と同じ文言で拒否する',
    (_, body) => {
      const result = commentWithRatingFormSchema.safeParse(
        inputOf({ body, rating: 4 }),
      );

      expect(result.error?.issues).toEqual([
        expect.objectContaining({
          path: ['body'],
          message: sharedBodyMessageOf(body),
        }),
      ]);
    },
  );
});
