import { describe, expect, test } from 'bun:test';

import { getAppLogger } from './app-logger.ts';

describe('getAppLogger', () => {
  test('アプリ・層・モジュールのカテゴリを持つロガーを返す', () => {
    const logger = getAppLogger(['api', 'application', 'rate-limit']);

    expect(logger.category).toEqual(['api', 'application', 'rate-limit']);
  });

  test('アプリ名だけのカテゴリも受け付ける', () => {
    const logger = getAppLogger(['event']);

    expect(logger.category).toEqual(['event']);
  });

  test('同じカテゴリは同じロガーを返す', () => {
    const first = getAppLogger(['event', 'infrastructure', 'queue']);
    const second = getAppLogger(['event', 'infrastructure', 'queue']);

    expect(second).toBe(first);
  });

  test('アプリ名の無いカテゴリは型で拒否する', () => {
    // @ts-expect-error -- カテゴリの先頭にアプリ名が必要
    const logger = getAppLogger([]);

    expect(logger.category).toEqual([]);
  });
});
