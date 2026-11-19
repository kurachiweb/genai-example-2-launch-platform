import { describe, expect, test } from 'bun:test';

import {
  type ApiKeyScopes,
  DEFAULT_ISSUE_SCOPES,
} from '../../../common-lib/public-api/api-key-rules.ts';
import { apiKeyScopeSummaryOf } from './api-key-scope-summary.ts';

const NO_SCOPES: ApiKeyScopes = Object.freeze({
  products: 'none',
  launches: 'none',
  upvotes: 'none',
  comments: 'none',
  ratings: 'none',
  profile: 'none',
  productDescriptions: 'none',
});

describe('apiKeyScopeSummaryOf', () => {
  test('発行の初期値は、読み取りの5機能を表示の順に1行で並べる', () => {
    expect(apiKeyScopeSummaryOf(DEFAULT_ISSUE_SCOPES)).toEqual([
      '読み取り: プロダクト、ローンチ履歴、Upvote、コメント、評価',
    ]);
  });

  test('読み取りと読み書きを値ごとの行に分け、無効の機能は示さない', () => {
    expect(
      apiKeyScopeSummaryOf({
        ...NO_SCOPES,
        products: 'read',
        launches: 'read',
        profile: 'read_write',
      }),
    ).toEqual(['読み取り: プロダクト、ローンチ履歴', '読み書き: プロフィール']);
  });

  test('読み書きの機能だけなら読み書きの行だけを示す', () => {
    expect(
      apiKeyScopeSummaryOf({
        ...NO_SCOPES,
        productDescriptions: 'read_write',
        profile: 'read_write',
      }),
    ).toEqual(['読み書き: プロフィール、プロダクトの説明文']);
  });

  test('書き込みの機能の読み取りは読み取りの行に表示の順で並ぶ', () => {
    expect(
      apiKeyScopeSummaryOf({
        ...NO_SCOPES,
        productDescriptions: 'read',
        ratings: 'read',
      }),
    ).toEqual(['読み取り: 評価、プロダクトの説明文']);
  });

  test('全ての機能が無効なら「権限なし」だけを示す', () => {
    expect(apiKeyScopeSummaryOf(NO_SCOPES)).toEqual(['権限なし']);
  });
});
