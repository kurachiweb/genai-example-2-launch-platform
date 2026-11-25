import { describe, expect, test } from 'bun:test';

import {
  AppError,
  STATUS_BY_KIND,
} from '../../../../lib/core/errors/app-error.ts';
import { API_KEY_ERRORS } from '../../../application/public-api/api-key-errors.ts';
import { PRODUCT_ERRORS } from '../../../application/product/product-errors.ts';
import { PUBLIC_API_ERRORS, publicApiError } from './public-api-errors.ts';

const PRODUCT_HIDDEN_MESSAGE =
  'このプロダクトは公開が停止されているため、説明文を更新できません。';

describe('公開APIのエラーコードの表', () => {
  test('設計の表の9つのコードを状態コードと文言とともに持つ', () => {
    const table = Object.fromEntries(
      Object.entries(PUBLIC_API_ERRORS).map(([code, { kind, message }]) => [
        code,
        { status: STATUS_BY_KIND[kind], message },
      ]),
    );

    expect(table).toStrictEqual({
      unauthenticated: {
        status: 401,
        message: 'APIキーによる認証が必要です。',
      },
      invalid_api_key: { status: 401, message: 'APIキーが無効です。' },
      account_unavailable: {
        status: 403,
        message:
          'このアカウントは現在ご利用いただけません。詳しくはお問い合わせください。',
      },
      insufficient_scope: {
        status: 403,
        message: 'このAPIキーにはこの操作の権限がありません。',
      },
      product_not_found: {
        status: 404,
        message: 'プロダクトが見つかりません。',
      },
      user_not_found: { status: 404, message: 'ユーザーが見つかりません。' },
      launch_not_found: { status: 404, message: 'ローンチが見つかりません。' },
      match_not_found: { status: 404, message: 'マッチが見つかりません。' },
      product_hidden: { status: 409, message: PRODUCT_HIDDEN_MESSAGE },
    });
  });

  test('キーの照合と権限と停止中の拒否は、ユースケースが投げる定義をそのまま使う', () => {
    expect(PUBLIC_API_ERRORS.invalid_api_key).toBe(
      API_KEY_ERRORS.invalid_api_key,
    );
    expect(PUBLIC_API_ERRORS.insufficient_scope).toBe(
      API_KEY_ERRORS.insufficient_scope,
    );
    expect(PUBLIC_API_ERRORS.account_unavailable).toBe(
      API_KEY_ERRORS.account_unavailable,
    );
  });

  test('非公開化中の説明文の更新の文言は、product-launchの説明文の更新の拒否と同じにする', () => {
    expect(PUBLIC_API_ERRORS.product_hidden).toStrictEqual(
      PRODUCT_ERRORS.product_hidden,
    );
    expect(PRODUCT_ERRORS.product_hidden.message).toBe(PRODUCT_HIDDEN_MESSAGE);
  });

  test('プロダクトが見つからない文言は、product-launchのプロダクトが見つからない文言と同じにする', () => {
    expect(PUBLIC_API_ERRORS.product_not_found).toStrictEqual(
      PRODUCT_ERRORS.product_not_found,
    );
  });

  test('表は凍結されている', () => {
    expect(Object.isFrozen(PUBLIC_API_ERRORS)).toBe(true);
  });
});

describe('publicApiError', () => {
  test.each(
    Object.keys(PUBLIC_API_ERRORS) as (keyof typeof PUBLIC_API_ERRORS)[],
  )('%sを表の種類と文言のAppErrorにする', (code) => {
    const error = publicApiError(code);

    expect(error).toBeInstanceOf(AppError);
    expect({
      kind: error.kind,
      code: error.code,
      message: error.message,
      details: error.details,
    }).toStrictEqual({
      kind: PUBLIC_API_ERRORS[code].kind,
      code,
      message: PUBLIC_API_ERRORS[code].message,
      details: undefined,
    });
  });
});
