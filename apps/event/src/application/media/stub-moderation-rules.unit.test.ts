import { describe, expect, test } from 'bun:test';

import { decideStubModeration } from './stub-moderation-rules.ts';

describe('decideStubModeration', () => {
  test('99×99は「Explicit」信頼度99の最上位のラベルを返す', () => {
    expect(decideStubModeration({ width: 99, height: 99 })).toEqual({
      kind: 'labels',
      labels: [
        { name: 'Explicit', parentName: '', confidence: 99, taxonomyLevel: 1 },
      ],
    });
  });

  test('98×98は一時的な失敗(throttled)を返す', () => {
    expect(decideStubModeration({ width: 98, height: 98 })).toEqual({
      kind: 'transient',
      reason: 'throttled',
    });
  });

  test('97×97は画像として受け付けない(invalid-image)を返す', () => {
    expect(decideStubModeration({ width: 97, height: 97 })).toEqual({
      kind: 'rejected',
      reason: 'invalid-image',
    });
  });

  test.each([
    [99, 98],
    [98, 99],
    [97, 99],
    [100, 100],
    [96, 96],
    [80, 80],
    [640, 480],
  ])('%d×%dは検出なしを返す', (width, height) => {
    expect(decideStubModeration({ width, height })).toEqual({
      kind: 'labels',
      labels: [],
    });
  });
});
