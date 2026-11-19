import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import {
  type ApiKeyAuthorizer,
  StoreApiKeyAuthorizer,
} from '../application/public-api/api-key-authorizer.ts';
import {
  type ApiKeyManagement,
  StoreApiKeyManagement,
} from '../application/public-api/api-key-management.ts';
import {
  EditorOwnProductDescriptionService,
  type OwnProductDescriptionService,
} from '../application/public-api/own-product-description-service.ts';
import type {
  ApiKeySecretGenerator,
  ApiKeyStore,
  PublicApiRateLimits,
} from '../application/public-api/ports.ts';
import { PUBLIC_API_TYPES } from '../application/public-api/public-api-types.ts';
import {
  EditorPublicProfileUpdater,
  type PublicProfileUpdater,
} from '../application/public-api/public-profile-updater.ts';
import {
  DirectoryPublicSupporterReader,
  type PublicSupporterReader,
} from '../application/public-api/public-supporter-reader.ts';
import type { UserLifecycleSyncHandler } from '../infrastructure/identity/user-lifecycle-sync-handler.ts';
import { ApiKeyErasureSyncHandler } from '../infrastructure/public-api/api-key-erasure-sync-handler.ts';
import { CounterPublicApiRateLimits } from '../infrastructure/public-api/counter-public-api-rate-limits.ts';
import { CryptoApiKeySecretGenerator } from '../infrastructure/public-api/crypto-api-key-secret-generator.ts';
import { D1ApiKeyStore } from '../infrastructure/public-api/d1-api-key-store.ts';
import {
  type MediaLookup,
  PlatformMediaLookup,
} from '../presentation/rest/public-api/media-lookup.ts';

// データエクスポートのAPIキーの照会はPUBLIC_API_PLATFORM_MODULE、ハッシュ化の部品と厳密カウンタのクライアントは共通の束縛、利用者の状態の判定はidentityの束縛、画像と利用者の一括の照会はmediaとprofileの束縛、サポーターの読み取り・プロフィールの部分更新・説明文の更新はdirectory・match・product・profileの束縛を使う
export const PUBLIC_API_MODULE: AppModule<Hono<PlatformHonoEnv<Env>>> = {
  name: 'public-api',
  bindings: new ContainerModule(({ bind }) => {
    bind<ApiKeyStore>(PUBLIC_API_TYPES.ApiKeyStore).to(D1ApiKeyStore);
    bind<ApiKeySecretGenerator>(PUBLIC_API_TYPES.ApiKeySecretGenerator).to(
      CryptoApiKeySecretGenerator,
    );
    bind<PublicApiRateLimits>(PUBLIC_API_TYPES.PublicApiRateLimits).to(
      CounterPublicApiRateLimits,
    );
    bind<ApiKeyManagement>(PUBLIC_API_TYPES.ApiKeyManagement).to(
      StoreApiKeyManagement,
    );
    bind<ApiKeyAuthorizer>(PUBLIC_API_TYPES.ApiKeyAuthorizer).to(
      StoreApiKeyAuthorizer,
    );
    bind<PublicSupporterReader>(PUBLIC_API_TYPES.PublicSupporterReader).to(
      DirectoryPublicSupporterReader,
    );
    bind<PublicProfileUpdater>(PUBLIC_API_TYPES.PublicProfileUpdater).to(
      EditorPublicProfileUpdater,
    );
    bind<OwnProductDescriptionService>(
      PUBLIC_API_TYPES.OwnProductDescriptionService,
    ).to(EditorOwnProductDescriptionService);
    bind<MediaLookup>(PUBLIC_API_TYPES.MediaLookup).to(PlatformMediaLookup);
    bind<UserLifecycleSyncHandler>(
      PUBLIC_API_TYPES.ApiKeyErasureSyncHandler,
    ).to(ApiKeyErasureSyncHandler);
  }),
};
