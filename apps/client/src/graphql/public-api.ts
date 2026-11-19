import type {
  ApiKeyReadLevel,
  ApiKeyScopes,
  ApiKeyWriteLevel,
} from '../../common-lib/public-api/api-key-rules.ts';
import type {
  ApiKeyReadLevel as GraphQLApiKeyReadLevel,
  ApiKeyScopesInput,
  ApiKeyWriteLevel as GraphQLApiKeyWriteLevel,
} from './generated/graphql.ts';

const READ_LEVEL_OF: Readonly<Record<GraphQLApiKeyReadLevel, ApiKeyReadLevel>> =
  Object.freeze({ NONE: 'none', READ: 'read' });

const WRITE_LEVEL_OF: Readonly<
  Record<GraphQLApiKeyWriteLevel, ApiKeyWriteLevel>
> = Object.freeze({ NONE: 'none', READ: 'read', READ_WRITE: 'read_write' });

const GRAPHQL_READ_LEVEL_OF: Readonly<
  Record<ApiKeyReadLevel, GraphQLApiKeyReadLevel>
> = Object.freeze({ none: 'NONE', read: 'READ' });

const GRAPHQL_WRITE_LEVEL_OF: Readonly<
  Record<ApiKeyWriteLevel, GraphQLApiKeyWriteLevel>
> = Object.freeze({ none: 'NONE', read: 'READ', read_write: 'READ_WRITE' });

// GraphQLの列挙は大文字のため、表示名と検証規則を引く共用部品の値と相互に写す。応答のscopesも入力と同じ形のためこの型で受け取る
export const toApiKeyScopes = (scopes: ApiKeyScopesInput): ApiKeyScopes => ({
  products: READ_LEVEL_OF[scopes.products],
  launches: READ_LEVEL_OF[scopes.launches],
  upvotes: READ_LEVEL_OF[scopes.upvotes],
  comments: READ_LEVEL_OF[scopes.comments],
  ratings: READ_LEVEL_OF[scopes.ratings],
  profile: WRITE_LEVEL_OF[scopes.profile],
  productDescriptions: WRITE_LEVEL_OF[scopes.productDescriptions],
});

export const toApiKeyScopesInput = (
  scopes: ApiKeyScopes,
): ApiKeyScopesInput => ({
  products: GRAPHQL_READ_LEVEL_OF[scopes.products],
  launches: GRAPHQL_READ_LEVEL_OF[scopes.launches],
  upvotes: GRAPHQL_READ_LEVEL_OF[scopes.upvotes],
  comments: GRAPHQL_READ_LEVEL_OF[scopes.comments],
  ratings: GRAPHQL_READ_LEVEL_OF[scopes.ratings],
  profile: GRAPHQL_WRITE_LEVEL_OF[scopes.profile],
  productDescriptions: GRAPHQL_WRITE_LEVEL_OF[scopes.productDescriptions],
});
