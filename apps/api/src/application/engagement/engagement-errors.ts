import {
  LAUNCH_NOT_COMMENTABLE_MESSAGE,
  OWN_PRODUCT_RATING_MESSAGE,
} from '../../../common-lib/engagement/engagement-rules.ts';
import {
  AppError,
  type AppErrorKind,
} from '../../../lib/core/errors/app-error.ts';
import { IDENTITY_ERRORS } from '../identity/identity-errors.ts';

interface EngagementErrorDefinition {
  readonly kind: AppErrorKind;
  readonly message: string;
}

// 利用者に見せる文言は文言規則のエラーメッセージと同じにする
export const ENGAGEMENT_ERRORS = Object.freeze({
  comment_target_not_found: {
    kind: 'not_found',
    message:
      'コメント先のプロダクトが見つかりません。ページを再読み込みしてください。',
  },
  launch_not_commentable: {
    kind: 'unprocessable',
    message: LAUNCH_NOT_COMMENTABLE_MESSAGE,
  },
  comment_parent_unavailable: {
    kind: 'unprocessable',
    message:
      '返信先のコメントには返信できません。ページを再読み込みしてください。',
  },
  comment_not_found: {
    kind: 'not_found',
    message: 'コメントが見つかりません。削除された可能性があります。',
  },
  rating_target_not_found: {
    kind: 'not_found',
    message:
      '評価先のプロダクトが見つかりません。ページを再読み込みしてください。',
  },
  rating_own_product: {
    kind: 'unprocessable',
    message: OWN_PRODUCT_RATING_MESSAGE,
  },
  rating_not_found: {
    kind: 'not_found',
    message: '評価が見つかりません。',
  },
  account_unavailable: IDENTITY_ERRORS.account_unavailable,
} satisfies Readonly<Record<string, EngagementErrorDefinition>>);

export type EngagementErrorCode = keyof typeof ENGAGEMENT_ERRORS;

export const engagementError = (code: EngagementErrorCode): AppError => {
  const { kind, message } = ENGAGEMENT_ERRORS[code];
  return new AppError({ kind, code, message });
};

// 返信の投稿欄は評価を送らないため画面の操作では起きない。詳細の欄はGraphQLの引数の検証(withValidatedArgs)と同じ形にする
export const ratingOnReplyError = (): AppError =>
  new AppError({
    kind: 'bad_request',
    code: 'validation_error',
    message: '入力内容を確認してください。',
    details: [
      {
        field: 'rating',
        code: 'custom',
        message: '返信には評価を付けられません。',
      },
    ],
  });
