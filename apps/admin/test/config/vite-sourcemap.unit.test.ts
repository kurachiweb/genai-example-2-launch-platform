import { describe, expect, test } from 'bun:test';

import viteConfig from '../../vite.config.ts';

describe('Viteのビルド設定のソースマップ', () => {
  test('デバッグIDの埋め込みとアップロードのため、配信物から参照しないソースマップを出力する', () => {
    expect(viteConfig).toMatchObject({ build: { sourcemap: 'hidden' } });
  });
});
