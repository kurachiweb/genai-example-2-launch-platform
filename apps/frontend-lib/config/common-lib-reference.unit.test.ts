import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { countGraphemes } from '../../common-lib/text/graphemes.ts';

const APP_DIR = join(import.meta.dirname, '..');

const SIBLING_COMMON_LIB_DIR = join(APP_DIR, '..', 'common-lib');

// 単体テストのカバレッジは読み込んだ共用部品のファイルも分母に数えるため、読み込むのは関数をすべて呼べる小さなファイルに限り、描画のパッケージは解決だけを確かめる
const COMMON_LIB_RUNTIME_PACKAGES = [
  'unified',
  'remark-parse',
  'remark-gfm',
  'remark-cjk-friendly/parseOnly',
  'remark-cjk-friendly-gfm-strikethrough/parseOnly',
  'remark-rehype',
  'rehype-sanitize',
  'rehype-stringify',
  'hast-util-to-text',
  'zod',
] as const;

describe('共用部品の兄弟の相対パスでの参照', () => {
  test('共通部品と同じ階層に並ぶ共用部品のファイルへ解決される', () => {
    const resolved = Bun.resolveSync(
      '../../common-lib/text/graphemes.ts',
      import.meta.dirname,
    );

    expect(resolved).toBe(join(SIBLING_COMMON_LIB_DIR, 'text', 'graphemes.ts'));
  });

  test('読み込んだ共用部品の関数を呼べる', () => {
    expect(countGraphemes('👨‍👩‍👧あ')).toBe(2);
  });

  test.each(COMMON_LIB_RUNTIME_PACKAGES)(
    '共用部品の位置から実行時のパッケージ%sを解決できる',
    (packageName) => {
      expect(() =>
        Bun.resolveSync(packageName, join(SIBLING_COMMON_LIB_DIR, 'markdown')),
      ).not.toThrow();
    },
  );
});
