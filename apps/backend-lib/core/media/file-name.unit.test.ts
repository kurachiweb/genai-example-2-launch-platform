import { describe, expect, test } from 'bun:test';

import type { MediaType } from '../../../common-lib/media/media-types.ts';
import {
  attachmentDisposition,
  MAX_FILE_NAME_BYTES,
  sanitizeFileName,
} from './file-name.ts';

const encoder = new TextEncoder();

const byteLengthOf = (text: string): number => encoder.encode(text).length;

const FAMILY_EMOJI = '👨\u200d👩\u200d👧\u200d👦';

const JAPANESE_FLAG = '🇯🇵';

const COMBINING_ACUTE = '\u0301';

const PRINTABLE_ASCII_HEADER = /^[\u0020-\u007e]*$/;

const EXT_VALUE = /^(?:[A-Za-z0-9!#$&+\-.^_`|~]|%[0-9A-F]{2})*$/;

describe('sanitizeFileName', () => {
  test('上限のバイト数は255である', () => {
    expect(MAX_FILE_NAME_BYTES).toBe(255);
  });

  test.each([
    ['スラッシュ', 'dir/sub/photo.png', 'dirsubphoto.png'],
    ['バックスラッシュ', 'C:\\Users\\photo.png', 'C:Usersphoto.png'],
    ['親ディレクトリへの移動', '../../etc/passwd', 'etcpasswd'],
  ])('パス区切り文字を除く(%s)', (_label, raw, expected) => {
    expect(sanitizeFileName(raw, 'image/png')).toBe(expected);
  });

  test.each([
    ['NUL', 'a\u0000b.txt'],
    ['タブ', 'a\tb.txt'],
    ['改行', 'a\nb.txt'],
    ['復帰', 'a\rb.txt'],
    ['C0の最後', 'a\u001fb.txt'],
    ['DEL', 'a\u007fb.txt'],
    ['C1の最初', 'a\u0080b.txt'],
    ['C1の最後', 'a\u009fb.txt'],
  ])('制御文字を除く(%s)', (_label, raw) => {
    expect(sanitizeFileName(raw, 'text/plain')).toBe('ab.txt');
  });

  test.each([
    ['ARABIC LETTER MARK', '\u061c'],
    ['LEFT-TO-RIGHT MARK', '\u200e'],
    ['RIGHT-TO-LEFT MARK', '\u200f'],
    ['LEFT-TO-RIGHT EMBEDDING', '\u202a'],
    ['RIGHT-TO-LEFT EMBEDDING', '\u202b'],
    ['POP DIRECTIONAL FORMATTING', '\u202c'],
    ['LEFT-TO-RIGHT OVERRIDE', '\u202d'],
    ['RIGHT-TO-LEFT OVERRIDE', '\u202e'],
    ['LEFT-TO-RIGHT ISOLATE', '\u2066'],
    ['RIGHT-TO-LEFT ISOLATE', '\u2067'],
    ['FIRST STRONG ISOLATE', '\u2068'],
    ['POP DIRECTIONAL ISOLATE', '\u2069'],
  ])('双方向の制御文字を除く(%s)', (_label, character) => {
    expect(sanitizeFileName(`a${character}b.txt`, 'text/plain')).toBe('ab.txt');
  });

  test('右から左への上書きで拡張子を偽装した名前は、実際の拡張子の並びに戻る', () => {
    expect(sanitizeFileName('invoice\u202egpj.exe', 'application/pdf')).toBe(
      'invoicegpj.exe',
    );
  });

  test.each([
    ['範囲の直前のU+061B', '\u061b'],
    ['範囲の直後のU+061D', '\u061d'],
    ['ZERO WIDTH NON-JOINER', '\u200c'],
    ['ZERO WIDTH JOINER', '\u200d'],
    ['範囲の直後のU+2010', '\u2010'],
    ['範囲の直前のU+2029', '\u2029'],
    ['範囲の直後のU+202F', '\u202f'],
    ['範囲の直前のU+2065', '\u2065'],
    ['範囲の直後のU+206A', '\u206a'],
    ['異体字セレクタ16', '\ufe0f'],
  ])(
    '双方向の制御文字に当たらない書式文字などは残す(%s)',
    (_label, character) => {
      expect(sanitizeFileName(`a${character}b.txt`, 'text/plain')).toBe(
        `a${character}b.txt`,
      );
    },
  );

  test('結合子と異体字セレクタを含む絵文字は形を保つ', () => {
    const raw = `${FAMILY_EMOJI}❤\ufe0f.png`;

    expect(sanitizeFileName(raw, 'image/png')).toBe(raw);
  });

  test('制御文字に当たらない隣の文字は残す', () => {
    expect(sanitizeFileName('a\u0020b\u00a0c\u00a1.txt', 'text/plain')).toBe(
      'a\u0020b\u00a0c\u00a1.txt',
    );
  });

  test.each([
    ['1つ', '.env', 'env'],
    ['複数', '...hidden.txt', 'hidden.txt'],
    ['空白の後', ' .profile', 'profile'],
    ['空白と交互', '. . .profile', 'profile'],
    ['制御文字を除いた後', '\u0000.secret', 'secret'],
    ['パス区切り文字を除いた後', '/.ssh', 'ssh'],
    ['双方向の制御文字を除いた後', '\u202e.txt', 'txt'],
  ])('先頭のドットを除く(%s)', (_label, raw, expected) => {
    expect(sanitizeFileName(raw, 'text/plain')).toBe(expected);
  });

  test('途中と末尾のドットは残す', () => {
    expect(sanitizeFileName('a.b.c.', 'text/plain')).toBe('a.b.c.');
  });

  test.each([
    ['半角空白', '  report.pdf  ', 'report.pdf'],
    ['全角空白', '\u3000報告.pdf\u3000', '報告.pdf'],
    ['ノーブレークスペース', '\u00a0report.pdf\u00a0', 'report.pdf'],
  ])('前後の空白を除く(%s)', (_label, raw, expected) => {
    expect(sanitizeFileName(raw, 'application/pdf')).toBe(expected);
  });

  test('途中の空白は残す', () => {
    expect(sanitizeFileName('my  report.pdf', 'application/pdf')).toBe(
      'my  report.pdf',
    );
  });

  test('255バイト以内の名前はそのまま残す', () => {
    const raw = 'a'.repeat(255);

    expect(sanitizeFileName(raw, 'text/plain')).toBe(raw);
  });

  test('ASCIIの名前を255バイトで切る', () => {
    expect(sanitizeFileName('a'.repeat(300), 'text/plain')).toBe(
      'a'.repeat(255),
    );
  });

  test('日本語の名前を文字の途中で切らずに255バイト以内に切る', () => {
    const sanitized = sanitizeFileName('あ'.repeat(100), 'text/plain');

    expect(sanitized).toBe('あ'.repeat(85));
    expect(byteLengthOf(sanitized)).toBe(255);
  });

  test('日本語の名前で上限に1バイト足りなければその文字を含めない', () => {
    const sanitized = sanitizeFileName(`a${'あ'.repeat(85)}`, 'text/plain');

    expect(sanitized).toBe(`a${'あ'.repeat(84)}`);
    expect(byteLengthOf(sanitized)).toBe(253);
  });

  test('結合した絵文字は上限ちょうどなら残す', () => {
    const raw = `${'a'.repeat(230)}${FAMILY_EMOJI}`;

    expect(byteLengthOf(raw)).toBe(255);
    expect(sanitizeFileName(raw, 'text/plain')).toBe(raw);
  });

  test('結合した絵文字は上限を超えればまとめて除き、途中で切らない', () => {
    const raw = `${'a'.repeat(231)}${FAMILY_EMOJI}`;

    expect(sanitizeFileName(raw, 'text/plain')).toBe('a'.repeat(231));
  });

  test('国旗の絵文字は地域指示記号の組の途中で切らない', () => {
    const raw = `${'a'.repeat(250)}${JAPANESE_FLAG}`;

    expect(sanitizeFileName(raw, 'text/plain')).toBe('a'.repeat(250));
  });

  test('結合文字は基底の文字から切り離さない', () => {
    const raw = `${'a'.repeat(253)}e${COMBINING_ACUTE}`;

    expect(sanitizeFileName(raw, 'text/plain')).toBe('a'.repeat(253));
  });

  test('切り詰めた後の末尾の空白を除く', () => {
    expect(sanitizeFileName(`${'a'.repeat(254)} b`, 'text/plain')).toBe(
      'a'.repeat(254),
    );
  });

  test('先頭の1文字だけで上限を超える名前は既定の名前にする', () => {
    const raw = `a${COMBINING_ACUTE.repeat(200)}`;

    expect(sanitizeFileName(raw, 'image/png')).toBe('image.png');
  });

  test('対になっていないサロゲートは置換文字にする', () => {
    const sanitized = sanitizeFileName('a\ud800b.txt', 'text/plain');

    expect(sanitized).toBe('a\ufffdb.txt');
    expect(sanitized.isWellFormed()).toBe(true);
  });

  test.each<[MediaType, string]>([
    ['image/jpeg', 'image.jpg'],
    ['image/png', 'image.png'],
    ['image/gif', 'image.gif'],
    ['image/webp', 'image.webp'],
    ['image/svg+xml', 'image.svg'],
    ['application/pdf', 'document.pdf'],
    ['text/plain', 'text.txt'],
  ])('名前が無ければ形式の既定名にする(%s)', (type, expected) => {
    expect(sanitizeFileName(undefined, type)).toBe(expected);
  });

  test.each([
    ['空文字列', ''],
    ['ドットだけ', '...'],
    ['空白だけ', ' \u3000 '],
    ['パス区切り文字だけ', '/\\/'],
    ['制御文字だけ', '\u0000\r\n'],
    ['双方向の制御文字だけ', '\u202e\u2066\u200f'],
    ['双方向の制御文字と空白とドット', '\u202e . \u2069'],
    ['ドットと空白とパス区切り文字', ' ./. '],
  ])('除いた結果が空なら形式の既定名にする(%s)', (_label, raw) => {
    expect(sanitizeFileName(raw, 'application/pdf')).toBe('document.pdf');
  });
});

describe('attachmentDisposition', () => {
  test('ASCIIの名前は代替と百分率符号化の両方に同じ名前を入れる', () => {
    expect(attachmentDisposition('report.pdf')).toBe(
      `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`,
    );
  });

  test('日本語の名前はfilename*にUTF-8の百分率符号化で入れ、代替を_に置き換える', () => {
    expect(attachmentDisposition('報告書.pdf')).toBe(
      `attachment; filename="___.pdf"; filename*=UTF-8''%E5%A0%B1%E5%91%8A%E6%9B%B8.pdf`,
    );
  });

  test('代替はASCII以外の文字をコードポイントごとに_へ置き換える', () => {
    expect(attachmentDisposition('😀.png')).toBe(
      `attachment; filename="_.png"; filename*=UTF-8''%F0%9F%98%80.png`,
    );
  });

  test('代替は二重引用符とバックスラッシュを_に置き換える', () => {
    expect(attachmentDisposition('a"b\\c.txt')).toBe(
      `attachment; filename="a_b_c.txt"; filename*=UTF-8''a%22b%5Cc.txt`,
    );
  });

  test("filename*はRFC 5987のattr-charに無い'・(・)・*・空白も符号化する", () => {
    expect(attachmentDisposition("it's (1)*.txt")).toBe(
      `attachment; filename="it's (1)*.txt"; filename*=UTF-8''it%27s%20%281%29%2A.txt`,
    );
  });

  test('filename*はattr-charと百分率符号化だけからなり、復号すると元の名前に戻る', () => {
    const fileName = "!#$&+-.^_`|~ '()*%;,=?@[]{}<>報告.txt";

    const extendedValue =
      attachmentDisposition(fileName).split("filename*=UTF-8''")[1];

    expect(extendedValue).toMatch(EXT_VALUE);
    expect(decodeURIComponent(extendedValue ?? '')).toBe(fileName);
  });

  test('改行と制御文字を含む名前でも改行を含むヘッダー値を作らない', () => {
    const header = attachmentDisposition('a\r\nb\u0000c\u007f.txt');

    expect(header).toBe(
      `attachment; filename="a__b_c_.txt"; filename*=UTF-8''a%0D%0Ab%00c%7F.txt`,
    );
    expect(PRINTABLE_ASCII_HEADER.test(header)).toBe(true);
  });

  test('対になっていないサロゲートを含む名前でも例外を投げない', () => {
    expect(attachmentDisposition('a\udc00.txt')).toBe(
      `attachment; filename="a_.txt"; filename*=UTF-8''a%EF%BF%BD.txt`,
    );
  });
});

const createRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
};

const FUZZ_PIECES: readonly string[] = Object.freeze([
  'a',
  'Z',
  '0',
  '.',
  ' ',
  '\u3000',
  '/',
  '\\',
  '"',
  "'",
  '%',
  ';',
  '\r',
  '\n',
  '\u0000',
  '\u007f',
  '\u0085',
  '\u2028',
  'あ',
  '漢',
  COMBINING_ACUTE,
  FAMILY_EMOJI,
  JAPANESE_FLAG,
  '\ud800',
  '\udfff',
]);

const MEDIA_TYPES: readonly MediaType[] = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
  'text/plain',
]);

const isForbiddenInFileName = (character: string): boolean => {
  const code = character.charCodeAt(0);
  return (
    character === '/' ||
    character === '\\' ||
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f)
  );
};

const WHITE_SPACE_AT_EDGE = /^\p{White_Space}|\p{White_Space}$/u;

describe('どの入力でも', () => {
  test('255バイト以内で禁止文字と先頭のドットを含まない名前と、印字可能なASCIIだけのヘッダー値を作る', () => {
    const random = createRandom(20_261_101);
    const pick = <T>(items: readonly T[]): T =>
      items[Math.floor(random() * items.length)] as T;

    for (let round = 0; round < 2000; round += 1) {
      const length = Math.floor(random() * 160);
      const raw = Array.from({ length }, () => pick(FUZZ_PIECES)).join('');
      const type = pick(MEDIA_TYPES);

      const sanitized = sanitizeFileName(raw, type);
      const header = attachmentDisposition(sanitized);

      expect(sanitized.length).toBeGreaterThan(0);
      expect(byteLengthOf(sanitized)).toBeLessThanOrEqual(MAX_FILE_NAME_BYTES);
      expect(sanitized.isWellFormed()).toBe(true);
      expect(Array.from(sanitized).some(isForbiddenInFileName)).toBe(false);
      expect(sanitized.startsWith('.')).toBe(false);
      expect(WHITE_SPACE_AT_EDGE.test(sanitized)).toBe(false);
      expect(PRINTABLE_ASCII_HEADER.test(header)).toBe(true);
    }
  });
});
