import type { ApiKeyFieldsFragment } from '../../graphql/generated/graphql.ts';

export const API_KEY_CREATED_AT = '2026-09-15T07:40:00.000Z';

// 閲覧者のタイムゾーンをAsia/Tokyo・ロケールをja-JPにした時の発行日時の表示
export const API_KEY_CREATED_AT_TEXT = '2026年9月15日(火) 16:40';

const ULID_PREFIX = '01JD00000000000000000000';

export const apiKeyIdOf = (index: number): string =>
  `${ULID_PREFIX}${String(index).padStart(2, '0')}`;

export const apiKeyOf = (
  index: number,
  overrides: Partial<ApiKeyFieldsFragment> = {},
): ApiKeyFieldsFragment => ({
  id: apiKeyIdOf(index),
  name: `連携ツール${String(index)}`,
  scopes: {
    products: 'READ',
    launches: 'READ',
    upvotes: 'READ',
    comments: 'READ',
    ratings: 'READ',
    profile: 'NONE',
    productDescriptions: 'NONE',
  },
  createdAt: API_KEY_CREATED_AT,
  ...overrides,
});

export const apiKeysOf = (
  from: number,
  count: number,
): readonly ApiKeyFieldsFragment[] =>
  Array.from({ length: count }, (_, offset) => apiKeyOf(from + offset));
