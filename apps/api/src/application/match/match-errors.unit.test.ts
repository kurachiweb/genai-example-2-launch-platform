import { describe, expect, test } from 'bun:test';

import { STATUS_BY_KIND } from '../../../lib/core/errors/app-error.ts';
import { IDENTITY_ERRORS } from '../identity/identity-errors.ts';
import {
  MATCH_ERRORS,
  matchError,
  upvoteEntryRejectedError,
} from './match-errors.ts';

const MATCH_NOT_FOUND_MESSAGE =
  'マッチが見つかりませんでした。ページを再読み込みしてください。';

describe('matchError', () => {
  test.each([
    ['match_not_found', 'not_found', 404],
    ['upvote_own_match', 'forbidden', 403],
    ['upvote_not_accepting', 'conflict', 409],
    ['account_unavailable', 'forbidden', 403],
    ['email_not_verified', 'forbidden', 403],
    ['unauthenticated', 'unauthenticated', 401],
  ] as const)('%sは%s(%i)のAppErrorになる', (code, kind, status) => {
    const error = matchError(code);

    expect(error.code).toBe(code);
    expect(error.kind).toBe(kind);
    expect(STATUS_BY_KIND[error.kind]).toBe(status);
    expect(error.message).toBe(MATCH_ERRORS[code].message);
    expect(error.details).toBeUndefined();
  });

  test('マッチとUpvoteの拒否の文言は文言規則と一字一句同じである', () => {
    expect(MATCH_ERRORS.match_not_found.message).toBe(MATCH_NOT_FOUND_MESSAGE);
    expect(MATCH_ERRORS.upvote_own_match.message).toBe(
      '自身のプロダクトとその対戦相手にはUpvoteできません。',
    );
    expect(MATCH_ERRORS.upvote_not_accepting.message).toBe(
      'このマッチはUpvoteを受け付けていません。',
    );
  });

  test('利用者の状態による拒否はidentity-authの定義をそのまま使う', () => {
    expect(MATCH_ERRORS.account_unavailable).toBe(
      IDENTITY_ERRORS.account_unavailable,
    );
    expect(MATCH_ERRORS.email_not_verified).toBe(
      IDENTITY_ERRORS.email_not_verified,
    );
    expect(MATCH_ERRORS.unauthenticated).toBe(IDENTITY_ERRORS.unauthenticated);
  });
});

describe('upvoteEntryRejectedError', () => {
  test('マッチに無い側の指定は、側の欄に「マッチが見つからない」の文言を持つvalidation_error(400)になる', () => {
    const error = upvoteEntryRejectedError();

    expect(error.code).toBe('validation_error');
    expect(STATUS_BY_KIND[error.kind]).toBe(400);
    expect(error.message).toBe('入力内容を確認してください。');
    expect(error.details).toEqual([
      { field: 'entryId', code: 'custom', message: MATCH_NOT_FOUND_MESSAGE },
    ]);
  });
});
