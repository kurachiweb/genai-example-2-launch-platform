import type { ApiKeyScopes } from '../../../common-lib/public-api/api-key-rules.ts';
import type { ApiAccess } from '../../domain/public-api/api-key-scopes.ts';

export interface ApiKeyRecord {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly scopes: ApiKeyScopes;
  readonly createdAt: Date;
}

export interface NewApiKey {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly keyHash: string;
  readonly scopes: ApiKeyScopes;
  readonly at: Date;
}

export interface ApiKeyListPosition {
  readonly createdAt: Date;
  readonly id: string;
}

export interface ApiKeyUpdate {
  readonly userId: string;
  readonly keyId: string;
  readonly name: string;
  readonly scopes: ApiKeyScopes;
  readonly at: Date;
}

export interface ApiKeyStore {
  findByHash(keyHash: string): Promise<ApiKeyRecord | undefined>;
  // 他人のキーと存在しないキーを区別しないため、持ち主と組で引く
  findForOwner(
    userId: string,
    keyId: string,
  ): Promise<ApiKeyRecord | undefined>;
  // 発行の新しい順(created_atとidの降順)
  listByUser(
    userId: string,
    input: {
      readonly limit: number;
      readonly before: ApiKeyListPosition | undefined;
    },
  ): Promise<readonly ApiKeyRecord[]>;
  // 停止中・退会済みの利用者には保存せずaccount-unavailableを返す
  insert(key: NewApiKey): Promise<'saved' | 'account-unavailable'>;
  update(input: ApiKeyUpdate): Promise<'updated' | 'not-found'>;
  delete(userId: string, keyId: string): Promise<boolean>;
}

export interface GeneratedApiKeySecret {
  readonly plain: string;
  readonly hash: string;
}

export interface ApiKeySecretGenerator {
  generate(): Promise<GeneratedApiKeySecret>;
}

export interface PublicApiRateLimitStatus {
  readonly limit: number;
  readonly remaining: number;
  // エポックミリ秒
  readonly resetAt: number;
}

export interface PublicApiRateLimits {
  // 超過はAppError(rate_limited, rate_limit_exceeded)
  consumeIssue(userId: string, now: Date): Promise<void>;
  // 超過はPublicApiRateLimitError
  consumeRequest(
    userId: string,
    access: ApiAccess,
    now: Date,
  ): Promise<PublicApiRateLimitStatus>;
}
