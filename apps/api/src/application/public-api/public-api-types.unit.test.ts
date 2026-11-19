import { describe, expect, test } from 'bun:test';

import { PUBLIC_API_PLATFORM_TYPES } from '../../../lib/core/public-api/identifiers.ts';
import { PUBLIC_API_TYPES } from './public-api-types.ts';

const EXPECTED_NAMES = [
  'ApiKeyStore',
  'ApiKeySecretGenerator',
  'PublicApiRateLimits',
  'ApiKeyManagement',
  'ApiKeyAuthorizer',
  'PublicSupporterReader',
  'PublicProfileUpdater',
  'OwnProductDescriptionService',
  'MediaLookup',
  'ApiKeyErasureSyncHandler',
] as const;

describe('PUBLIC_API_TYPES', () => {
  test('apiのストア・生成・回数の制限・ユースケース・一括の照会・同期の処理の識別子だけを持つ', () => {
    expect(Object.keys(PUBLIC_API_TYPES).toSorted()).toEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のpublic-api.<名前>である',
    (name) => {
      expect<symbol>(PUBLIC_API_TYPES[name]).toBe(
        Symbol.for(`public-api.${name}`),
      );
    },
  );

  test('識別子はすべて互いに異なる', () => {
    expect(new Set(Object.values(PUBLIC_API_TYPES)).size).toBe(
      EXPECTED_NAMES.length,
    );
  });

  test('backend-libの共有の識別子と重ならない', () => {
    const shared = new Set<symbol>(Object.values(PUBLIC_API_PLATFORM_TYPES));

    for (const identifier of Object.values(PUBLIC_API_TYPES)) {
      expect(shared.has(identifier)).toBe(false);
    }
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(PUBLIC_API_TYPES)).toBe(true);
  });
});
