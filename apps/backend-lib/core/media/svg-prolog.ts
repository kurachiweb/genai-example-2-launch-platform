export interface SvgExternalId {
  readonly publicId: string;
  readonly systemId: string;
}

export interface SvgDoctypeRange {
  // `<!DOCTYPE`の`<`の位置と、閉じる`>`の次の位置
  readonly start: number;
  readonly end: number;
}

export interface SvgProlog {
  // ルートの位置。ルートの前に読み飛ばせない内容があれば、その内容の位置
  readonly rootStart: number;
  readonly doctype: SvgDoctypeRange | undefined;
}

// 編集ソフトのSVG 1.0・1.1の書き出しが付ける、W3Cが定める公開識別子とシステム識別子の組
export const STANDARD_SVG_EXTERNAL_IDS: readonly SvgExternalId[] =
  Object.freeze([
    Object.freeze({
      publicId: '-//W3C//DTD SVG 1.0//EN',
      systemId: 'http://www.w3.org/TR/2001/REC-SVG-20010904/DTD/svg10.dtd',
    }),
    Object.freeze({
      publicId: '-//W3C//DTD SVG 1.1//EN',
      systemId: 'http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd',
    }),
    Object.freeze({
      publicId: '-//W3C//DTD SVG 1.1 Basic//EN',
      systemId: 'http://www.w3.org/Graphics/SVG/1.1/DTD/svg11-basic.dtd',
    }),
    Object.freeze({
      publicId: '-//W3C//DTD SVG 1.1 Tiny//EN',
      systemId: 'http://www.w3.org/Graphics/SVG/1.1/DTD/svg11-tiny.dtd',
    }),
  ]);

const XML_WHITESPACE = '[\\x20\\x09\\x0A\\x0D]';

const REGEXP_SYNTAX_CHARACTER = /[.*+?^${}()|[\]\\/]/g;

const literalOf = (value: string): string => {
  const escaped = value.replace(REGEXP_SYNTAX_CHARACTER, '\\$&');
  return `(?:"${escaped}"|'${escaped}')`;
};

// XML 1.0のdoctypedeclのうち、ルート名がsvgで外部識別子が標準の組のPUBLICだけのもの。内部サブセット(`[`〜`]`)を持つ宣言は一致しない
const STANDARD_SVG_DOCTYPE = new RegExp(
  `<!DOCTYPE${XML_WHITESPACE}+svg${XML_WHITESPACE}+PUBLIC${XML_WHITESPACE}+(?:${STANDARD_SVG_EXTERNAL_IDS.map(
    ({ publicId, systemId }) =>
      `${literalOf(publicId)}${XML_WHITESPACE}+${literalOf(systemId)}`,
  ).join('|')})${XML_WHITESPACE}*>`,
  'y',
);

const WHITESPACE_RUN = new RegExp(`${XML_WHITESPACE}*`, 'y');

const matchStandardDoctypeAt = (
  text: string,
  index: number,
): SvgDoctypeRange | undefined => {
  STANDARD_SVG_DOCTYPE.lastIndex = index;
  return STANDARD_SVG_DOCTYPE.test(text)
    ? Object.freeze({ start: index, end: STANDARD_SVG_DOCTYPE.lastIndex })
    : undefined;
};

// ルートの前のXML宣言・処理命令・コメント・空白と、1つ目の標準の文書型宣言を読み飛ばす。並びの正しさ(XML宣言が先頭にあることなど)は構文の検査に任せる
export function scanSvgProlog(text: string): SvgProlog | undefined {
  let index = 0;
  let doctype: SvgDoctypeRange | undefined;
  for (;;) {
    WHITESPACE_RUN.lastIndex = index;
    WHITESPACE_RUN.exec(text);
    index = WHITESPACE_RUN.lastIndex;
    const closer = text.startsWith('<?', index)
      ? '?>'
      : text.startsWith('<!--', index)
        ? '-->'
        : undefined;
    if (closer !== undefined) {
      const closed = text.indexOf(closer, index);
      if (closed === -1) {
        return undefined;
      }
      index = closed + closer.length;
      continue;
    }
    const standard =
      doctype === undefined ? matchStandardDoctypeAt(text, index) : undefined;
    if (standard === undefined) {
      return Object.freeze({ rootStart: index, doctype });
    }
    doctype = standard;
    index = standard.end;
  }
}

// 外部のDTDを読まず内部サブセットも無い標準の宣言は要素・属性の既定値も実体も加えないため、宣言を拒否する検査と解析器から隠す。位置を変えないよう同じ長さの空白にする
export function blankStandardSvgDoctype(text: string): string {
  const doctype = scanSvgProlog(text)?.doctype;
  if (doctype === undefined) {
    return text;
  }
  return `${text.slice(0, doctype.start)}${' '.repeat(doctype.end - doctype.start)}${text.slice(doctype.end)}`;
}
