import { describe, expect, test } from 'bun:test';

import { GraphQLClientError } from '../graphql/graphql-result.ts';
import { isInvalidLinkError } from './invalid-link.ts';

const INVALID_LINK_MESSAGE = 'このリンクは無効か、有効期限が切れています。';

const validationError = (field: string) =>
  new GraphQLClientError({
    code: 'validation_error',
    message: '入力内容を確認してください。',
    status: 400,
    details: [{ field, code: 'too_big', message: INVALID_LINK_MESSAGE }],
  });

describe('isInvalidLinkError', () => {
  test('照合できないトークンの拒否を無効なリンクとする', () => {
    expect(
      isInvalidLinkError(
        new GraphQLClientError({
          code: 'invalid_link',
          message: INVALID_LINK_MESSAGE,
          status: 422,
        }),
      ),
    ).toBe(true);
  });

  test.each([
    ['引数で直接受け取るトークン', 'token'],
    ['入力の型に含めたトークン', 'input.token'],
  ])('%sの欄への入力の検証の失敗を無効なリンクとする', (_label, field) => {
    expect(isInvalidLinkError(validationError(field))).toBe(true);
  });

  test('トークン以外の欄への入力の検証の失敗は無効なリンクとしない', () => {
    expect(isInvalidLinkError(validationError('newPassword'))).toBe(false);
  });

  test('詳細を持たない入力の検証の失敗は無効なリンクとしない', () => {
    expect(
      isInvalidLinkError(
        new GraphQLClientError({
          code: 'validation_error',
          message: '入力内容を確認してください。',
          status: 400,
        }),
      ),
    ).toBe(false);
  });

  test.each([
    [
      '他のコードの失敗',
      new GraphQLClientError({
        code: 'network_error',
        message: '通信に失敗しました。',
        status: 0,
      }),
    ],
    ['GraphQLの失敗でない例外', new Error(INVALID_LINK_MESSAGE)],
  ])('%sは無効なリンクとしない', (_label, error) => {
    expect(isInvalidLinkError(error)).toBe(false);
  });
});
