import { describe, expect, test } from 'bun:test';

import { checkSvgSyntax, SVG_MAX_NESTED_TAGS } from './svg-syntax.ts';

const encoder = new TextEncoder();

const utf8 = (text: string): Uint8Array => encoder.encode(text);

const UTF8_BOM = [0xef, 0xbb, 0xbf];

const MINIMAL_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="1" height="1"/></svg>';

const nestedSvg = (levelsBelowRoot: number): string =>
  `<svg>${'<g>'.repeat(levelsBelowRoot)}${'</g>'.repeat(levelsBelowRoot)}</svg>`;

describe('checkSvgSyntax', () => {
  test('整形式で最上位がsvgの文書を受け付け、復号したテキストを返す', () => {
    expect(checkSvgSyntax(utf8(MINIMAL_SVG))).toEqual({
      ok: true,
      text: MINIMAL_SVG,
    });
  });

  test('XML宣言・コメント・前後の空白・CDATAを含む文書を受け付ける', () => {
    const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<!-- 書き出し元 -->\n<svg xmlns="http://www.w3.org/2000/svg"><style><![CDATA[rect{fill:red}]]></style></svg>\n`;

    expect(checkSvgSyntax(utf8(svg))).toEqual({ ok: true, text: svg });
  });

  test('日本語を含む文書を受け付け、多バイト文字を復号したテキストを返す', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><title>ロゴ😀</title></svg>';

    expect(checkSvgSyntax(utf8(svg))).toEqual({ ok: true, text: svg });
  });

  test('先頭のBOMを除いたテキストを返す', () => {
    const bytes = Uint8Array.from([...UTF8_BOM, ...utf8(MINIMAL_SVG)]);

    expect(checkSvgSyntax(bytes)).toEqual({ ok: true, text: MINIMAL_SVG });
  });

  test('実体参照を展開せずに構文だけを検査する', () => {
    const svg = '<svg><title>&amp;&lt;&#x41;</title></svg>';

    expect(checkSvgSyntax(utf8(svg))).toEqual({ ok: true, text: svg });
  });

  test.each([
    ['UTF-8として不正なバイト', Uint8Array.from([...utf8('<svg>'), 0xff])],
    [
      'Shift_JISの本文',
      Uint8Array.from([
        ...utf8('<svg><title>'),
        0x83,
        0x8d,
        0x83,
        0x53,
        ...utf8('</title></svg>'),
      ]),
    ],
    [
      'BOM付きのUTF-16LE',
      Uint8Array.from([
        0xff,
        0xfe,
        ...Array.from('<svg/>', (character) => [
          character.charCodeAt(0),
          0x00,
        ]).flat(),
      ]),
    ],
    [
      '末尾で途切れた多バイト文字',
      Uint8Array.from([...utf8('<svg/>'), 0xe3, 0x81]),
    ],
    [
      'サロゲートを符号化したバイト列',
      Uint8Array.from([...utf8('<svg>'), 0xed, 0xa0, 0x80, ...utf8('</svg>')]),
    ],
  ])('%sはUTF-8として読めないためinvalid_svgになる', (_label, bytes) => {
    expect(checkSvgSyntax(bytes)).toEqual({ ok: false, code: 'invalid_svg' });
  });

  test.each([
    ['空の本文', ''],
    ['空白だけの本文', '  \n'],
    ['要素の無いテキスト', 'not an svg'],
    ['閉じていない要素', '<svg><rect></svg>'],
    ['閉じていない最上位の要素', '<svg>'],
    ['値の無い属性', '<svg hidden></svg>'],
    ['引用符の無い属性', '<svg width=10></svg>'],
    ['同じ名前の属性の重複', '<svg width="1" width="2"></svg>'],
    ['複数の最上位の要素', '<svg></svg><svg></svg>'],
    ['最上位の要素の後のテキスト', '<svg></svg>text'],
    ['途中で切れた文書', MINIMAL_SVG.slice(0, -3)],
  ])('%sは構文が壊れているためinvalid_svgになる', (_label, text) => {
    expect(checkSvgSyntax(utf8(text))).toEqual({
      ok: false,
      code: 'invalid_svg',
    });
  });

  test.each([
    ['HTML', '<html><body></body></html>'],
    ['大文字のSVG', '<SVG xmlns="http://www.w3.org/2000/svg"></SVG>'],
    [
      '名前空間の接頭辞付きのsvg',
      '<s:svg xmlns:s="http://www.w3.org/2000/svg"/>',
    ],
    ['svgで始まる別の名前', '<svgx></svgx>'],
    ['XML宣言の後のHTML', '<?xml version="1.0"?><html/>'],
  ])(
    '最上位が%sの文書は最上位がsvgでないためinvalid_svgになる',
    (_label, text) => {
      expect(checkSvgSyntax(utf8(text))).toEqual({
        ok: false,
        code: 'invalid_svg',
      });
    },
  );

  test.each([
    ['DOCTYPE', '<!DOCTYPE svg><svg></svg>'],
    ['小文字のdoctype', '<!doctype svg><svg></svg>'],
    [
      '大文字小文字を混ぜたDocType',
      '<!DocType svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg></svg>',
    ],
    [
      '内部サブセットのENTITY',
      '<!DOCTYPE svg [<!ENTITY a "x">]><svg>&a;</svg>',
    ],
    [
      '外部の実体を参照するENTITY',
      '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg>&xxe;</svg>',
    ],
    ['大文字小文字を混ぜたEnTiTy', '<svg><!EnTiTy a "x"></svg>'],
    ['ENTITYだけ', '<svg><!ENTITY a "x"></svg>'],
    ['小文字のentity', '<svg><!entity a "x"></svg>'],
    ['構文も壊れたDOCTYPE', '<!DOCTYPE svg><svg>'],
    ['BOMの後のDOCTYPE', '\uFEFF<!DOCTYPE svg><svg></svg>'],
    ['コメントの中のDOCTYPE', '<svg><!-- <!DOCTYPE svg> --></svg>'],
  ])('%sを含むSVGはsvg_declaration_not_allowedになる', (_label, text) => {
    expect(checkSvgSyntax(utf8(text))).toEqual({
      ok: false,
      code: 'svg_declaration_not_allowed',
    });
  });

  test('UTF-8として読めない本文は、宣言を含んでもinvalid_svgになる', () => {
    const bytes = Uint8Array.from([...utf8('<!DOCTYPE svg><svg>'), 0xff]);

    expect(checkSvgSyntax(bytes)).toEqual({ ok: false, code: 'invalid_svg' });
  });

  test('入れ子の上限はSVGの安全性の検査と同じ256段である', () => {
    expect(SVG_MAX_NESTED_TAGS).toBe(256);
  });

  test.each([
    ['解析器の既定の上限(100段)を1段超える101段', 101],
    ['上限ちょうどの256段', 256],
  ])('最上位のsvgの下の入れ子が%sの文書を受け付ける', (_label, levels) => {
    const svg = nestedSvg(levels);

    expect(checkSvgSyntax(utf8(svg))).toEqual({ ok: true, text: svg });
  });

  test('最上位のsvgの下の入れ子が上限を1段超える257段の文書はinvalid_svgになる', () => {
    expect(checkSvgSyntax(utf8(nestedSvg(257)))).toEqual({
      ok: false,
      code: 'invalid_svg',
    });
  });

  test('結果を凍結して返す', () => {
    const accepted = checkSvgSyntax(utf8(MINIMAL_SVG));
    const rejected = checkSvgSyntax(utf8('<html/>'));

    expect(Object.isFrozen(accepted)).toBe(true);
    expect(Object.isFrozen(rejected)).toBe(true);
  });
});
