import { extractSearchText } from '../../../common-lib/markdown/extract-search-text.ts';
import { normalizeIndexText } from '../../../common-lib/search/index-text.ts';
import type {
  SearchFieldSpec,
  SearchSource,
  SearchTargetInfo,
} from './search-target.ts';

export interface IndexDocument {
  readonly sourceVersion: number;
  readonly texts: Readonly<Record<string, string>>;
  readonly extractionInput: string;
  readonly extractionInputHash: string;
}

// キーワードの選別の規則を変えたら上げる。ハッシュに含め、変更前の抽出結果を再利用しないようにする
export const KEYWORD_SELECTION_VERSION = '1';

// 自然言語APIの1要求の上限1,000,000バイト未満に収める
export const MAX_EXTRACTION_INPUT_BYTES = 900_000;

const EXTRACTION_FIELD_SEPARATOR = '\n\n';
const HASH_INPUT_SEPARATOR = '\u0000';

const textEncoder = new TextEncoder();
const graphemeSegmenter = new Intl.Segmenter('und', {
  granularity: 'grapheme',
});

const normalizeField = (spec: SearchFieldSpec, text: string): string =>
  normalizeIndexText(
    spec.format === 'markdown' ? extractSearchText(text) : text,
  );

const isHighSurrogate = (codeUnit: number): boolean =>
  codeUnit >= 0xd8_00 && codeUnit <= 0xdb_ff;

const isLowSurrogate = (codeUnit: number): boolean =>
  codeUnit >= 0xdc_00 && codeUnit <= 0xdf_ff;

// UTF-8で上限のバイト数に収まる最長の先頭部分の終わりを、コードポイントの境界のUTF-16の位置で返す。対のない代理はTextEncoderがU+FFFDの3バイトにする
const utf8PrefixEnd = (text: string, maxBytes: number): number => {
  let bytes = 0;
  let index = 0;
  while (index < text.length) {
    const codeUnit = text.charCodeAt(index);
    const isPair =
      isHighSurrogate(codeUnit) && isLowSurrogate(text.charCodeAt(index + 1));
    const width = isPair ? 4 : codeUnit < 0x80 ? 1 : codeUnit < 0x8_00 ? 2 : 3;
    if (bytes + width > maxBytes) {
      return index;
    }
    bytes += width;
    index += isPair ? 2 : 1;
  }
  return index;
};

// 書記素を1つずつ数えると入力の長さに比例する回数の分割になるため、バイト数で求めた位置を含む書記素の先頭だけを求める
const truncateToUtf8Bytes = (text: string, maxBytes: number): string => {
  const end = utf8PrefixEnd(text, maxBytes);
  if (end === text.length) {
    return text;
  }
  const segment = graphemeSegmenter.segment(text).containing(end);
  return text.slice(0, segment?.index ?? end);
};

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

const hashExtractionInput = async (input: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    textEncoder.encode(
      `${KEYWORD_SELECTION_VERSION}${HASH_INPUT_SEPARATOR}${input}`,
    ),
  );
  return toHex(new Uint8Array(digest));
};

const sourceTextOf = (
  target: SearchTargetInfo,
  source: SearchSource,
  field: string,
): string => {
  const text = source.fields[field];
  if (typeof text !== 'string') {
    throw new TypeError(
      `検索対象${target.name}の元データに項目${field}の文字列がありません。`,
    );
  }
  return text;
};

export async function buildIndexDocument(
  target: SearchTargetInfo,
  source: SearchSource,
): Promise<IndexDocument> {
  const normalizedFields = Object.entries(target.fields).map(
    ([field, spec]) => ({
      field,
      spec,
      text: normalizeField(spec, sourceTextOf(target, source, field)),
    }),
  );
  const texts = Object.fromEntries(
    normalizedFields
      .filter(({ spec }) => spec.textColumn)
      .map(({ field, text }) => [field, text]),
  );
  const extractionInput = truncateToUtf8Bytes(
    normalizedFields
      .filter(({ spec, text }) => spec.extract && text !== '')
      .map(({ text }) => text)
      .join(EXTRACTION_FIELD_SEPARATOR),
    MAX_EXTRACTION_INPUT_BYTES,
  );
  return {
    sourceVersion: source.version,
    texts,
    extractionInput,
    extractionInputHash: await hashExtractionInput(extractionInput),
  };
}
