import { describe, expect, test } from 'bun:test';

import {
  archiveFileName,
  createEntryNameAllocator,
  EXPORT_SCHEMA_VERSION,
  README_TEXT,
  toPortableFileName,
} from './archive-names.ts';

describe('toPortableFileName', () => {
  test.each([
    [':', 'a:b.png', 'a-b.png'],
    ['*', 'a*b.png', 'a-b.png'],
    ['?', 'a?b.png', 'a-b.png'],
    ['"', 'a"b.png', 'a-b.png'],
    ['<', 'a<b.png', 'a-b.png'],
    ['>', 'a>b.png', 'a-b.png'],
    ['|', 'a|b.png', 'a-b.png'],
  ])('禁止文字%sを-へ置換する', (_character, input, expected) => {
    expect(toPortableFileName(input)).toBe(expected);
  });

  test('禁止文字が連続していても1文字ずつ置換する', () => {
    expect(toPortableFileName('a:*?"<>|b.txt')).toBe('a-------b.txt');
  });

  test('拡張子にある禁止文字も置換する', () => {
    expect(toPortableFileName('a.p:g')).toBe('a.p-g');
  });

  test('禁止文字でない記号と日本語と絵文字はそのまま残す', () => {
    expect(toPortableFileName('画面 (1)_v2-最終😀.png')).toBe(
      '画面 (1)_v2-最終😀.png',
    );
  });

  test.each([
    ['a. .png', 'a.png'],
    ['a..png', 'a.png'],
    ['a  .png', 'a.png'],
    ['a.. . .png', 'a.png'],
    ['a.b..png', 'a.b.png'],
    ['a. .b.', 'a.b'],
  ])(
    '拡張子を除いた部分の末尾の.と半角スペースを全て除去する(%s)',
    (input, expected) => {
      expect(toPortableFileName(input)).toBe(expected);
    },
  );

  test('拡張子を除いた部分の先頭と途中の.と半角スペースは残す', () => {
    expect(toPortableFileName(' a b.c.png')).toBe(' a b.c.png');
  });

  test('拡張子の無い名前の末尾の.と半角スペースも除去する', () => {
    expect(toPortableFileName('notes. .')).toBe('notes');
    expect(toPortableFileName('notes. ')).toBe('notes');
  });

  test('空の拡張子の区切りの.は残さない', () => {
    expect(toPortableFileName('notes.')).toBe('notes');
  });

  test.each([
    ['con.txt', 'con_.txt'],
    ['CON.txt', 'CON_.txt'],
    ['Prn.png', 'Prn_.png'],
    ['aux.png', 'aux_.png'],
    ['NuL.png', 'NuL_.png'],
    ['LPT9.png', 'LPT9_.png'],
    ['lpt1.png', 'lpt1_.png'],
    ['com1.png', 'com1_.png'],
    ['COM9.png', 'COM9_.png'],
  ])('予約されたデバイス名%sの末尾へ_を付ける', (input, expected) => {
    expect(toPortableFileName(input)).toBe(expected);
  });

  test('拡張子の無い予約名にも_を付ける', () => {
    expect(toPortableFileName('Com1')).toBe('Com1_');
    expect(toPortableFileName('NUL')).toBe('NUL_');
  });

  test('末尾の.と半角スペースを除去した結果が予約名なら_を付ける', () => {
    expect(toPortableFileName('con . .png')).toBe('con_.png');
  });

  test('末尾の.の除去で拡張子の境界が移る名前でも予約名に_を付ける', () => {
    expect(toPortableFileName('con.txt.')).toBe('con_.txt');
    expect(toPortableFileName('con.con.')).toBe('con_.con');
    expect(toPortableFileName('LPT1.txt. .')).toBe('LPT1_.txt');
  });

  test.each([
    'COM0.png',
    'COM10.png',
    'LPT0.png',
    'console.png',
    'con_.png',
    'xcon.png',
    'com1a.png',
    'a.con',
  ])('予約名と一致しない%sには_を付けない', (input) => {
    expect(toPortableFileName(input)).toBe(input);
  });

  test('拡張子が予約名でも、拡張子を除いた部分が一致しなければ_を付けない', () => {
    expect(toPortableFileName('photo.con')).toBe('photo.con');
  });

  test('変換後の名前が空になるときはfileにする', () => {
    expect(toPortableFileName('')).toBe('file');
    expect(toPortableFileName('.')).toBe('file');
    expect(toPortableFileName('...')).toBe('file');
    expect(toPortableFileName(' . ')).toBe('file');
  });

  test('拡張子だけの名前は拡張子を保つ', () => {
    expect(toPortableFileName('.png')).toBe('.png');
    expect(toPortableFileName(' .png')).toBe('.png');
  });

  test('変換済みの名前に再び適用しても変わらない', () => {
    const inputs = [
      'a:b. .png',
      'con.txt',
      'Com1',
      '',
      '...',
      'a.',
      '.png',
      '画面.png',
      'con.txt.',
      'con.con.',
      'a. .b.',
    ];

    for (const input of inputs) {
      const once = toPortableFileName(input);
      expect(toPortableFileName(once)).toBe(once);
    }
  });
});

describe('createEntryNameAllocator', () => {
  test('衝突しない名前はそのまま返す', () => {
    const allocator = createEntryNameAllocator();

    expect(allocator.allocate('products/a/screenshots', 'one.png')).toBe(
      'one.png',
    );
    expect(allocator.allocate('products/a/screenshots', 'two.png')).toBe(
      'two.png',
    );
  });

  test('同じ名前の2つ目以降へ拡張子の前に-2から連番を付ける', () => {
    const allocator = createEntryNameAllocator();

    const names = [1, 2, 3].map(() => allocator.allocate('dir', 'shot.png'));

    expect(names).toEqual(['shot.png', 'shot-2.png', 'shot-3.png']);
  });

  test('大文字小文字を区別せずに衝突とみなし、元の大文字小文字を残す', () => {
    const allocator = createEntryNameAllocator();

    expect(allocator.allocate('dir', 'Shot.PNG')).toBe('Shot.PNG');
    expect(allocator.allocate('dir', 'shot.png')).toBe('shot-2.png');
    expect(allocator.allocate('dir', 'SHOT.Png')).toBe('SHOT-3.Png');
  });

  test('付けた名前が既存の名前と衝突するなら衝突しなくなるまで連番を増やす', () => {
    const allocator = createEntryNameAllocator();

    expect(allocator.allocate('dir', 'shot.png')).toBe('shot.png');
    expect(allocator.allocate('dir', 'shot-2.png')).toBe('shot-2.png');
    expect(allocator.allocate('dir', 'SHOT.png')).toBe('SHOT-3.png');
  });

  test('先に連番付きの名前が使われていても飛ばして連番を付ける', () => {
    const allocator = createEntryNameAllocator();

    expect(allocator.allocate('dir', 'shot-2.png')).toBe('shot-2.png');
    expect(allocator.allocate('dir', 'shot-3.png')).toBe('shot-3.png');
    expect(allocator.allocate('dir', 'shot.png')).toBe('shot.png');
    expect(allocator.allocate('dir', 'shot.png')).toBe('shot-4.png');
  });

  test('連番は最後の.の前へ付け、途中の.は動かさない', () => {
    const allocator = createEntryNameAllocator();

    allocator.allocate('dir', 'archive.tar.gz');

    expect(allocator.allocate('dir', 'archive.tar.gz')).toBe(
      'archive.tar-2.gz',
    );
  });

  test('拡張子の無い名前の末尾へ連番を付ける', () => {
    const allocator = createEntryNameAllocator();

    allocator.allocate('dir', 'README');

    expect(allocator.allocate('dir', 'readme')).toBe('readme-2');
  });

  test('拡張子だけの名前へも連番を付けられる', () => {
    const allocator = createEntryNameAllocator();

    allocator.allocate('dir', '.png');

    expect(allocator.allocate('dir', '.png')).toBe('-2.png');
  });

  test('ディレクトリごとに独立して連番を数える', () => {
    const allocator = createEntryNameAllocator();

    expect(allocator.allocate('inquiries/1/10', 'shot.png')).toBe('shot.png');
    expect(allocator.allocate('inquiries/1/11', 'shot.png')).toBe('shot.png');
    expect(allocator.allocate('inquiries/1/10', 'shot.png')).toBe('shot-2.png');
    expect(allocator.allocate('inquiries/1/11', 'shot.png')).toBe('shot-2.png');
  });

  test('ディレクトリの名前は大文字小文字を区別して別のものとして扱う', () => {
    const allocator = createEntryNameAllocator();

    expect(allocator.allocate('Dir', 'a.png')).toBe('a.png');
    expect(allocator.allocate('dir', 'a.png')).toBe('a.png');
  });

  test('アロケーターごとに状態を持ち、互いに影響しない', () => {
    const first = createEntryNameAllocator();
    const second = createEntryNameAllocator();

    first.allocate('dir', 'a.png');

    expect(second.allocate('dir', 'a.png')).toBe('a.png');
  });

  test('1万件の同名のファイルへ重複なく連番を付ける', () => {
    const allocator = createEntryNameAllocator();
    const count = 10_000;

    const names = Array.from({ length: count }, () =>
      allocator.allocate('dir', 'shot.png'),
    );

    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(count);
    expect(names[count - 1]).toBe(`shot-${String(count)}.png`);
  });
});

describe('archiveFileName', () => {
  test('ハンドルと基準時刻の日付からZIPのファイル名を作る', () => {
    expect(
      archiveFileName('KurachiWeb', new Date('2026-09-15T10:12:30.000Z')),
    ).toBe('launch-stadium-export-KurachiWeb-20260915.zip');
  });

  test('基準時刻の日付はUTCの8時に切り替わる', () => {
    expect(archiveFileName('u', new Date('2026-09-15T07:59:59.999Z'))).toBe(
      'launch-stadium-export-u-20260914.zip',
    );
    expect(archiveFileName('u', new Date('2026-09-15T08:00:00.000Z'))).toBe(
      'launch-stadium-export-u-20260915.zip',
    );
  });

  test('UTCの日付と基準時刻の日付が異なる時刻でも基準時刻の日付を使う', () => {
    expect(archiveFileName('u', new Date('2026-09-15T00:00:00.000Z'))).toBe(
      'launch-stadium-export-u-20260914.zip',
    );
    expect(archiveFileName('u', new Date('2026-09-15T23:59:59.999Z'))).toBe(
      'launch-stadium-export-u-20260915.zip',
    );
  });

  test('月と年の境界でも日付を繰り下げる', () => {
    expect(archiveFileName('u', new Date('2026-03-01T07:00:00.000Z'))).toBe(
      'launch-stadium-export-u-20260228.zip',
    );
    expect(archiveFileName('u', new Date('2027-01-01T03:00:00.000Z'))).toBe(
      'launch-stadium-export-u-20261231.zip',
    );
  });

  test('ハンドルの大文字小文字を変えずに使う', () => {
    expect(
      archiveFileName('Mixed_Case-1', new Date('2026-09-15T10:00:00.000Z')),
    ).toBe('launch-stadium-export-Mixed_Case-1-20260915.zip');
  });

  test('不正な日時はRangeErrorにする', () => {
    expect(() => archiveFileName('u', new Date(Number.NaN))).toThrow(
      RangeError,
    );
  });
});

describe('EXPORT_SCHEMA_VERSION', () => {
  test('構造のバージョンは1である', () => {
    expect(EXPORT_SCHEMA_VERSION).toBe(1);
  });
});

describe('README_TEXT', () => {
  test('データエクスポートの文書の文面と一致する', () => {
    expect(README_TEXT).toBe(
      [
        'Launch Stadiumをご利用いただきありがとうございます。',
        '',
        'このアーカイブには、あなたがLaunch Stadiumで登録・投稿したデータと、あなたのプロダクトが受けた対戦成績が含まれています。',
        '',
        'JSONファイル一覧はmanifest.jsonをご覧ください。',
        'プロダクトの説明文やコメントなどのマークダウン本文は、各JSONから相対パスで参照される.mdファイルに保存されています。',
        '',
      ].join('\n'),
    );
  });

  test('改行はLFだけで、BOMを含まない', () => {
    expect(README_TEXT).not.toContain('\r');
    expect(README_TEXT.startsWith('﻿')).toBe(false);
    expect(README_TEXT.endsWith('\n')).toBe(true);
  });
});
