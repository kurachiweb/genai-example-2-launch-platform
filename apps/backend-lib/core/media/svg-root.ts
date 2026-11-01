export interface SvgRootAttribute {
  readonly name: string;
  // 文字参照と定義済み実体を戻した値。戻せない参照を含む場合は未設定
  readonly value: string | undefined;
  // 先頭の空白から閉じる引用符までの元の書き方
  readonly source: string;
}

export interface SvgViewBox {
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
}

export type SvgFontRelativeUnit = 'em' | 'rem' | 'ex' | 'ch';

// ルートの幅・高さの、ブラウザ(CSSの長さ)としての解釈
export type SvgLength =
  | { readonly kind: 'absent' }
  // 文法に合わない値・0以下の値。ブラウザは指定が無いものとして扱う
  | { readonly kind: 'invalid' }
  | { readonly kind: 'absolute'; readonly pixels: number }
  | {
      readonly kind: 'font-relative';
      readonly value: number;
      readonly unit: SvgFontRelativeUnit;
    }
  | { readonly kind: 'percentage' }
  // ブラウザが解釈するが、本部品が画素数に換算しない単位(vw・lhなど)
  | { readonly kind: 'unsupported' };

export type SvgViewBoxValue =
  | { readonly kind: 'absent' }
  // 文法に合わない値・幅か高さが0以下の値。ブラウザは表示領域の指定が無いものとして扱うか描かない
  | { readonly kind: 'invalid' }
  | { readonly kind: 'valid'; readonly box: SvgViewBox };

export interface SvgRoot {
  readonly name: string;
  // 開始タグの`<`の位置と、`>`の次の位置
  readonly start: number;
  readonly end: number;
  readonly attributes: readonly SvgRootAttribute[];
  readonly selfClosing: boolean;
  readonly width: SvgLength;
  readonly height: SvgLength;
  readonly viewBox: SvgViewBoxValue;
}

export interface SvgIntrinsicSize {
  readonly width: number;
  readonly height: number;
}

// SVGを画像として表示するブラウザの既定の文字の大きさ
export const DEFAULT_SVG_FONT_SIZE_PIXELS = 16;

const XML_WHITESPACE = '[\\x20\\x09\\x0A\\x0D]';
const ROOT_NAME = new RegExp(
  `<((?:[A-Za-z_][\\w.-]*:)?svg)(?=${XML_WHITESPACE}|/|>)`,
  'y',
);
// 属性の値は引用符の中だけを値とみなすため、値の中の`>`や`/`で開始タグの終わりを誤らない
const ATTRIBUTE = new RegExp(
  `${XML_WHITESPACE}+([^\\x20\\x09\\x0A\\x0D=/>]+)${XML_WHITESPACE}*=${XML_WHITESPACE}*(?:"([^"]*)"|'([^']*)')`,
  'y',
);
const TAG_END = new RegExp(`${XML_WHITESPACE}*(/?)>`, 'y');
const WHITESPACE_RUN = new RegExp(`${XML_WHITESPACE}*`, 'y');

const NUMBER = '[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
const LENGTH = new RegExp(
  `^${XML_WHITESPACE}*(${NUMBER})([A-Za-z]+|%)?${XML_WHITESPACE}*$`,
);
const VIEW_BOX_NUMBER = new RegExp(NUMBER, 'y');
// 数値の間は空白の並び・カンマ1つ(前後の空白可)・区切り無し(次の数値が符号や`.`で始まる場合)のいずれか
const VIEW_BOX_SEPARATOR = new RegExp(
  `${XML_WHITESPACE}*,?${XML_WHITESPACE}*`,
  'y',
);
const VIEW_BOX_NUMBER_COUNT = 4;

const PIXELS_PER_INCH = 96;
// CSS Values 4の絶対的な長さの単位ごとの画素数(単位は大文字小文字を区別しない)
const PIXELS_PER_ABSOLUTE_UNIT: Readonly<Record<string, number>> =
  Object.freeze({
    '': 1,
    px: 1,
    in: PIXELS_PER_INCH,
    cm: PIXELS_PER_INCH / 2.54,
    mm: PIXELS_PER_INCH / 25.4,
    q: PIXELS_PER_INCH / 101.6,
    pt: PIXELS_PER_INCH / 72,
    pc: PIXELS_PER_INCH / 6,
  });
const FONT_RELATIVE_UNITS: ReadonlySet<string> = new Set([
  'em',
  'rem',
  'ex',
  'ch',
]);
// ブラウザが解釈するが画素数に換算しない単位(画面・コンテナ・行・書体の大きさに対する長さ)。他の単位はブラウザでも無効
const UNSUPPORTED_UNITS: ReadonlySet<string> = new Set([
  ...['vw', 'vh', 'vi', 'vb', 'vmin', 'vmax'].flatMap((unit) => [
    unit,
    `s${unit}`,
    `l${unit}`,
    `d${unit}`,
  ]),
  ...['cqw', 'cqh', 'cqi', 'cqb', 'cqmin', 'cqmax'],
  ...['lh', 'rlh', 'cap', 'rcap', 'ic', 'ric', 'rex', 'rch'],
]);

const PREDEFINED_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
});
const REFERENCE = /&(?:#x([0-9A-Fa-f]+)|#(\d+)|([A-Za-z_][\w.-]*));/g;
const UNRESOLVED_AMPERSAND = /&(?!(?:#x[0-9A-Fa-f]+|#\d+|[A-Za-z_][\w.-]*);)/;

const isXmlCharacter = (code: number): boolean =>
  code === 0x9 ||
  code === 0xa ||
  code === 0xd ||
  (code >= 0x20 && code <= 0xd7ff) ||
  (code >= 0xe000 && code <= 0xfffd) ||
  (code >= 0x10000 && code <= 0x10ffff);

const resolveReference = (
  hex: string | undefined,
  decimal: string | undefined,
  name: string | undefined,
): string | undefined => {
  if (name !== undefined) {
    return PREDEFINED_ENTITIES[name];
  }
  const code = hex === undefined ? Number(decimal) : Number.parseInt(hex, 16);
  return isXmlCharacter(code) ? String.fromCodePoint(code) : undefined;
};

// XML 1.0の2.11・3.3.3: 改行をまとめ、空白の文字を空白に置き換えた後に参照を戻す(参照で書いた空白の文字は置き換えない)
function decodeAttributeValue(raw: string): string | undefined {
  if (UNRESOLVED_AMPERSAND.test(raw)) {
    return undefined;
  }
  const normalized = raw.replace(/\r\n?/g, '\n').replace(/[\t\n\r]/g, ' ');
  const parts: string[] = [];
  let index = 0;
  for (const match of normalized.matchAll(REFERENCE)) {
    const resolved = resolveReference(match[1], match[2], match[3]);
    if (resolved === undefined) {
      return undefined;
    }
    parts.push(normalized.slice(index, match.index), resolved);
    index = match.index + match[0].length;
  }
  return [...parts, normalized.slice(index)].join('');
}

// 受付で整形式と確かめた文書が前提で、ルートの前に置けるのはXML宣言・処理命令・コメント・空白だけとする
function skipProlog(text: string): number | undefined {
  let index = 0;
  for (;;) {
    WHITESPACE_RUN.lastIndex = index;
    WHITESPACE_RUN.exec(text);
    index = WHITESPACE_RUN.lastIndex;
    const closer = text.startsWith('<?', index)
      ? '?>'
      : text.startsWith('<!--', index)
        ? '-->'
        : undefined;
    if (closer === undefined) {
      return index;
    }
    const closed = text.indexOf(closer, index);
    if (closed === -1) {
      return undefined;
    }
    index = closed + closer.length;
  }
}

function readAttributes(
  text: string,
  from: number,
): { readonly attributes: SvgRootAttribute[]; readonly end: number } {
  const attributes: SvgRootAttribute[] = [];
  let index = from;
  for (;;) {
    ATTRIBUTE.lastIndex = index;
    const match = ATTRIBUTE.exec(text);
    if (match === null) {
      return { attributes, end: index };
    }
    attributes.push(
      Object.freeze({
        name: match[1] ?? '',
        value: decodeAttributeValue(match[2] ?? match[3] ?? ''),
        source: match[0],
      }),
    );
    index = ATTRIBUTE.lastIndex;
  }
}

const ABSENT = Object.freeze({ kind: 'absent' } as const);
const INVALID = Object.freeze({ kind: 'invalid' } as const);

function parseLength(attribute: SvgRootAttribute | undefined): SvgLength {
  if (attribute === undefined) {
    return ABSENT;
  }
  const match =
    attribute.value === undefined ? null : LENGTH.exec(attribute.value);
  const value = Number(match?.[1]);
  if (match === null || !Number.isFinite(value) || value <= 0) {
    return INVALID;
  }
  const unit = (match[2] ?? '').toLowerCase();
  if (unit === '%') {
    return Object.freeze({ kind: 'percentage' });
  }
  if (FONT_RELATIVE_UNITS.has(unit)) {
    return Object.freeze({
      kind: 'font-relative',
      value,
      unit: unit as SvgFontRelativeUnit,
    });
  }
  if (UNSUPPORTED_UNITS.has(unit)) {
    return Object.freeze({ kind: 'unsupported' });
  }
  const pixelsPerUnit = PIXELS_PER_ABSOLUTE_UNIT[unit];
  if (pixelsPerUnit === undefined) {
    return INVALID;
  }
  return Object.freeze({ kind: 'absolute', pixels: value * pixelsPerUnit });
}

// ブラウザのviewBoxの解析と同じく、4つの数値を空白・カンマ・区切り無しの連結で読み、余りや欠けがあれば無効とする
function parseViewBoxNumbers(value: string): number[] | undefined {
  const numbers: number[] = [];
  WHITESPACE_RUN.lastIndex = 0;
  WHITESPACE_RUN.exec(value);
  let index = WHITESPACE_RUN.lastIndex;
  for (;;) {
    VIEW_BOX_NUMBER.lastIndex = index;
    const match = VIEW_BOX_NUMBER.exec(value);
    if (match === null) {
      return undefined;
    }
    numbers.push(Number(match[0]));
    index = VIEW_BOX_NUMBER.lastIndex;
    if (numbers.length === VIEW_BOX_NUMBER_COUNT) {
      WHITESPACE_RUN.lastIndex = index;
      WHITESPACE_RUN.exec(value);
      return WHITESPACE_RUN.lastIndex === value.length ? numbers : undefined;
    }
    VIEW_BOX_SEPARATOR.lastIndex = index;
    VIEW_BOX_SEPARATOR.exec(value);
    index = VIEW_BOX_SEPARATOR.lastIndex;
  }
}

// 文字参照を戻した後のviewBoxの値を、ブラウザと同じ文法で解釈する
export function parseSvgViewBox(
  value: string,
): Exclude<SvgViewBoxValue, { readonly kind: 'absent' }> {
  const numbers = parseViewBoxNumbers(value);
  if (numbers === undefined || !numbers.every(Number.isFinite)) {
    return INVALID;
  }
  const [minX = 0, minY = 0, width = 0, height = 0] = numbers;
  if (width <= 0 || height <= 0) {
    return INVALID;
  }
  return Object.freeze({
    kind: 'valid',
    box: Object.freeze({ minX, minY, width, height }),
  });
}

function parseViewBox(
  attribute: SvgRootAttribute | undefined,
): SvgViewBoxValue {
  if (attribute === undefined) {
    return ABSENT;
  }
  return attribute.value === undefined
    ? INVALID
    : parseSvgViewBox(attribute.value);
}

export function readSvgRoot(text: string): SvgRoot | undefined {
  const start = skipProlog(text);
  if (start === undefined) {
    return undefined;
  }
  ROOT_NAME.lastIndex = start;
  const name = ROOT_NAME.exec(text)?.[1];
  if (name === undefined) {
    return undefined;
  }
  const { attributes, end: attributesEnd } = readAttributes(
    text,
    ROOT_NAME.lastIndex,
  );
  TAG_END.lastIndex = attributesEnd;
  const tagEnd = TAG_END.exec(text);
  if (tagEnd === null) {
    return undefined;
  }
  const attributeNamed = (
    attributeName: string,
  ): SvgRootAttribute | undefined =>
    attributes.find((attribute) => attribute.name === attributeName);
  return Object.freeze({
    name,
    start,
    end: TAG_END.lastIndex,
    attributes: Object.freeze(attributes),
    selfClosing: tagEnd[1] === '/',
    width: parseLength(attributeNamed('width')),
    height: parseLength(attributeNamed('height')),
    viewBox: parseViewBox(attributeNamed('viewBox')),
  });
}

const sizeOf = (width: number, height: number): SvgIntrinsicSize | undefined =>
  Number.isSafeInteger(width) &&
  width > 0 &&
  Number.isSafeInteger(height) &&
  height > 0
    ? Object.freeze({ width, height })
    : undefined;

// 画素数、指定が無いものとしてブラウザが縦横比などから決める場合は'auto'、書体などで変わり求められない場合は未設定
function pixelsOf(length: SvgLength): number | 'auto' | undefined {
  switch (length.kind) {
    case 'absolute':
      return Math.round(length.pixels);
    case 'font-relative':
      return length.unit === 'em' || length.unit === 'rem'
        ? Math.round(length.value * DEFAULT_SVG_FONT_SIZE_PIXELS)
        : undefined;
    case 'unsupported':
      return undefined;
    case 'absent':
    case 'invalid':
    case 'percentage':
      return 'auto';
  }
}

// 表示される寸法を、幅と高さの両方があればその値、片方だけならviewBoxの縦横比から、どちらも無ければviewBoxの大きさから求める
export function intrinsicSizeOfSvg(
  root: SvgRoot,
): SvgIntrinsicSize | undefined {
  const width = pixelsOf(root.width);
  const height = pixelsOf(root.height);
  if (width === undefined || height === undefined) {
    return undefined;
  }
  if (width !== 'auto' && height !== 'auto') {
    return sizeOf(width, height);
  }
  if (root.viewBox.kind !== 'valid') {
    return undefined;
  }
  const viewBoxWidth = Math.round(root.viewBox.box.width);
  const viewBoxHeight = Math.round(root.viewBox.box.height);
  const ratio = viewBoxWidth / viewBoxHeight;
  if (width !== 'auto') {
    return sizeOf(width, Math.floor(width / ratio));
  }
  if (height !== 'auto') {
    return sizeOf(Math.floor(height * ratio), height);
  }
  return sizeOf(viewBoxWidth, viewBoxHeight);
}
