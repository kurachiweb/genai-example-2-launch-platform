import { describe, expect, test } from 'bun:test';

import { MAX_SEARCH_TARGET_NAME_LENGTH } from '../../search/search-target.ts';
import {
  assertRetryPolicy,
  DEFAULT_RETRY_POLICY,
  decideOnFailure,
} from '../retry-policy.ts';
import {
  MAX_SEARCH_SOURCE_ID_LENGTH,
  SEARCH_INDEX_REFRESH_MESSAGE,
  SEARCH_INDEX_REFRESH_RETRY,
  type SearchIndexRefreshBody,
} from './search-index-refresh.ts';

const BODY: SearchIndexRefreshBody = {
  target: 'product',
  sourceId: '01JBQ6Z8Y3V4W5X6Y7Z8A9B0C1',
};

describe('SEARCH_INDEX_REFRESH_MESSAGE', () => {
  test('種別search-index.refreshの凍結済みの契約である', () => {
    expect(SEARCH_INDEX_REFRESH_MESSAGE.type).toBe('search-index.refresh');
    expect(Object.isFrozen(SEARCH_INDEX_REFRESH_MESSAGE)).toBe(true);
  });

  test('検索対象の名前と元データの識別子だけの本文を受け付ける', () => {
    expect(SEARCH_INDEX_REFRESH_MESSAGE.schema.safeParse(BODY)).toEqual({
      success: true,
      data: BODY,
    });
  });

  test('本文に元データの内容を持ち込めず、検証の結果をもう一度検証しても同じ値になる', () => {
    const first = SEARCH_INDEX_REFRESH_MESSAGE.schema.parse({
      ...BODY,
      title: '元データの内容',
    });

    expect(first).toEqual(BODY);
    expect(SEARCH_INDEX_REFRESH_MESSAGE.schema.parse(first)).toEqual(first);
  });

  test('識別子の長さの上限は64文字である', () => {
    expect(MAX_SEARCH_SOURCE_ID_LENGTH).toBe(64);
  });

  test.each([
    ['1文字の識別子', 'a'],
    ['64文字の識別子', 'a'.repeat(MAX_SEARCH_SOURCE_ID_LENGTH)],
  ])('%sを受け付ける', (_label, sourceId) => {
    expect(
      SEARCH_INDEX_REFRESH_MESSAGE.schema.safeParse({ ...BODY, sourceId })
        .success,
    ).toBe(true);
  });

  test('40文字の検索対象の名前を受け付ける', () => {
    const target = `a${'b'.repeat(MAX_SEARCH_TARGET_NAME_LENGTH - 1)}`;

    expect(
      SEARCH_INDEX_REFRESH_MESSAGE.schema.safeParse({ ...BODY, target })
        .success,
    ).toBe(true);
  });

  test.each([
    ['検索対象の名前の欠落', { sourceId: BODY.sourceId }],
    ['空の検索対象の名前', { ...BODY, target: '' }],
    ['大文字を含む検索対象の名前', { ...BODY, target: 'Product' }],
    ['数字で始まる検索対象の名前', { ...BODY, target: '1product' }],
    ['ドットを含む検索対象の名前', { ...BODY, target: 'product.review' }],
    [
      '41文字の検索対象の名前',
      { ...BODY, target: `a${'b'.repeat(MAX_SEARCH_TARGET_NAME_LENGTH)}` },
    ],
    ['文字列でない検索対象の名前', { ...BODY, target: 1 }],
    ['識別子の欠落', { target: BODY.target }],
    ['空の識別子', { ...BODY, sourceId: '' }],
    [
      '65文字の識別子',
      { ...BODY, sourceId: 'a'.repeat(MAX_SEARCH_SOURCE_ID_LENGTH + 1) },
    ],
    ['数値の識別子', { ...BODY, sourceId: 1 }],
  ])('%sの本文を拒否する', (_label, body) => {
    expect(SEARCH_INDEX_REFRESH_MESSAGE.schema.safeParse(body).success).toBe(
      false,
    );
  });
});

describe('SEARCH_INDEX_REFRESH_RETRY', () => {
  test('5回目の試行で打ち切り、30秒から倍にして3600秒で止める', () => {
    expect(SEARCH_INDEX_REFRESH_RETRY).toEqual({
      maxAttempts: 5,
      baseDelaySeconds: 30,
      maxDelaySeconds: 3600,
    });
    expect(Object.isFrozen(SEARCH_INDEX_REFRESH_RETRY)).toBe(true);
  });

  test('既定の再試行の方針と同じ値を、既定値への参照でなく明示した値で持つ', () => {
    expect(SEARCH_INDEX_REFRESH_RETRY).toEqual(DEFAULT_RETRY_POLICY);
    expect(SEARCH_INDEX_REFRESH_RETRY).not.toBe(DEFAULT_RETRY_POLICY);
  });

  test('メッセージの処理の登録で受け付けられる', () => {
    expect(() => {
      assertRetryPolicy(SEARCH_INDEX_REFRESH_RETRY);
    }).not.toThrow();
  });

  test('受信部の再試行の判定では30・60・120・240秒の間隔の後に打ち切りになる', () => {
    const decisions = [1, 2, 3, 4, 5].map((attempts) =>
      decideOnFailure(SEARCH_INDEX_REFRESH_RETRY, attempts),
    );

    expect(decisions).toEqual([
      { kind: 'retry', delaySeconds: 30 },
      { kind: 'retry', delaySeconds: 60 },
      { kind: 'retry', delaySeconds: 120 },
      { kind: 'retry', delaySeconds: 240 },
      { kind: 'dead-letter' },
    ]);
  });
});
