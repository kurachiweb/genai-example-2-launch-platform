import { inject, injectable } from 'inversify';
import { z } from 'zod';

import {
  API_KEY_FEATURES,
  type ApiKeyFeature,
  type ApiKeyScopes,
  checkApiKeyName,
  isAllowedScopeLevel,
} from '../../../common-lib/public-api/api-key-rules.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { FieldErrorDetail } from '../../../lib/core/errors/app-error.ts';
import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import { UPPERCASE_ULID_PATTERN } from '../../../lib/core/ids/uppercase-ulid.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import {
  decodeCursor,
  encodeCursor,
} from '../../../lib/core/pagination/opaque-cursor.ts';
import {
  apiKeyError,
  apiKeyInputRejectedError,
  apiKeyNameIssueDetail,
  apiKeyScopeIssueDetail,
} from './api-key-errors.ts';
import type {
  ApiKeyListPosition,
  ApiKeyRecord,
  ApiKeySecretGenerator,
  ApiKeyStore,
  PublicApiRateLimits,
} from './ports.ts';
import { PUBLIC_API_TYPES } from './public-api-types.ts';

export const API_KEY_LIST_MAX_PAGE_SIZE = 50;

export interface ApiKeyView {
  readonly id: string;
  readonly name: string;
  readonly scopes: ApiKeyScopes;
  readonly createdAt: Date;
}

export interface IssuedApiKey {
  readonly apiKey: ApiKeyView;
  // 応答でだけ返し、保存・記録しない
  readonly plainKey: string;
}

export interface ApiKeyInput {
  readonly name: string;
  // 検証前の値
  readonly scopes: Readonly<Record<ApiKeyFeature, string>>;
}

export interface ApiKeyPage {
  readonly nodes: readonly ApiKeyView[];
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

// ログインと利用者の状態は呼び出し元のリゾルバがAccountGuardで確かめる(一覧と削除は停止中も許す)。保存の時点の停止・退会はストアの挿入の条件で拒否する
export interface ApiKeyManagement {
  // 発行の新しい順。firstは1〜50で、範囲外はRangeErrorのため呼び出し元の境界で検証する。カーソルの誤りはinvalid_cursor
  list(
    user: CurrentUser,
    page: { readonly first: number; readonly after: string | undefined },
  ): Promise<ApiKeyPage>;
  issue(
    user: CurrentUser,
    input: ApiKeyInput,
    now: Date,
  ): Promise<IssuedApiKey>;
  update(
    user: CurrentUser,
    keyId: string,
    input: ApiKeyInput,
    now: Date,
  ): Promise<ApiKeyView>;
  // 元の名前と権限スコープを複写した新しいキーを加え、元のキーは残す
  reissue(user: CurrentUser, keyId: string, now: Date): Promise<IssuedApiKey>;
  delete(user: CurrentUser, keyId: string): Promise<void>;
}

const logger = getAppLogger(['api', 'public-api', 'key']);

// Dateが表せる最大のミリ秒。これを超える時刻は位置として意味を持たない
const MAX_DATE_MILLISECONDS = 8_640_000_000_000_000;

const ApiKeyCursorSchema = z.object({
  c: z.int().min(0).max(MAX_DATE_MILLISECONDS),
  id: z.string().regex(UPPERCASE_ULID_PATTERN),
});

const encodeApiKeyCursor = (view: ApiKeyView): string =>
  encodeCursor({ c: view.createdAt.getTime(), id: view.id });

const decodeApiKeyCursor = (cursor: string): ApiKeyListPosition => {
  const { c, id } = decodeCursor(ApiKeyCursorSchema, cursor);
  return { createdAt: new Date(c), id };
};

const toView = (record: ApiKeyRecord): ApiKeyView => ({
  id: record.id,
  name: record.name,
  scopes: record.scopes,
  createdAt: record.createdAt,
});

// 全ての項目の誤りをまとめて返す
function validateInput(input: ApiKeyInput): {
  readonly name: string;
  readonly scopes: ApiKeyScopes;
} {
  const name = checkApiKeyName(input.name);
  const details: FieldErrorDetail[] = [
    ...(name.ok ? [] : [apiKeyNameIssueDetail(name.reason)]),
    ...API_KEY_FEATURES.filter(
      (feature) => !isAllowedScopeLevel(feature, input.scopes[feature]),
    ).map(apiKeyScopeIssueDetail),
  ];
  if (!name.ok || details.length > 0) {
    throw apiKeyInputRejectedError(details);
  }
  // 全ての機能の値をisAllowedScopeLevelで確かめたため、機能ごとの値の型に収まる
  const scopes = Object.fromEntries(
    API_KEY_FEATURES.map((feature) => [feature, input.scopes[feature]]),
  ) as ApiKeyScopes;
  return { name: name.name, scopes };
}

@injectable()
export class StoreApiKeyManagement implements ApiKeyManagement {
  constructor(
    @inject(PUBLIC_API_TYPES.ApiKeyStore)
    private readonly store: ApiKeyStore,
    @inject(PUBLIC_API_TYPES.ApiKeySecretGenerator)
    private readonly secrets: ApiKeySecretGenerator,
    @inject(PUBLIC_API_TYPES.PublicApiRateLimits)
    private readonly rateLimits: PublicApiRateLimits,
    @inject(PLATFORM_TYPES.IdGenerator)
    private readonly ids: IdGenerator,
  ) {}

  async list(
    user: CurrentUser,
    page: { readonly first: number; readonly after: string | undefined },
  ): Promise<ApiKeyPage> {
    const { first } = page;
    if (
      !Number.isInteger(first) ||
      first < 1 ||
      first > API_KEY_LIST_MAX_PAGE_SIZE
    ) {
      throw new RangeError(
        `一覧の件数は1〜${String(API_KEY_LIST_MAX_PAGE_SIZE)}件で指定してください: ${String(first)}`,
      );
    }
    const before =
      page.after === undefined ? undefined : decodeApiKeyCursor(page.after);
    // 続きの有無を知るため1件多く読む
    const records = await this.store.listByUser(user.user.id, {
      limit: first + 1,
      before,
    });
    const nodes = records.slice(0, first).map(toView);
    const last = nodes.at(-1);
    return {
      nodes,
      hasNextPage: records.length > first,
      endCursor: last === undefined ? null : encodeApiKeyCursor(last),
    };
  }

  async issue(
    user: CurrentUser,
    input: ApiKeyInput,
    now: Date,
  ): Promise<IssuedApiKey> {
    const valid = validateInput(input);
    const issued = await this.#issueKey(user.user.id, valid, now);
    logger.info('APIキーを発行しました', {
      recordId: issued.apiKey.id,
      userId: user.user.id,
    });
    return issued;
  }

  async update(
    user: CurrentUser,
    keyId: string,
    input: ApiKeyInput,
    now: Date,
  ): Promise<ApiKeyView> {
    const valid = validateInput(input);
    const userId = user.user.id;
    // 応答の発行日時を得るため、本人のキーであることと合わせて先に読む
    const original = await this.store.findForOwner(userId, keyId);
    if (original === undefined) {
      throw apiKeyError('api_key_not_found');
    }
    const result = await this.store.update({
      userId,
      keyId,
      name: valid.name,
      scopes: valid.scopes,
      at: now,
    });
    if (result === 'not-found') {
      throw apiKeyError('api_key_not_found');
    }
    return { ...toView(original), name: valid.name, scopes: valid.scopes };
  }

  async reissue(
    user: CurrentUser,
    keyId: string,
    now: Date,
  ): Promise<IssuedApiKey> {
    const userId = user.user.id;
    // 見つからない要求で発行の回数を消費しないよう、回数の制限より先に元のキーを読む
    const original = await this.store.findForOwner(userId, keyId);
    if (original === undefined) {
      throw apiKeyError('api_key_not_found');
    }
    // 読み取りの後に元のキーが削除されても、新しいキーの有効性は元のキーに依らないため複写した値で発行を続ける
    const issued = await this.#issueKey(
      userId,
      { name: original.name, scopes: original.scopes },
      now,
    );
    logger.info('APIキーを再発行しました', {
      recordId: issued.apiKey.id,
      sourceRecordId: original.id,
      userId,
    });
    return issued;
  }

  async delete(user: CurrentUser, keyId: string): Promise<void> {
    const userId = user.user.id;
    if (!(await this.store.delete(userId, keyId))) {
      throw apiKeyError('api_key_not_found');
    }
    logger.info('APIキーを削除しました', { recordId: keyId, userId });
  }

  async #issueKey(
    userId: string,
    key: { readonly name: string; readonly scopes: ApiKeyScopes },
    now: Date,
  ): Promise<IssuedApiKey> {
    await this.rateLimits.consumeIssue(userId, now);
    const secret = await this.secrets.generate();
    const id = this.ids.generate();
    const result = await this.store.insert({
      id,
      userId,
      name: key.name,
      keyHash: secret.hash,
      scopes: key.scopes,
      at: now,
    });
    if (result === 'account-unavailable') {
      throw apiKeyError('account_unavailable');
    }
    return {
      apiKey: { id, name: key.name, scopes: key.scopes, createdAt: now },
      plainKey: secret.plain,
    };
  }
}
