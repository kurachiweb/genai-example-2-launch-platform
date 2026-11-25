import { describe, expect, test } from 'bun:test';

import type { CounterRule } from '../../../lib/core/rate-limit/fixed-window.ts';
import type { ApiAccess } from '../../domain/public-api/api-key-scopes.ts';
import {
  API_KEY_ISSUE_RULE,
  PUBLIC_API_IP_RATE_LIMIT,
  PUBLIC_API_READ_RULE,
  PUBLIC_API_WRITE_RULE,
  ruleForAccess,
} from './rate-limit-rules.ts';

describe('公開APIの回数の規則', () => {
  test('発行の規則は利用者ごとに1時間3回である', () => {
    expect(API_KEY_ISSUE_RULE).toEqual({
      name: 'api-key-issue-by-user',
      limit: 3,
      windowSeconds: 3600,
    });
  });

  test('読み取りの規則は利用者ごとに1分30回である', () => {
    expect(PUBLIC_API_READ_RULE).toEqual({
      name: 'public-api-read-by-user',
      limit: 30,
      windowSeconds: 60,
    });
  });

  test('書き込みの規則は利用者ごとに1分15回である', () => {
    expect(PUBLIC_API_WRITE_RULE).toEqual({
      name: 'public-api-write-by-user',
      limit: 15,
      windowSeconds: 60,
    });
  });

  test('3つの規則の名前は互いに異なり、厳密カウンタを別に数える', () => {
    const names = [
      API_KEY_ISSUE_RULE,
      PUBLIC_API_READ_RULE,
      PUBLIC_API_WRITE_RULE,
    ].map(({ name }) => name);

    expect(new Set(names).size).toBe(names.length);
  });

  test('IP単位の制限は60秒あたり60回である', () => {
    expect(PUBLIC_API_IP_RATE_LIMIT).toEqual({ limit: 60, periodSeconds: 60 });
  });

  test('規則とIP単位の制限の値は実行時に書き換えられない', () => {
    for (const value of [
      API_KEY_ISSUE_RULE,
      PUBLIC_API_READ_RULE,
      PUBLIC_API_WRITE_RULE,
      PUBLIC_API_IP_RATE_LIMIT,
    ]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
  });
});

describe('ruleForAccess', () => {
  test.each<[ApiAccess, CounterRule]>([
    ['read', PUBLIC_API_READ_RULE],
    ['write', PUBLIC_API_WRITE_RULE],
  ])('%sの操作には対応する利用者単位の規則を選ぶ', (access, expected) => {
    expect(ruleForAccess(access)).toBe(expected);
  });

  test('どの操作にも発行の規則を選ばない', () => {
    for (const access of ['read', 'write'] as const) {
      expect(ruleForAccess(access)).not.toBe(API_KEY_ISSUE_RULE);
    }
  });
});
