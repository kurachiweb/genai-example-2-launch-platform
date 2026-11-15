import { describe, expect, test } from 'vitest';

import { CROSS_RUNTIME_CASES } from '../../common-lib/markdown/fixtures/cross-runtime-cases.ts';

describe('実行環境の間の照合(workerd)', () => {
  test.each(
    CROSS_RUNTIME_CASES.map((sample) => [sample.name, sample] as const),
  )(
    '%sの結果がBunで求めた期待値と一致する',
    async (_, { actual, expected }) => {
      expect(await actual()).toEqual(expected);
    },
  );
});
