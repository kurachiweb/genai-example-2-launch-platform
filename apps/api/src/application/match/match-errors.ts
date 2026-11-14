import {
  AppError,
  type AppErrorKind,
} from '../../../lib/core/errors/app-error.ts';
import { IDENTITY_ERRORS } from '../identity/identity-errors.ts';

interface MatchErrorDefinition {
  readonly kind: AppErrorKind;
  readonly message: string;
}

const MATCH_NOT_FOUND_MESSAGE =
  'マッチが見つかりませんでした。ページを再読み込みしてください。';

// 利用者に見せる文言は文言規則のエラーメッセージと同じにする
export const MATCH_ERRORS = Object.freeze({
  match_not_found: { kind: 'not_found', message: MATCH_NOT_FOUND_MESSAGE },
  upvote_own_match: {
    kind: 'forbidden',
    message: '自身のプロダクトとその対戦相手にはUpvoteできません。',
  },
  upvote_not_accepting: {
    kind: 'conflict',
    message: 'このマッチはUpvoteを受け付けていません。',
  },
  account_unavailable: IDENTITY_ERRORS.account_unavailable,
  email_not_verified: IDENTITY_ERRORS.email_not_verified,
  unauthenticated: IDENTITY_ERRORS.unauthenticated,
} satisfies Readonly<Record<string, MatchErrorDefinition>>);

export type MatchErrorCode = keyof typeof MATCH_ERRORS;

export const matchError = (code: MatchErrorCode): AppError => {
  const { kind, message } = MATCH_ERRORS[code];
  return new AppError({ kind, code, message });
};

// 画面の操作では起きない直接の呼び出しのため、文言規則どおり「マッチが見つからない」の文言を欄に示す。詳細の欄はGraphQLの引数の検証(withValidatedArgs)と同じ形にする
export const upvoteEntryRejectedError = (): AppError =>
  new AppError({
    kind: 'bad_request',
    code: 'validation_error',
    message: '入力内容を確認してください。',
    details: [
      { field: 'entryId', code: 'custom', message: MATCH_NOT_FOUND_MESSAGE },
    ],
  });
