import { describe, expect, test } from 'bun:test';

import { isSystemStatusAvailable } from './system-status-availability.ts';

describe('isSystemStatusAvailable', () => {
  test('ローカル環境では疎通確認の画面を公開する', () => {
    expect(isSystemStatusAvailable('local')).toBe(true);
  });

  test('stagingでは疎通確認の画面を公開する', () => {
    expect(isSystemStatusAvailable('staging')).toBe(true);
  });

  test('prodでは疎通確認の画面を公開しない', () => {
    expect(isSystemStatusAvailable('prod')).toBe(false);
  });
});
