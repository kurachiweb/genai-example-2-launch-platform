import { describe, expect, test } from 'bun:test';

import type { CommentThreadQuery } from '../../../lib/core/engagement/ports.ts';
import { ThreadQueryCommentCountMetricSource } from './comment-count-metric-source.ts';

const PRODUCT_A = '01JD0PRDT00000000000000001';
const PRODUCT_B = '01JD0PRDT00000000000000002';
const PRODUCT_C = '01JD0PRDT00000000000000003';
const AT = new Date('2026-11-15T03:00:00.000Z');

function createThreadQuery(counts: ReadonlyMap<string, number>) {
  const reads: (readonly string[])[] = [];
  const query: CommentThreadQuery = {
    page() {
      throw new Error('この偽物では使わない: page');
    },
    countsByLaunch() {
      throw new Error('この偽物では使わない: countsByLaunch');
    },
    countsByProduct(productIds) {
      reads.push(productIds);
      return Promise.resolve(counts);
    },
  };
  return { query, reads };
}

describe('CommentCountMetricSource.metrics', () => {
  test('渡したプロダクトのIDでプロダクトごとの表示できるコメントの数を1回読み、その数を返す', async () => {
    const { query, reads } = createThreadQuery(
      new Map([
        [PRODUCT_A, 3],
        [PRODUCT_B, 12],
      ]),
    );

    const metrics = await new ThreadQueryCommentCountMetricSource(
      query,
    ).metrics({ productIds: [PRODUCT_A, PRODUCT_B], at: AT });

    expect(reads).toEqual([[PRODUCT_A, PRODUCT_B]]);
    expect(metrics).toEqual(
      new Map([
        [PRODUCT_A, 3],
        [PRODUCT_B, 12],
      ]),
    );
  });

  test('コメントの無いプロダクトを0で補い、渡したプロダクトだけを渡した順に返す', async () => {
    const { query } = createThreadQuery(
      new Map([
        [PRODUCT_B, 2],
        ['01JD0PRDT00000000000000009', 7],
      ]),
    );

    const metrics = await new ThreadQueryCommentCountMetricSource(
      query,
    ).metrics({ productIds: [PRODUCT_C, PRODUCT_B, PRODUCT_A], at: AT });

    expect([...metrics]).toEqual([
      [PRODUCT_C, 0],
      [PRODUCT_B, 2],
      [PRODUCT_A, 0],
    ]);
  });
});
