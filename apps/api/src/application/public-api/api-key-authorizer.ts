import { inject, injectable } from 'inversify';

import type {
  ApiKeyFeature,
  ApiKeyScopes,
} from '../../../common-lib/public-api/api-key-rules.ts';
import type { KeyedHasher } from '../../../lib/core/crypto/keyed-hasher.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import type {
  AccountGuard,
  CurrentUser,
} from '../../../lib/core/identity/account-guard.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import {
  type ApiAccess,
  type ApiTarget,
  allowsAccess,
} from '../../domain/public-api/api-key-scopes.ts';
import {
  API_KEY_HASH_PURPOSE,
  isWellFormedApiKey,
} from '../../domain/public-api/api-key-token.ts';
import { apiKeyError } from './api-key-errors.ts';
import type {
  ApiKeyRecord,
  ApiKeyStore,
  PublicApiRateLimits,
  PublicApiRateLimitStatus,
} from './ports.ts';
import { PUBLIC_API_TYPES } from './public-api-types.ts';
import { apiKeySessionView } from './session-views.ts';

export interface PublicApiCaller {
  readonly keyId: string;
  readonly user: CurrentUser;
  readonly scopes: ApiKeyScopes;
}

export interface ApiKeyAuthorization {
  readonly caller: PublicApiCaller;
  readonly rateLimit: PublicApiRateLimitStatus;
}

export interface ApiKeySubject {
  readonly keyId: string;
  readonly userId: string;
}

export interface ApiKeyAuthorizationRequest {
  readonly token: string;
  readonly feature: ApiKeyFeature;
  readonly access: ApiAccess;
  readonly target: ApiTarget;
  readonly now: Date;
  // 照合の後の拒否は例外で返るため、拒否を記録する呼び出し元がキーと持ち主のIDを受け取れるよう照合の直後に知らせる
  readonly onIdentified?: (subject: ApiKeySubject) => void;
}

// 形式→照合→利用者の状態→権限→回数の順に判定し、回数より前の失敗では利用者単位の回数を消費しない。回数の超過はPublicApiRateLimitErrorを投げる
export interface ApiKeyAuthorizer {
  authorize(request: ApiKeyAuthorizationRequest): Promise<ApiKeyAuthorization>;
}

const UNAUTHENTICATED_CODE = 'unauthenticated';

@injectable()
export class StoreApiKeyAuthorizer implements ApiKeyAuthorizer {
  constructor(
    @inject(PUBLIC_API_TYPES.ApiKeyStore)
    private readonly store: ApiKeyStore,
    @inject(PLATFORM_TYPES.KeyedHasher)
    private readonly hasher: KeyedHasher,
    @inject(IDENTITY_PLATFORM_TYPES.AccountGuard)
    private readonly guard: AccountGuard,
    @inject(PUBLIC_API_TYPES.PublicApiRateLimits)
    private readonly rateLimits: PublicApiRateLimits,
  ) {}

  async authorize(
    request: ApiKeyAuthorizationRequest,
  ): Promise<ApiKeyAuthorization> {
    const key = await this.#findKey(request.token);
    request.onIdentified?.({ keyId: key.id, userId: key.userId });
    const user = await this.#requireOwner(key, request.target);
    if (!allowsAccess(key.scopes, request.feature, request.access)) {
      throw apiKeyError('insufficient_scope');
    }
    const rateLimit = await this.rateLimits.consumeRequest(
      user.user.id,
      request.access,
      request.now,
    );
    return {
      caller: { keyId: key.id, user, scopes: key.scopes },
      rateLimit,
    };
  }

  // 形式違反と不在のキーを区別しない
  async #findKey(token: string): Promise<ApiKeyRecord> {
    if (!isWellFormedApiKey(token)) {
      throw apiKeyError('invalid_api_key');
    }
    const keyHash = await this.hasher.hash(API_KEY_HASH_PURPOSE, token);
    const key = await this.store.findByHash(keyHash);
    if (key === undefined) {
      throw apiKeyError('invalid_api_key');
    }
    return key;
  }

  // 停止中の持ち主のキーでも公開データは読めるようにし、自分のデータの経路だけを拒否する
  async #requireOwner(
    key: ApiKeyRecord,
    target: ApiTarget,
  ): Promise<CurrentUser> {
    const session = apiKeySessionView({ userId: key.userId, keyId: key.id });
    try {
      return target === 'own'
        ? await this.guard.requireWritableUser(session)
        : await this.guard.requireUser(session);
    } catch (error) {
      // 退会の確定と同時にキーは消えるが、照合の直後に退会した場合などはキーの無効として扱う
      if (error instanceof AppError && error.code === UNAUTHENTICATED_CODE) {
        throw apiKeyError('invalid_api_key');
      }
      throw error;
    }
  }
}
