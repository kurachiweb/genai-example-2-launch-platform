import { describe, expect, test } from 'bun:test';

import { checkSvgSyntax, SVG_MAX_NESTED_TAGS } from './svg-syntax.ts';

const encoder = new TextEncoder();

const utf8 = (text: string): Uint8Array => encoder.encode(text);

const UTF8_BOM = [0xef, 0xbb, 0xbf];

const MINIMAL_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="1" height="1"/></svg>';

const SVG_11_DOCTYPE =
  '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">';

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

  test.each([
    [
      'Illustrator(SVG 1.1)の書き出し',
      `<?xml version="1.0" encoding="utf-8"?>\n<!-- Generator: Adobe Illustrator 16.0.0, SVG Export Plug-In . SVG Version: 6.00 Build 0)  -->\n${SVG_11_DOCTYPE}\n<svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" width="100px" height="100px" viewBox="0 0 100 100" enable-background="new 0 0 100 100" xml:space="preserve">\n<rect x="10" y="10" fill="#FF0000" width="80" height="80"/>\n</svg>\n`,
    ],
    [
      'Affinity Designerの書き出し',
      `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n${SVG_11_DOCTYPE}\n<svg width="100%" height="100%" viewBox="0 0 200 100" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" xmlns:serif="http://www.serif.com/"><rect width="200" height="100"/></svg>\n`,
    ],
    [
      'SVG 1.0の文書型宣言',
      `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.0//EN" "http://www.w3.org/TR/2001/REC-SVG-20010904/DTD/svg10.dtd">${MINIMAL_SVG}`,
    ],
    [
      'SVG 1.1 Tinyの文書型宣言',
      `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1 Tiny//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11-tiny.dtd">${MINIMAL_SVG}`,
    ],
    [
      '単一引用符と改行で書いた文書型宣言',
      `<!DOCTYPE svg\n  PUBLIC '-//W3C//DTD SVG 1.1//EN'\n  'http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd'>${MINIMAL_SVG}`,
    ],
    ['文書型宣言の後のコメント', `${SVG_11_DOCTYPE}<!-- a -->${MINIMAL_SVG}`],
    ['BOMの後の文書型宣言', `\uFEFF${SVG_11_DOCTYPE}${MINIMAL_SVG}`],
  ])(
    '%sはSVG 1.0・1.1の標準の文書型宣言だけを持つため受け付け、宣言を含む元のテキストを返す',
    (_label, svg) => {
      expect(checkSvgSyntax(utf8(svg))).toEqual({
        ok: true,
        text: svg.replace(/^\uFEFF/u, ''),
      });
    },
  );

  test.each([
    ['空の内部サブセット', `${SVG_11_DOCTYPE.slice(0, -1)} []>${MINIMAL_SVG}`],
    [
      '内部サブセットの実体を展開する文書',
      `${SVG_11_DOCTYPE.slice(0, -1)} [<!ENTITY ns_svg "http://www.w3.org/2000/svg">]><svg xmlns="&ns_svg;"/>`,
    ],
    [
      'SYSTEMだけの文書型宣言',
      `<!DOCTYPE svg SYSTEM "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">${MINIMAL_SVG}`,
    ],
    [
      '他の公開識別子の文書型宣言',
      `<!DOCTYPE svg PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">${MINIMAL_SVG}`,
    ],
    [
      '他のホストのシステム識別子の文書型宣言',
      `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "https://evil.example/svg11.dtd">${MINIMAL_SVG}`,
    ],
    [
      'ルート名がsvgでない文書型宣言',
      `<!DOCTYPE html PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">${MINIMAL_SVG}`,
    ],
    ['2つの文書型宣言', `${SVG_11_DOCTYPE}\n${SVG_11_DOCTYPE}${MINIMAL_SVG}`],
    [
      'ルートの中の標準の文書型宣言',
      `<svg xmlns="http://www.w3.org/2000/svg">${SVG_11_DOCTYPE}</svg>`,
    ],
    ['ルートの後の標準の文書型宣言', `${MINIMAL_SVG}${SVG_11_DOCTYPE}`],
    [
      '標準の文書型宣言とルートの中のENTITY',
      `${SVG_11_DOCTYPE}<svg><!ENTITY a "x"></svg>`,
    ],
  ])('%sを含むSVGはsvg_declaration_not_allowedになる', (_label, text) => {
    expect(checkSvgSyntax(utf8(text))).toEqual({
      ok: false,
      code: 'svg_declaration_not_allowed',
    });
  });

  test.each([
    [
      'XML宣言の前の標準の文書型宣言',
      `${SVG_11_DOCTYPE}<?xml version="1.0"?>${MINIMAL_SVG}`,
    ],
    ['標準の文書型宣言だけの文書', SVG_11_DOCTYPE],
    [
      '標準の文書型宣言の後の壊れたルート',
      `${SVG_11_DOCTYPE}<svg><rect></svg>`,
    ],
    ['標準の文書型宣言の後のsvg以外のルート', `${SVG_11_DOCTYPE}<html/>`],
  ])(
    '%sは構文が壊れているか最上位がsvgでないためinvalid_svgになる',
    (_label, text) => {
      expect(checkSvgSyntax(utf8(text))).toEqual({
        ok: false,
        code: 'invalid_svg',
      });
    },
  );

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
