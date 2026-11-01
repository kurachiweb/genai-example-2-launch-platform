import { describe, expect, expectTypeOf, test } from 'bun:test';

import type { MediaType } from './media-types.ts';
import {
  decodeFileNameHeader,
  downloadPathOf,
  encodeFileNameHeader,
  FILE_RELAY_PREFIX,
  UPLOAD_FILE_NAME_HEADER,
  UPLOAD_RELAY_PREFIX,
  type UploadedFile,
} from './upload-protocol.ts';

const HEADER_VALUE_PATTERN = /^[\x21-\x7e]*$/;

describe('中継の経路とヘッダーの名前', () => {
  test('アップロードとダウンロードの経路の接頭辞はフロントエンドサーバーの中継の下にある', () => {
    expect(UPLOAD_RELAY_PREFIX).toBe('/_bff/uploads/');
    expect(FILE_RELAY_PREFIX).toBe('/_bff/files/');
  });

  test('ファイル名のヘッダーの名前は小文字である', () => {
    expect(UPLOAD_FILE_NAME_HEADER).toBe('x-upload-file-name');
  });
});

describe('encodeFileNameHeader', () => {
  test.each([
    ['ASCIIの名前', 'report.pdf', 'report.pdf'],
    ['日本語の名前', '資料.pdf', '%E8%B3%87%E6%96%99.pdf'],
    ['空白', 'my file.txt', 'my%20file.txt'],
    ['百分率記号', '100%.txt', '100%25.txt'],
    ['パス区切り文字', 'a/b\\c.png', 'a%2Fb%5Cc.png'],
    ['改行', 'a\r\nb.png', 'a%0D%0Ab.png'],
    ['絵文字', '🚀.png', '%F0%9F%9A%80.png'],
  ])('%sを百分率符号化する', (_, name, expected) => {
    expect(encodeFileNameHeader(name)).toBe(expected);
  });

  test.each([
    ['日本語', '画像 (1).jpeg'],
    ['制御文字', 'a\u0000b\u007fc.txt'],
    ['結合文字', 'が.png'],
  ])('%sを含む名前をヘッダーに書ける文字だけにする', (_, name) => {
    expect(encodeFileNameHeader(name)).toMatch(HEADER_VALUE_PATTERN);
  });

  test('孤立したサロゲートを置換文字にして符号化する', () => {
    expect(encodeFileNameHeader('a\ud83d.png')).toBe('a%EF%BF%BD.png');
  });
});

describe('decodeFileNameHeader', () => {
  test.each([
    ['ASCIIの名前', 'report.pdf'],
    ['日本語の名前', '資料 2026年11月.pdf'],
    ['百分率記号', '100%.txt'],
    ['絵文字', '👨‍👩‍👧.png'],
    ['空文字列', ''],
  ])('符号化した%sを元に戻す', (_, name) => {
    expect(decodeFileNameHeader(encodeFileNameHeader(name))).toBe(name);
  });

  test('ヘッダーが無ければundefinedを返す', () => {
    expect(decodeFileNameHeader(null)).toBeUndefined();
  });

  test.each([
    ['16進でない百分率符号化', '%ZZ.png'],
    ['途中で切れた百分率符号化', 'a%E3%81.png'],
    ['末尾の百分率記号', 'report%'],
    ['UTF-8として不正なバイト列', '%FF.png'],
    ['サロゲートを符号化したバイト列', '%ED%A0%80.png'],
  ])('%sならundefinedを返す', (_, value) => {
    expect(decodeFileNameHeader(value)).toBeUndefined();
  });
});

describe('downloadPathOf', () => {
  test('ダウンロードの経路の接頭辞にファイルの識別子を続ける', () => {
    expect(downloadPathOf('01JCK6Z0V8D9W9Q4M2N3P5R7T1')).toBe(
      '/_bff/files/01JCK6Z0V8D9W9Q4M2N3P5R7T1',
    );
  });

  test.each([
    ['パス区切り文字', '../a/b', '/_bff/files/..%2Fa%2Fb'],
    ['クエリ', 'a?b#c', '/_bff/files/a%3Fb%23c'],
  ])(
    '識別子の%sを百分率符号化して経路の1階層に収める',
    (_, fileId, expected) => {
      expect(downloadPathOf(fileId)).toBe(expected);
    },
  );
});

describe('UploadedFile', () => {
  test('アップロードの応答のファイルは形式を形式の一覧の型で持つ', () => {
    expectTypeOf<UploadedFile>().toEqualTypeOf<{
      readonly fileId: string;
      readonly originalFileName: string;
      readonly contentType: MediaType;
      readonly byteSize: number;
      readonly width: number | null;
      readonly height: number | null;
      readonly objectKey: string | null;
    }>();
  });
});
