import type {
  ApiKeyReadLevel as ApiKeyReadLevelRecord,
  ApiKeyScopes as ApiKeyScopesRecord,
  ApiKeyWriteLevel as ApiKeyWriteLevelRecord,
} from '../../../../../common-lib/public-api/api-key-rules.ts';
import type { ApiKeyView } from '../../../../application/public-api/api-key-management.ts';
import type {
  ApiKey,
  ApiKeyReadLevel,
  ApiKeyScopes,
  ApiKeyWriteLevel,
} from '../../generated/resolvers-types.ts';

export const READ_LEVEL_RECORDS = Object.freeze({
  NONE: 'none',
  READ: 'read',
} as const satisfies Record<ApiKeyReadLevel, ApiKeyReadLevelRecord>);

export const WRITE_LEVEL_RECORDS = Object.freeze({
  NONE: 'none',
  READ: 'read',
  READ_WRITE: 'read_write',
} as const satisfies Record<ApiKeyWriteLevel, ApiKeyWriteLevelRecord>);

const READ_LEVEL_VALUES = Object.freeze({
  none: 'NONE',
  read: 'READ',
} as const satisfies Record<ApiKeyReadLevelRecord, ApiKeyReadLevel>);

const WRITE_LEVEL_VALUES = Object.freeze({
  none: 'NONE',
  read: 'READ',
  read_write: 'READ_WRITE',
} as const satisfies Record<ApiKeyWriteLevelRecord, ApiKeyWriteLevel>);

const toScopes = (scopes: ApiKeyScopesRecord): ApiKeyScopes => ({
  products: READ_LEVEL_VALUES[scopes.products],
  launches: READ_LEVEL_VALUES[scopes.launches],
  upvotes: READ_LEVEL_VALUES[scopes.upvotes],
  comments: READ_LEVEL_VALUES[scopes.comments],
  ratings: READ_LEVEL_VALUES[scopes.ratings],
  profile: WRITE_LEVEL_VALUES[scopes.profile],
  productDescriptions: WRITE_LEVEL_VALUES[scopes.productDescriptions],
});

export const toApiKey = (view: ApiKeyView): ApiKey => ({
  id: view.id,
  name: view.name,
  scopes: toScopes(view.scopes),
  createdAt: view.createdAt,
});
