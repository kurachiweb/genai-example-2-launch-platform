import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import {
  fallbackFormatOf,
  isImageMediaType,
  parseMediaType,
} from '../../common-lib/media/media-types.ts';
import {
  decodeFileNameHeader,
  downloadPathOf,
  encodeFileNameHeader,
} from '../../common-lib/media/upload-protocol.ts';
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

// 中継の経路(server/media)が形式の一覧とアップロードのプロトコルを読み込むため、両ファイルの関数もここで呼ぶ
describe('中継の経路が読み込む共用部品のメディアの定義', () => {
  test('形式の解釈と判定の関数を呼べる', () => {
    expect(parseMediaType(null)).toBeUndefined();
    expect(parseMediaType('application/zip')).toBeUndefined();
    expect(parseMediaType('IMAGE/PNG')).toBe('image/png');
    expect(parseMediaType('text/plain; format=flowed; charset="UTF-8"')).toBe(
      'text/plain',
    );
    expect(parseMediaType('text/plain; charset=shift_jis')).toBeUndefined();
    expect(parseMediaType('text/plain; charset="utf-8')).toBeUndefined();
    expect(isImageMediaType('image/svg+xml')).toBe(true);
    expect(isImageMediaType('application/pdf')).toBe(false);
    expect(fallbackFormatOf('image/jpeg')).toBe('jpg');
    expect(fallbackFormatOf('image/svg+xml')).toBe('svg');
    expect(fallbackFormatOf('image/webp')).toBe('png');
  });

  test('ファイル名の項目とダウンロードの経路の関数を呼べる', () => {
    expect(decodeFileNameHeader(encodeFileNameHeader('資料 1.pdf'))).toBe(
      '資料 1.pdf',
    );
    expect(decodeFileNameHeader(null)).toBeUndefined();
    expect(decodeFileNameHeader('%E0%A4%A')).toBeUndefined();
    expect(downloadPathOf('a/b')).toBe('/_bff/files/a%2Fb');
  });
});
