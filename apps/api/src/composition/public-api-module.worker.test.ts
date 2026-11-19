import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, test } from 'vitest';

import { PUBLIC_API_PLATFORM_TYPES } from '../../lib/core/public-api/identifiers.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { D1ApiKeyExport } from '../../lib/workers/public-api/d1-api-key-export.ts';
import { StoreApiKeyAuthorizer } from '../application/public-api/api-key-authorizer.ts';
import { StoreApiKeyManagement } from '../application/public-api/api-key-management.ts';
import { EditorOwnProductDescriptionService } from '../application/public-api/own-product-description-service.ts';
import { PUBLIC_API_TYPES } from '../application/public-api/public-api-types.ts';
import { EditorPublicProfileUpdater } from '../application/public-api/public-profile-updater.ts';
import { DirectoryPublicSupporterReader } from '../application/public-api/public-supporter-reader.ts';
import { CounterPublicApiRateLimits } from '../infrastructure/public-api/counter-public-api-rate-limits.ts';
import { CryptoApiKeySecretGenerator } from '../infrastructure/public-api/crypto-api-key-secret-generator.ts';
import { D1ApiKeyStore } from '../infrastructure/public-api/d1-api-key-store.ts';
import { PlatformMediaLookup } from '../presentation/rest/public-api/media-lookup.ts';
import { MODULES } from './modules.ts';
import { PUBLIC_API_MODULE } from './public-api-module.ts';

describe('APIサーバーの公開APIの束縛', () => {
  test('公開APIの束縛をモジュールの一覧に1つだけ持つ', () => {
    expect(MODULES.filter(({ name }) => name === 'public-api')).toEqual([
      PUBLIC_API_MODULE,
    ]);
  });

  test('経路を登録せず、束縛だけを持つ', () => {
    expect(PUBLIC_API_MODULE.routes).toBeUndefined();
    expect(PUBLIC_API_MODULE.bindings).toBeDefined();
  });

  test('公開APIの束縛を加えた一覧からfetchの処理単位のコンテナを作り、データエクスポートの照会とキーのストア・乱数とハッシュの生成・回数の制限・キーの管理と認可のユースケース・サポーターの読み取り・プロフィールの部分更新・説明文の更新のユースケース・画像と利用者の一括の照会を解決できる', () => {
    const container = createInvocationContainer(
      {
        env,
        executionCtx: createExecutionContext(),
        info: {
          kind: 'fetch',
          correlationId: crypto.randomUUID(),
          clientIp: undefined,
        },
      },
      MODULES,
    );

    expect(
      container.get(PUBLIC_API_PLATFORM_TYPES.ApiKeyExport),
    ).toBeInstanceOf(D1ApiKeyExport);
    expect(container.get(PUBLIC_API_TYPES.ApiKeyStore)).toBeInstanceOf(
      D1ApiKeyStore,
    );
    expect(
      container.get(PUBLIC_API_TYPES.ApiKeySecretGenerator),
    ).toBeInstanceOf(CryptoApiKeySecretGenerator);
    expect(container.get(PUBLIC_API_TYPES.PublicApiRateLimits)).toBeInstanceOf(
      CounterPublicApiRateLimits,
    );
    expect(container.get(PUBLIC_API_TYPES.ApiKeyManagement)).toBeInstanceOf(
      StoreApiKeyManagement,
    );
    expect(container.get(PUBLIC_API_TYPES.ApiKeyAuthorizer)).toBeInstanceOf(
      StoreApiKeyAuthorizer,
    );
    expect(
      container.get(PUBLIC_API_TYPES.PublicSupporterReader),
    ).toBeInstanceOf(DirectoryPublicSupporterReader);
    expect(container.get(PUBLIC_API_TYPES.PublicProfileUpdater)).toBeInstanceOf(
      EditorPublicProfileUpdater,
    );
    expect(
      container.get(PUBLIC_API_TYPES.OwnProductDescriptionService),
    ).toBeInstanceOf(EditorOwnProductDescriptionService);
    expect(container.get(PUBLIC_API_TYPES.MediaLookup)).toBeInstanceOf(
      PlatformMediaLookup,
    );
  });
});
