import {
  readSvgRoot,
  type SvgLength,
  type SvgRoot,
  type SvgViewBoxValue,
} from '../../../lib/core/media/svg-root.ts';

export type SvgRenderSource =
  | { readonly kind: 'not-svg' }
  | { readonly kind: 'svg'; readonly text: string }
  | { readonly kind: 'unreadable' };

const NOT_SVG: SvgRenderSource = Object.freeze({ kind: 'not-svg' });
const UNREADABLE: SvgRenderSource = Object.freeze({ kind: 'unreadable' });

const LESS_THAN = 0x3c;
const UTF8_BYTE_ORDER_MARK: readonly number[] = Object.freeze([
  0xef, 0xbb, 0xbf,
]);
const XML_WHITESPACE: ReadonlySet<number> = new Set([0x20, 0x09, 0x0a, 0x0d]);

// ルートで書き直す属性と、ブラウザの<img>がルートに適用しない(または描画器と別の座標で適用する)属性
const REPLACED_ATTRIBUTES: ReadonlySet<string> = new Set([
  'width',
  'height',
  'viewBox',
  'transform',
  'display',
  'style',
]);
const REPLACED_PROPERTIES: ReadonlySet<string> = new Set([
  'transform',
  'display',
]);
// 文書内のスタイルシートがルートに指定した変形・非表示も、style属性の宣言で打ち消す
const ROOT_STYLE_OVERRIDES: readonly string[] = Object.freeze([
  'display:inline',
  'transform:none',
]);

// 判定する画像の形式のうち、本文が`<`で始まるのはSVGだけ
const startsLikeMarkup = (bytes: Uint8Array): boolean => {
  let index = UTF8_BYTE_ORDER_MARK.every((byte, at) => bytes[at] === byte)
    ? UTF8_BYTE_ORDER_MARK.length
    : 0;
  while (index < bytes.length && XML_WHITESPACE.has(bytes[index] ?? 0)) {
    index += 1;
  }
  return bytes[index] === LESS_THAN;
};

const escapeAttributeValue = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

const attributeOf = (name: string, value: string): string =>
  ` ${name}="${escapeAttributeValue(value)}"`;

// 描画器はremを解釈せず、ルートのremはルート自身の文字の大きさを基準にするためemと同じ長さになる
function renderedLength(length: SvgLength): string | undefined {
  switch (length.kind) {
    case 'absolute':
      return String(length.pixels);
    case 'font-relative':
      return length.unit === 'ch'
        ? undefined
        : `${String(length.value)}${length.unit === 'rem' ? 'em' : length.unit}`;
    case 'absent':
    case 'invalid':
    case 'percentage':
    case 'unsupported':
      return undefined;
  }
}

const renderedViewBox = (viewBox: SvgViewBoxValue): string | undefined =>
  viewBox.kind === 'valid'
    ? [
        viewBox.box.minX,
        viewBox.box.minY,
        viewBox.box.width,
        viewBox.box.height,
      ]
        .map(String)
        .join(' ')
    : undefined;

const CLOSING_BRACKET: Readonly<Record<string, string>> = Object.freeze({
  '(': ')',
  '[': ']',
  '{': '}',
});

// CSSの宣言の並びを、引用符・かっこ・コメントの中の`;`で区切らずに分ける。閉じていない文字列・コメントの続く宣言はブラウザも無視するため捨てる
function splitDeclarations(style: string): string[] {
  const declarations: string[] = [];
  const closers: string[] = [];
  let current = '';
  let index = 0;
  while (index < style.length) {
    const character = style.charAt(index);
    if (style.startsWith('/*', index)) {
      const closed = style.indexOf('*/', index + 2);
      if (closed === -1) {
        return declarations;
      }
      index = closed + 2;
      continue;
    }
    if (character === '"' || character === "'") {
      let end = index + 1;
      while (end < style.length && style.charAt(end) !== character) {
        end += style.charAt(end) === '\\' ? 2 : 1;
      }
      if (end >= style.length) {
        return declarations;
      }
      current += style.slice(index, end + 1);
      index = end + 1;
      continue;
    }
    if (character === '\\') {
      current += style.slice(index, index + 2);
      index += 2;
      continue;
    }
    const closer = CLOSING_BRACKET[character];
    if (closer !== undefined) {
      closers.push(closer);
    } else if (character === closers.at(-1)) {
      closers.pop();
    } else if (character === ';' && closers.length === 0) {
      declarations.push(current.trim());
      current = '';
      index += 1;
      continue;
    }
    current += character;
    index += 1;
  }
  return [...declarations, current.trim()];
}

const propertyOf = (declaration: string): string =>
  declaration.slice(0, declaration.indexOf(':')).trim().toLowerCase();

function renderedStyle(root: SvgRoot): string {
  const style =
    root.attributes.find((attribute) => attribute.name === 'style')?.value ??
    '';
  return [
    ...splitDeclarations(style).filter(
      (declaration) =>
        declaration !== '' && !REPLACED_PROPERTIES.has(propertyOf(declaration)),
    ),
    ...ROOT_STYLE_OVERRIDES,
  ].join(';');
}

function renderedRootTag(root: SvgRoot): string {
  const width = renderedLength(root.width);
  const height = renderedLength(root.height);
  const viewBox = renderedViewBox(root.viewBox);
  return [
    `<${root.name}`,
    ...root.attributes
      .filter((attribute) => !REPLACED_ATTRIBUTES.has(attribute.name))
      .map((attribute) => attribute.source),
    width === undefined ? '' : attributeOf('width', width),
    height === undefined ? '' : attributeOf('height', height),
    viewBox === undefined ? '' : attributeOf('viewBox', viewBox),
    attributeOf('style', renderedStyle(root)),
    root.selfClosing ? '/>' : '>',
  ].join('');
}

// 描画器(resvg)とブラウザの<img>でルートの解釈が分かれると、表示される範囲・縦横比が食い違い、判定用画像に写らない内容をブラウザで見せられる。
// ルートの幅・高さ・viewBoxをブラウザの解釈で描画器が同じに読む書き方へ直し、解釈できない値は取り除いて描画器にも指定が無いものとして扱わせる。
// ルートの変形・非表示は取り除き、ブラウザより多くの内容を描く側にそろえる
export function prepareSvgForRendering(bytes: Uint8Array): SvgRenderSource {
  if (!startsLikeMarkup(bytes)) {
    return NOT_SVG;
  }
  const text = new TextDecoder().decode(bytes);
  const root = readSvgRoot(text);
  if (root === undefined) {
    return UNREADABLE;
  }
  return Object.freeze({
    kind: 'svg',
    text: `${text.slice(0, root.start)}${renderedRootTag(root)}${text.slice(root.end)}`,
  });
}
