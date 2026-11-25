import { describe, expect, test } from 'bun:test';

import {
  API_KEY_FEATURE_LABELS,
  API_KEY_FEATURES,
  API_KEY_LEVEL_LABELS,
  API_KEY_NAME_MAX_GRAPHEMES,
  API_KEY_READ_FEATURES,
  API_KEY_WRITE_FEATURES,
  type ApiKeyFeature,
  checkApiKeyName,
  DEFAULT_ISSUE_SCOPES,
  isAllowedScopeLevel,
} from './api-key-rules.ts';

const FAMILY_EMOJI = '👨‍👩‍👧‍👦';

const COMBINED_KANA = '\u304b\u3099';

describe('定数', () => {
  test('名前の上限は50書記素である', () => {
    expect(API_KEY_NAME_MAX_GRAPHEMES).toBe(50);
  });

  test('読み取りの5機能と読み書きできる2機能を、表示の順に並べる', () => {
    expect(API_KEY_READ_FEATURES).toEqual([
      'products',
      'launches',
      'upvotes',
      'comments',
      'ratings',
    ]);
    expect(API_KEY_WRITE_FEATURES).toEqual(['profile', 'productDescriptions']);
    expect(API_KEY_FEATURES).toEqual([
      'products',
      'launches',
      'upvotes',
      'comments',
      'ratings',
      'profile',
      'productDescriptions',
    ]);
  });

  test('一覧は凍結されている', () => {
    expect(Object.isFrozen(API_KEY_READ_FEATURES)).toBe(true);
    expect(Object.isFrozen(API_KEY_WRITE_FEATURES)).toBe(true);
    expect(Object.isFrozen(API_KEY_FEATURES)).toBe(true);
    expect(Object.isFrozen(API_KEY_FEATURE_LABELS)).toBe(true);
    expect(Object.isFrozen(API_KEY_LEVEL_LABELS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_ISSUE_SCOPES)).toBe(true);
  });
});

describe('checkApiKeyName', () => {
  test('空の名前を必須の違反とする', () => {
    expect(checkApiKeyName('')).toEqual({ ok: false, reason: 'required' });
  });

  test('空白だけの名前を必須の違反とする', () => {
    expect(checkApiKeyName(' 　\t\n ')).toEqual({
      ok: false,
      reason: 'required',
    });
  });

  test('前後の空白を除いた名前を返す', () => {
    expect(checkApiKeyName('　 連携ツール \t')).toEqual({
      ok: true,
      name: '連携ツール',
    });
  });

  test('途中の空白は残す', () => {
    expect(checkApiKeyName(' my  tool ')).toEqual({
      ok: true,
      name: 'my  tool',
    });
  });

  test('結合文字を含む絵文字を1書記素と数え、50書記素まで受け付ける', () => {
    const name = `${FAMILY_EMOJI.repeat(25)}${COMBINED_KANA.repeat(25)}`;

    expect(checkApiKeyName(name)).toEqual({ ok: true, name });
  });

  test('51書記素の名前を上限の違反とする', () => {
    const name = `${FAMILY_EMOJI.repeat(26)}${COMBINED_KANA.repeat(25)}`;

    expect(checkApiKeyName(name)).toEqual({ ok: false, reason: 'too_long' });
  });

  test('前後の空白は上限の数に含めない', () => {
    const name = 'a'.repeat(API_KEY_NAME_MAX_GRAPHEMES);

    expect(checkApiKeyName(`  ${name}  `)).toEqual({ ok: true, name });
  });
});

describe('isAllowedScopeLevel', () => {
  test.each(API_KEY_READ_FEATURES)(
    '読み取りの機能 %s は none と read だけを許す',
    (feature) => {
      expect(isAllowedScopeLevel(feature, 'none')).toBe(true);
      expect(isAllowedScopeLevel(feature, 'read')).toBe(true);
      expect(isAllowedScopeLevel(feature, 'read_write')).toBe(false);
    },
  );

  test.each(API_KEY_WRITE_FEATURES)(
    '読み書きできる機能 %s は none と read と read_write を許す',
    (feature) => {
      expect(isAllowedScopeLevel(feature, 'none')).toBe(true);
      expect(isAllowedScopeLevel(feature, 'read')).toBe(true);
      expect(isAllowedScopeLevel(feature, 'read_write')).toBe(true);
    },
  );

  test.each(['', 'write', 'READ', 'read-write', 'admin', 'toString'])(
    '未知の値 %p を拒む',
    (level) => {
      for (const feature of API_KEY_FEATURES) {
        expect(isAllowedScopeLevel(feature, level)).toBe(false);
      }
    },
  );

  test('未知の機能を拒む', () => {
    expect(isAllowedScopeLevel('unknown' as ApiKeyFeature, 'read')).toBe(false);
  });
});

describe('DEFAULT_ISSUE_SCOPES', () => {
  test('読み取りの5機能は read、プロフィールとプロダクトの説明文は none にする', () => {
    expect(DEFAULT_ISSUE_SCOPES).toEqual({
      products: 'read',
      launches: 'read',
      upvotes: 'read',
      comments: 'read',
      ratings: 'read',
      profile: 'none',
      productDescriptions: 'none',
    });
  });

  test('すべての機能の初期値がその機能で許される値である', () => {
    for (const feature of API_KEY_FEATURES) {
      expect(isAllowedScopeLevel(feature, DEFAULT_ISSUE_SCOPES[feature])).toBe(
        true,
      );
    }
  });
});

describe('表示名', () => {
  test('7機能の表示名を網羅する', () => {
    expect(API_KEY_FEATURE_LABELS).toEqual({
      products: 'プロダクト',
      launches: 'ローンチ履歴',
      upvotes: 'Upvote',
      comments: 'コメント',
      ratings: '評価',
      profile: 'プロフィール',
      productDescriptions: 'プロダクトの説明文',
    });
    expect(Object.keys(API_KEY_FEATURE_LABELS).toSorted()).toEqual(
      [...API_KEY_FEATURES].toSorted(),
    );
  });

  test('3つの値の表示名を網羅する', () => {
    expect(API_KEY_LEVEL_LABELS).toEqual({
      none: '無効',
      read: '読み取り',
      read_write: '読み書き',
    });
  });
});
