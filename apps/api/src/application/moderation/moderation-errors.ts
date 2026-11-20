import {
  AppError,
  type AppErrorKind,
} from '../../../lib/core/errors/app-error.ts';
import { ENGAGEMENT_ERRORS } from '../engagement/engagement-errors.ts';
import { PRODUCT_ERRORS } from '../product/product-errors.ts';

interface ModerationErrorDefinition {
  readonly kind: AppErrorKind;
  readonly message: string;
}

// 管理画面に見せる文言は文言規則の管理画面のエラーメッセージと同じにする。上流の操作口が投げるコメント・評価の不在と同じ文言にそろえる
export const MODERATION_ERRORS = Object.freeze({
  user_not_found: {
    kind: 'not_found',
    message: '利用者が見つかりません。',
  },
  product_not_found: PRODUCT_ERRORS.product_not_found,
  comment_not_found: ENGAGEMENT_ERRORS.comment_not_found,
  rating_not_found: ENGAGEMENT_ERRORS.rating_not_found,
  image_not_found: {
    kind: 'not_found',
    message: '画像が見つかりません。',
  },
  image_action_not_applicable: {
    kind: 'unprocessable',
    message: 'この画像にはこの操作を行えません。',
  },
  // 利用者本人の操作の競合と同じコードで返すが、管理画面では一覧を読み直してからの再操作を案内する
  account_state_conflict: {
    kind: 'conflict',
    message:
      '他の操作で状態が変わりました。最新の内容を読み込んでからやり直してください。',
  },
} satisfies Readonly<Record<string, ModerationErrorDefinition>>);

export type ModerationErrorCode = keyof typeof MODERATION_ERRORS;

export const moderationError = (code: ModerationErrorCode): AppError => {
  const { kind, message } = MODERATION_ERRORS[code];
  return new AppError({ kind, code, message });
};
