import { describe, expect, test } from 'bun:test';

import {
  API_KEY_READ_FEATURES,
  API_KEY_WRITE_FEATURES,
  DEFAULT_ISSUE_SCOPES,
  type ApiKeyFeature,
  type ApiKeyScopes,
  type ApiKeyWriteLevel,
} from '../../../common-lib/public-api/api-key-rules.ts';
import { allowsAccess, type ApiAccess } from './api-key-scopes.ts';

const ALL_NONE: ApiKeyScopes = {
  products: 'none',
  launches: 'none',
  upvotes: 'none',
  comments: 'none',
  ratings: 'none',
  profile: 'none',
  productDescriptions: 'none',
};

const withLevel = (
  feature: ApiKeyFeature,
  level: ApiKeyWriteLevel,
): ApiKeyScopes => ({ ...ALL_NONE, [feature]: level });

type Row = {
  readonly feature: ApiKeyFeature;
  readonly level: ApiKeyWriteLevel;
  readonly access: ApiAccess;
  readonly allowed: boolean;
};

const READ_FEATURE_ROWS: readonly Row[] = API_KEY_READ_FEATURES.flatMap(
  (feature) => [
    { feature, level: 'none', access: 'read', allowed: false },
    { feature, level: 'read', access: 'read', allowed: true },
    { feature, level: 'none', access: 'write', allowed: false },
    { feature, level: 'read', access: 'write', allowed: false },
  ],
);

const WRITE_FEATURE_ROWS: readonly Row[] = API_KEY_WRITE_FEATURES.flatMap(
  (feature) => [
    { feature, level: 'none', access: 'read', allowed: false },
    { feature, level: 'read', access: 'read', allowed: true },
    { feature, level: 'read_write', access: 'read', allowed: true },
    { feature, level: 'none', access: 'write', allowed: false },
    { feature, level: 'read', access: 'write', allowed: false },
    { feature, level: 'read_write', access: 'write', allowed: true },
  ],
);

describe('allowsAccess', () => {
  test('判定の表は全7機能の全ての値と読み取り・書き込みを含む', () => {
    expect(READ_FEATURE_ROWS).toHaveLength(5 * 2 * 2);
    expect(WRITE_FEATURE_ROWS).toHaveLength(2 * 3 * 2);
  });

  test.each(READ_FEATURE_ROWS)(
    '読み取りの機能$featureが$levelのキーへの$accessは$allowedである',
    ({ feature, level, access, allowed }) => {
      expect(allowsAccess(withLevel(feature, level), feature, access)).toBe(
        allowed,
      );
    },
  );

  test.each(WRITE_FEATURE_ROWS)(
    '書き込みを持つ機能$featureが$levelのキーへの$accessは$allowedである',
    ({ feature, level, access, allowed }) => {
      expect(allowsAccess(withLevel(feature, level), feature, access)).toBe(
        allowed,
      );
    },
  );

  test.each(API_KEY_READ_FEATURES.map((feature) => ({ feature })))(
    '読み取りの機能$featureに書き込みを問うと、他の全機能が読み書きでも偽になる',
    ({ feature }) => {
      const scopes: ApiKeyScopes = {
        products: 'read',
        launches: 'read',
        upvotes: 'read',
        comments: 'read',
        ratings: 'read',
        profile: 'read_write',
        productDescriptions: 'read_write',
      };

      expect(allowsAccess(scopes, feature, 'write')).toBe(false);
    },
  );

  test('判定は問われた機能の値だけで決まり、他の機能の値に影響されない', () => {
    const scopes = withLevel('profile', 'read_write');

    expect(allowsAccess(scopes, 'profile', 'write')).toBe(true);
    expect(allowsAccess(scopes, 'productDescriptions', 'read')).toBe(false);
    expect(allowsAccess(scopes, 'products', 'read')).toBe(false);
  });

  test('発行の初期値は読み取りの5機能の読み取りだけを許す', () => {
    for (const feature of API_KEY_READ_FEATURES) {
      expect(allowsAccess(DEFAULT_ISSUE_SCOPES, feature, 'read')).toBe(true);
    }
    for (const feature of API_KEY_WRITE_FEATURES) {
      expect(allowsAccess(DEFAULT_ISSUE_SCOPES, feature, 'read')).toBe(false);
      expect(allowsAccess(DEFAULT_ISSUE_SCOPES, feature, 'write')).toBe(false);
    }
  });
});
