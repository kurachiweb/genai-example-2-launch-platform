import { env } from 'cloudflare:workers';
import { expect } from 'vitest';

import { apiKeys } from '../../db/schema/public-api/api-keys.ts';
import type { ApiKeyFeature } from '../../common-lib/public-api/api-key-rules.ts';
import { createKeyedHasher } from '../../lib/core/crypto/keyed-hasher.ts';
import {
  clearDirectoryTables,
  insertQualifiers,
  qualifierLaunchOf,
} from '../../lib/workers/directory/testing/directory-listing-fixtures.ts';
import {
  clearEngagementTables,
  type CommentFixture,
  insertComments,
  insertRatings,
} from '../../lib/workers/engagement/testing/engagement-fixtures.ts';
import {
  insertUpvotes,
  matchIdOf,
  type UpvoteFixture,
} from '../../lib/workers/match/testing/match-fixtures.ts';
import {
  db,
  insertProduct,
  insertUser,
  launchIdOf,
  T0,
} from '../../lib/workers/product/testing/product-fixtures.ts';
import { insertApiKey } from '../../lib/workers/public-api/testing/api-key-fixtures.ts';
import type {
  ApiAccess,
  ApiTarget,
} from '../../src/domain/public-api/api-key-scopes.ts';
import { API_KEY_HASH_PURPOSE } from '../../src/domain/public-api/api-key-token.ts';
import { API_ORIGIN } from './graphql-request.ts';

// 公開APIの全経路を実際のWorkerの組み立てで確かめるテストが共有する、経路の一覧・掲載中のプロダクトのデータ・キーと要求の組み立て

const hasher = createKeyedHasher(env.HASH_PEPPER);

export const TOOL_ORIGIN = 'https://tools.example';

export const OWNER = 1;
export const RIVAL = 2;
export const VOTER = 3;

export const LISTED = 1;
export const RIVAL_PRODUCT = 2;

export const DECIDED_MATCH = 1;
export const DECIDED_DATE = '2026-11-05';

export const LISTED_HANDLE = `product${String(LISTED)}`;
export const OWNER_HANDLE = 'alice';
export const VOTER_HANDLE = `user${String(VOTER)}`;

type ScopeColumn =
  | 'scopeProducts'
  | 'scopeLaunches'
  | 'scopeUpvotes'
  | 'scopeComments'
  | 'scopeRatings'
  | 'scopeProfile'
  | 'scopeProductDescriptions';

export const SCOPE_COLUMNS: Readonly<Record<ApiKeyFeature, ScopeColumn>> = {
  products: 'scopeProducts',
  launches: 'scopeLaunches',
  upvotes: 'scopeUpvotes',
  comments: 'scopeComments',
  ratings: 'scopeRatings',
  profile: 'scopeProfile',
  productDescriptions: 'scopeProductDescriptions',
};

export type ApiKeyRow = typeof apiKeys.$inferInsert;

export const NO_SCOPES: Partial<ApiKeyRow> = {
  scopeProducts: 'none',
  scopeLaunches: 'none',
  scopeUpvotes: 'none',
  scopeComments: 'none',
  scopeRatings: 'none',
  scopeProfile: 'none',
  scopeProductDescriptions: 'none',
};

export const READ_ONLY_SCOPES: Partial<ApiKeyRow> = {
  scopeProducts: 'read',
  scopeLaunches: 'read',
  scopeUpvotes: 'read',
  scopeComments: 'read',
  scopeRatings: 'read',
  scopeProfile: 'read',
  scopeProductDescriptions: 'read',
};

export const ALL_SCOPES: Partial<ApiKeyRow> = {
  ...READ_ONLY_SCOPES,
  scopeProfile: 'read_write',
  scopeProductDescriptions: 'read_write',
};

type HttpMethod = 'GET' | 'PATCH' | 'PUT';

export interface RouteCase {
  readonly method: HttpMethod;
  // 仕様書の経路のパス(基準パスからの相対)
  readonly template: string;
  // 要求する実際のパス(基準パスからの相対)
  readonly path: string;
  readonly feature: ApiKeyFeature;
  readonly access: ApiAccess;
  readonly target: ApiTarget;
  readonly statuses: readonly number[];
  readonly allowMethods: string;
  readonly cursor: boolean;
  readonly body?: unknown;
}

const READ_ALLOW_METHODS = 'GET, OPTIONS';

// design.mdの「PublicApiRoutes・RestSchemas」の表の13経路と、各経路の仕様書の応答の状態コード
export const ROUTES: readonly RouteCase[] = [
  {
    method: 'GET',
    template: '/products',
    path: '/products',
    feature: 'products',
    access: 'read',
    target: 'public',
    statuses: [200, 400, 401, 403, 429],
    allowMethods: READ_ALLOW_METHODS,
    cursor: false,
  },
  {
    method: 'GET',
    template: '/products/{handle}',
    path: `/products/${LISTED_HANDLE}`,
    feature: 'products',
    access: 'read',
    target: 'public',
    statuses: [200, 302, 401, 403, 404, 429],
    allowMethods: READ_ALLOW_METHODS,
    cursor: false,
  },
  {
    method: 'GET',
    template: '/product-categories',
    path: '/product-categories',
    feature: 'products',
    access: 'read',
    target: 'public',
    statuses: [200, 401, 403, 429],
    allowMethods: READ_ALLOW_METHODS,
    cursor: false,
  },
  {
    method: 'GET',
    template: '/products/{handle}/launches',
    path: `/products/${LISTED_HANDLE}/launches`,
    feature: 'launches',
    access: 'read',
    target: 'public',
    statuses: [200, 302, 401, 403, 404, 429],
    allowMethods: READ_ALLOW_METHODS,
    cursor: false,
  },
  {
    method: 'GET',
    template: '/products/{handle}/matches/{match_id}/supporters',
    path: `/products/${LISTED_HANDLE}/matches/${matchIdOf(DECIDED_MATCH)}/supporters`,
    feature: 'upvotes',
    access: 'read',
    target: 'public',
    statuses: [200, 302, 400, 401, 403, 404, 429],
    allowMethods: READ_ALLOW_METHODS,
    cursor: true,
  },
  {
    method: 'GET',
    template: '/users/{handle}/upvotes',
    path: `/users/${VOTER_HANDLE}/upvotes`,
    feature: 'upvotes',
    access: 'read',
    target: 'public',
    statuses: [200, 400, 401, 403, 404, 429],
    allowMethods: READ_ALLOW_METHODS,
    cursor: true,
  },
  {
    method: 'GET',
    template: '/products/{handle}/launches/{launch_id}/comments',
    path: `/products/${LISTED_HANDLE}/launches/${launchIdOf(qualifierLaunchOf(DECIDED_MATCH))}/comments`,
    feature: 'comments',
    access: 'read',
    target: 'public',
    statuses: [200, 302, 400, 401, 403, 404, 429],
    allowMethods: READ_ALLOW_METHODS,
    cursor: true,
  },
  {
    method: 'GET',
    template: '/products/{handle}/rating-summary',
    path: `/products/${LISTED_HANDLE}/rating-summary`,
    feature: 'ratings',
    access: 'read',
    target: 'public',
    statuses: [200, 302, 401, 403, 404, 429],
    allowMethods: READ_ALLOW_METHODS,
    cursor: false,
  },
  {
    method: 'GET',
    template: '/users/{handle}',
    path: `/users/${OWNER_HANDLE}`,
    feature: 'profile',
    access: 'read',
    target: 'public',
    statuses: [200, 302, 401, 403, 404, 429],
    allowMethods: READ_ALLOW_METHODS,
    cursor: false,
  },
  {
    method: 'GET',
    template: '/me/profile',
    path: '/me/profile',
    feature: 'profile',
    access: 'read',
    target: 'own',
    statuses: [200, 401, 403, 429],
    allowMethods: 'GET, PATCH, OPTIONS',
    cursor: false,
  },
  {
    method: 'PATCH',
    template: '/me/profile',
    path: '/me/profile',
    feature: 'profile',
    access: 'write',
    target: 'own',
    statuses: [200, 400, 401, 403, 409, 415, 429],
    allowMethods: 'GET, PATCH, OPTIONS',
    cursor: false,
    body: { nickname: '新しい名前' },
  },
  {
    method: 'GET',
    template: '/me/products',
    path: '/me/products',
    feature: 'productDescriptions',
    access: 'read',
    target: 'own',
    statuses: [200, 400, 401, 403, 429],
    allowMethods: READ_ALLOW_METHODS,
    cursor: true,
  },
  {
    method: 'PUT',
    template: '/me/products/{handle}/description',
    path: `/me/products/${LISTED_HANDLE}/description`,
    feature: 'productDescriptions',
    access: 'write',
    target: 'own',
    statuses: [200, 400, 401, 403, 404, 409, 415, 429],
    allowMethods: 'PUT, OPTIONS',
    cursor: false,
    body: { description_markdown: '新しい説明文' },
  },
];

export const PUBLIC_ROUTES = ROUTES.filter(({ target }) => target === 'public');

export const OWN_ROUTES = ROUTES.filter(({ target }) => target === 'own');

export const WRITE_ROUTES = ROUTES.filter(({ access }) => access === 'write');

export const routeLabelOf = (route: RouteCase): string =>
  `${route.method} ${route.template}`;

export interface KeyHolder {
  readonly index: number;
  readonly authorization: string;
}

export interface PublicApiRouteCaller {
  readonly createKeyHolder: (
    scopes: Partial<ApiKeyRow>,
    userColumns?: Parameters<typeof insertUser>[1],
  ) => Promise<KeyHolder>;
  readonly nextIp: () => string;
  readonly routeRequest: (route: RouteCase, authorization?: string) => Request;
  readonly preflightRequest: (route: RouteCase) => Request;
}

// 利用者単位とIP単位の回数の記録はテストの間で消せないため、テストファイルごとに利用者の番号とIPv6アドレスの範囲を分け、要求ごと・テストごとに変える
export function createPublicApiRouteCaller(options: {
  readonly firstHolderIndex: number;
  readonly ipGroup: number;
}): PublicApiRouteCaller {
  let nextHolderIndex = options.firstHolderIndex;
  let nextClientIp = 1;

  const nextIp = (): string => {
    const ip = `2001:db8:5a7:${options.ipGroup.toString(16)}::${nextClientIp.toString(16)}`;
    nextClientIp += 1;
    return ip;
  };

  return {
    nextIp,
    createKeyHolder: async (scopes, userColumns = {}) => {
      const index = nextHolderIndex;
      nextHolderIndex += 1;
      const plain = `lsk_${String(index).padStart(43, 'k')}`;
      await insertUser(index, { emailVerifiedAt: T0, ...userColumns });
      await insertApiKey(index, index, {
        keyHash: await hasher.hash(API_KEY_HASH_PURPOSE, plain),
        ...scopes,
      });
      return { index, authorization: `Bearer ${plain}` };
    },
    routeRequest: (route, authorization) => {
      const body =
        route.body === undefined ? undefined : JSON.stringify(route.body);
      return new Request(`${API_ORIGIN}/v1${route.path}`, {
        method: route.method,
        headers: {
          'CF-Connecting-IP': nextIp(),
          Origin: TOOL_ORIGIN,
          ...(authorization === undefined
            ? {}
            : { Authorization: authorization }),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body }),
      });
    },
    preflightRequest: (route) =>
      new Request(`${API_ORIGIN}/v1${route.path}`, {
        method: 'OPTIONS',
        headers: {
          'CF-Connecting-IP': nextIp(),
          Origin: TOOL_ORIGIN,
          'Access-Control-Request-Method': route.method,
          'Access-Control-Request-Headers':
            route.body === undefined
              ? 'authorization'
              : 'authorization,content-type',
        },
      }),
  };
}

interface ErrorBody {
  readonly error: { readonly code: string };
}

export async function errorCodeOf(response: Response): Promise<string> {
  const body: ErrorBody = await response.json();
  return body.error.code;
}

function allowHeadersOf(route: RouteCase): string {
  return route.allowMethods.includes('PATCH') ||
    route.allowMethods.includes('PUT')
    ? 'Authorization, Content-Type'
    : 'Authorization';
}

export function expectCors(response: Response, route: RouteCase): void {
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  expect(response.headers.get('Access-Control-Allow-Methods')).toBe(
    route.allowMethods,
  );
  expect(response.headers.get('Access-Control-Allow-Headers')).toBe(
    allowHeadersOf(route),
  );
  expect(response.headers.get('Access-Control-Expose-Headers')).toBeNull();
  expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull();
}

// 掲載中のプロダクト1(利用者1のalice)は11/05の予選で利用者2のプロダクト2に勝った。利用者3はプロダクト1の側にUpvoteし、ローンチにコメントし、プロダクト1を評価した
export async function seedWorld(): Promise<void> {
  await db.delete(apiKeys);
  await clearEngagementTables();
  await clearDirectoryTables();
  await insertUser(OWNER, { nickname: 'アリス', handle: OWNER_HANDLE });
  await insertUser(RIVAL);
  await insertUser(VOTER, { emailVerifiedAt: T0 });
  await insertProduct(LISTED, OWNER);
  await insertProduct(RIVAL_PRODUCT, RIVAL);
  await insertQualifiers([
    {
      match: DECIDED_MATCH,
      date: DECIDED_DATE,
      sides: [
        { product: LISTED, owner: OWNER, result: 'won', upvotes: 1 },
        { product: RIVAL_PRODUCT, owner: RIVAL, result: 'lost' },
      ],
    },
  ]);
  await insertUpvotes([
    supporterUpvoteOf(1, VOTER, DECIDED_MATCH, DECIDED_DATE),
  ]);
  await insertComments([commentOf(1, VOTER)]);
  await insertRatings([{ index: 1, product: LISTED, user: VOTER }]);
}

export function supporterUpvoteOf(
  index: number,
  user: number,
  match: number,
  date: string,
): UpvoteFixture {
  return {
    index,
    match,
    entry: qualifierLaunchOf(match),
    user,
    upvotedAt: new Date(Date.parse(`${date}T03:00:00.000Z`) + index * 1000),
    columns: { matchDate: date },
  };
}

export function commentOf(index: number, author: number): CommentFixture {
  return {
    index,
    product: LISTED,
    launch: qualifierLaunchOf(DECIDED_MATCH),
    author,
    columns: { createdAt: new Date(T0.getTime() + index * 1000) },
  };
}
