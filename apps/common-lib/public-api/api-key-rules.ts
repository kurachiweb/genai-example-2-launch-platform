import { countGraphemes } from '../text/graphemes.ts';
import { trimWhiteSpace } from '../text/white-space.ts';

export const API_KEY_NAME_MAX_GRAPHEMES = 50;

export const API_KEY_READ_FEATURES = Object.freeze([
  'products',
  'launches',
  'upvotes',
  'comments',
  'ratings',
] as const);

export const API_KEY_WRITE_FEATURES = Object.freeze([
  'profile',
  'productDescriptions',
] as const);

export type ApiKeyReadFeature = (typeof API_KEY_READ_FEATURES)[number];

export type ApiKeyWriteFeature = (typeof API_KEY_WRITE_FEATURES)[number];

export type ApiKeyFeature = ApiKeyReadFeature | ApiKeyWriteFeature;

export type ApiKeyReadLevel = 'none' | 'read';

export type ApiKeyWriteLevel = 'none' | 'read' | 'read_write';

export type ApiKeyScopes = {
  readonly [F in ApiKeyReadFeature]: ApiKeyReadLevel;
} & { readonly [F in ApiKeyWriteFeature]: ApiKeyWriteLevel };

export const API_KEY_FEATURES: readonly ApiKeyFeature[] = Object.freeze([
  ...API_KEY_READ_FEATURES,
  ...API_KEY_WRITE_FEATURES,
]);

export const API_KEY_FEATURE_LABELS: Readonly<Record<ApiKeyFeature, string>> =
  Object.freeze({
    products: 'プロダクト',
    launches: 'ローンチ履歴',
    upvotes: 'Upvote',
    comments: 'コメント',
    ratings: '評価',
    profile: 'プロフィール',
    productDescriptions: 'プロダクトの説明文',
  });

export const API_KEY_LEVEL_LABELS: Readonly<Record<ApiKeyWriteLevel, string>> =
  Object.freeze({
    none: '無効',
    read: '読み取り',
    read_write: '読み書き',
  });

export const DEFAULT_ISSUE_SCOPES: ApiKeyScopes = Object.freeze({
  products: 'read',
  launches: 'read',
  upvotes: 'read',
  comments: 'read',
  ratings: 'read',
  profile: 'none',
  productDescriptions: 'none',
});

const READ_LEVELS: readonly string[] = Object.freeze(['none', 'read']);

const WRITE_LEVELS: readonly string[] = Object.freeze([
  'none',
  'read',
  'read_write',
]);

const isWriteFeature = (feature: string): feature is ApiKeyWriteFeature =>
  (API_KEY_WRITE_FEATURES as readonly string[]).includes(feature);

const isReadFeature = (feature: string): feature is ApiKeyReadFeature =>
  (API_KEY_READ_FEATURES as readonly string[]).includes(feature);

export const isAllowedScopeLevel = (
  feature: ApiKeyFeature,
  level: string,
): boolean => {
  if (isWriteFeature(feature)) {
    return WRITE_LEVELS.includes(level);
  }
  return isReadFeature(feature) && READ_LEVELS.includes(level);
};

export type ApiKeyNameCheck =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly reason: 'required' | 'too_long' };

export const checkApiKeyName = (raw: string): ApiKeyNameCheck => {
  const name = trimWhiteSpace(raw);
  const graphemes = countGraphemes(name);
  if (graphemes === 0) {
    return { ok: false, reason: 'required' };
  }
  if (graphemes > API_KEY_NAME_MAX_GRAPHEMES) {
    return { ok: false, reason: 'too_long' };
  }
  return { ok: true, name };
};
