import type { MediaType } from '../../../common-lib/media/media-types.ts';
import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';

export const MAX_FILE_NAME_BYTES = 255;

const DEFAULT_FILE_NAMES: Readonly<Record<MediaType, string>> = Object.freeze({
  'image/jpeg': 'image.jpg',
  'image/png': 'image.png',
  'image/gif': 'image.gif',
  'image/webp': 'image.webp',
  'image/svg+xml': 'image.svg',
  'application/pdf': 'document.pdf',
  'text/plain': 'text.txt',
});

const PATH_SEPARATORS: ReadonlySet<string> = new Set(['/', '\\']);

const LAST_C0_CONTROL_CODE = 0x1f;

const FIRST_DELETE_OR_C1_CONTROL_CODE = 0x7f;

const LAST_C1_CONTROL_CODE = 0x9f;

// 表示の向きを変えて拡張子を偽装できる双方向の制御文字。絵文字の結合に使うZWJ・異体字セレクタなどの他の書式文字は残す
const BIDIRECTIONAL_CONTROL_CHARACTERS: ReadonlySet<string> = new Set([
  '\u061c',
  '\u200e',
  '\u200f',
  '\u202a',
  '\u202b',
  '\u202c',
  '\u202d',
  '\u202e',
  '\u2066',
  '\u2067',
  '\u2068',
  '\u2069',
]);

const isRemovedCharacter = (character: string): boolean => {
  const code = character.charCodeAt(0);
  return (
    PATH_SEPARATORS.has(character) ||
    BIDIRECTIONAL_CONTROL_CHARACTERS.has(character) ||
    code <= LAST_C0_CONTROL_CODE ||
    (code >= FIRST_DELETE_OR_C1_CONTROL_CODE && code <= LAST_C1_CONTROL_CODE)
  );
};

// 除く文字は全て基本多言語面にあるため、UTF-16の単位で1つずつ調べる
const removeForbiddenCharacters = (text: string): string =>
  Array.from({ length: text.length }, (_, index) => text.charAt(index))
    .filter((character) => !isRemovedCharacter(character))
    .join('');

const LEADING_DOT = '.';

const WHITE_SPACE_CHARACTER = /^\p{White_Space}$/u;

const graphemeSegmenter = new Intl.Segmenter('und', {
  granularity: 'grapheme',
});

const encoder = new TextEncoder();

const isLeadingRemovable = (character: string): boolean =>
  character === LEADING_DOT || WHITE_SPACE_CHARACTER.test(character);

// 空白を除いた後に現れるドットも隠しファイルの名前になるため、ドットと空白の並びをまとめて除く
const removeLeadingDotsAndWhiteSpace = (text: string): string => {
  let start = 0;
  while (start < text.length && isLeadingRemovable(text.charAt(start))) {
    start += 1;
  }
  return text.slice(start);
};

const truncateToBytes = (text: string, maxBytes: number): string => {
  if (encoder.encode(text).length <= maxBytes) {
    return text;
  }
  let truncated = '';
  let bytes = 0;
  for (const { segment } of graphemeSegmenter.segment(text)) {
    bytes += encoder.encode(segment).length;
    if (bytes > maxBytes) {
      break;
    }
    truncated += segment;
  }
  return truncated;
};

export function sanitizeFileName(
  raw: string | undefined,
  type: MediaType,
): string {
  const removed = removeForbiddenCharacters((raw ?? '').toWellFormed());
  const trimmed = trimWhiteSpace(removeLeadingDotsAndWhiteSpace(removed));
  const sanitized = trimWhiteSpace(
    truncateToBytes(trimmed, MAX_FILE_NAME_BYTES),
  );
  return sanitized === '' ? DEFAULT_FILE_NAMES[type] : sanitized;
}

const NON_QUOTABLE_CHARACTER = /[^\u0020-\u007e]|["\\]/gu;

const ASCII_FALLBACK_REPLACEMENT = '_';

const NON_ATTR_CHARACTERS_LEFT_BY_URI_ENCODING = /['()*]/g;

const percentEncodeCharacter = (character: string): string =>
  `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`;

const asciiFallbackOf = (fileName: string): string =>
  fileName.replaceAll(NON_QUOTABLE_CHARACTER, ASCII_FALLBACK_REPLACEMENT);

// RFC 5987のext-valueはattr-charだけを許すため、encodeURIComponentが残す'()*も符号化する
const extendedValueOf = (fileName: string): string =>
  encodeURIComponent(fileName).replaceAll(
    NON_ATTR_CHARACTERS_LEFT_BY_URI_ENCODING,
    percentEncodeCharacter,
  );

export function attachmentDisposition(fileName: string): string {
  const wellFormed = fileName.toWellFormed();
  return `attachment; filename="${asciiFallbackOf(wellFormed)}"; filename*=UTF-8''${extendedValueOf(wellFormed)}`;
}
