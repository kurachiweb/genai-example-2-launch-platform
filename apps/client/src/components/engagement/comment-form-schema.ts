import {
  commentBodySchema,
  type RatingScore,
  ratingScoreSchema,
} from '../../../common-lib/engagement/engagement-rules.ts';
import { z } from '../../../lib/utilities/validation/zod.ts';

// マークダウンは空白や改行に意味があるため値を変えない。共用の検証規則は入力の型が未指定のため、文字列の入力として包む
const body = z.string().superRefine((value, context) => {
  const message = commentBodySchema.safeParse(value).error?.issues[0]?.message;
  if (message !== undefined) {
    context.addIssue({ code: 'custom', message });
  }
});

// 評価は任意のため、選ばない入力はnullのまま送らない値として出力する
const rating = z
  .number()
  .nullable()
  .transform((value, context): RatingScore | null => {
    if (value === null) {
      return null;
    }
    const result = ratingScoreSchema.safeParse(value);
    if (!result.success) {
      context.addIssue({
        code: 'custom',
        message: result.error.issues[0]?.message ?? '',
      });
      return z.NEVER;
    }
    return result.data;
  });

// 投稿先と編集するコメントのIDは入力欄を描かないため含めず、送信の時に足す
export const commentFormSchema = z.object({ body });

export const commentWithRatingFormSchema = z.object({ body, rating });

export type CommentFormInput = z.input<typeof commentFormSchema>;

export type CommentFormOutput = z.output<typeof commentFormSchema>;

export type CommentWithRatingFormInput = z.input<
  typeof commentWithRatingFormSchema
>;

export type CommentWithRatingFormOutput = z.output<
  typeof commentWithRatingFormSchema
>;
