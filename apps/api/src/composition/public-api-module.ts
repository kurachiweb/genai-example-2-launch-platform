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
import type {
  ApiKeySecretGenerator,
  ApiKeyStore,
  PublicApiRateLimits,
} from '../application/public-api/ports.ts';
import { PUBLIC_API_TYPES } from '../application/public-api/public-api-types.ts';
import type { UserLifecycleSyncHandler } from '../infrastructure/identity/user-lifecycle-sync-handler.ts';
import { ApiKeyErasureSyncHandler } from '../infrastructure/public-api/api-key-erasure-sync-handler.ts';
import { CounterPublicApiRateLimits } from '../infrastructure/public-api/counter-public-api-rate-limits.ts';
import { CryptoApiKeySecretGenerator } from '../infrastructure/public-api/crypto-api-key-secret-generator.ts';
import { D1ApiKeyStore } from '../infrastructure/public-api/d1-api-key-store.ts';

// データエクスポートのAPIキーの照会はPUBLIC_API_PLATFORM_MODULE、ハッシュ化の部品と厳密カウンタのクライアントは共通の束縛、利用者の状態の判定はidentityの束縛を使う
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
    bind<UserLifecycleSyncHandler>(
      PUBLIC_API_TYPES.ApiKeyErasureSyncHandler,
    ).to(ApiKeyErasureSyncHandler);
  }),
};
