import { describe, expect, test } from 'bun:test';

import {
  blankStandardSvgDoctype,
  scanSvgProlog,
  STANDARD_SVG_EXTERNAL_IDS,
} from './svg-prolog.ts';

const SVG_11_DOCTYPE =
  '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">';

const ROOT = '<svg xmlns="http://www.w3.org/2000/svg"/>';

const doctypeOf = (publicId: string, systemId: string): string =>
  `<!DOCTYPE svg PUBLIC "${publicId}" "${systemId}">`;

describe('STANDARD_SVG_EXTERNAL_IDS', () => {
  test('W3Cが定めるSVG 1.0・1.1・1.1 Basic・1.1 Tinyの公開識別子とシステム識別子の組だけを持つ', () => {
    expect(STANDARD_SVG_EXTERNAL_IDS).toStrictEqual([
      {
        publicId: '-//W3C//DTD SVG 1.0//EN',
        systemId: 'http://www.w3.org/TR/2001/REC-SVG-20010904/DTD/svg10.dtd',
      },
      {
        publicId: '-//W3C//DTD SVG 1.1//EN',
        systemId: 'http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd',
      },
      {
        publicId: '-//W3C//DTD SVG 1.1 Basic//EN',
        systemId: 'http://www.w3.org/Graphics/SVG/1.1/DTD/svg11-basic.dtd',
      },
      {
        publicId: '-//W3C//DTD SVG 1.1 Tiny//EN',
        systemId: 'http://www.w3.org/Graphics/SVG/1.1/DTD/svg11-tiny.dtd',
      },
    ]);
    expect(Object.isFrozen(STANDARD_SVG_EXTERNAL_IDS)).toBe(true);
  });
});

describe('scanSvgProlog', () => {
  test('文書型宣言の無い文書は、XML宣言・処理命令・コメント・空白の後をルートの位置とする', () => {
    const prolog = '<?xml version="1.0"?>\n<?foo bar?>\n<!-- a -->\n';

    expect(scanSvgProlog(`${prolog}${ROOT}`)).toStrictEqual({
      rootStart: prolog.length,
      doctype: undefined,
    });
  });

  test('XML宣言とコメントの後の標準の文書型宣言の範囲と、その後のコメントの後のルートの位置を返す', () => {
    const before = '<?xml version="1.0"?>\n<!-- Generator: x -->\n';
    const after = '\n<!-- b -->\n';

    expect(
      scanSvgProlog(`${before}${SVG_11_DOCTYPE}${after}${ROOT}`),
    ).toStrictEqual({
      rootStart: before.length + SVG_11_DOCTYPE.length + after.length,
      doctype: {
        start: before.length,
        end: before.length + SVG_11_DOCTYPE.length,
      },
    });
  });

  test.each(
    STANDARD_SVG_EXTERNAL_IDS.map(
      ({ publicId, systemId }) =>
        [publicId, doctypeOf(publicId, systemId)] as const,
    ),
  )('%sの文書型宣言を標準の宣言とみなす', (_label, doctype) => {
    expect(scanSvgProlog(`${doctype}${ROOT}`)?.doctype).toStrictEqual({
      start: 0,
      end: doctype.length,
    });
  });

  test.each([
    [
      '単一引用符',
      "<!DOCTYPE svg PUBLIC '-//W3C//DTD SVG 1.1//EN' 'http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd'>",
    ],
    [
      '二重引用符と単一引用符の混在',
      `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" 'http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd'>`,
    ],
    [
      '改行と複数の空白とタブ',
      '<!DOCTYPE\tsvg  PUBLIC\r\n  "-//W3C//DTD SVG 1.1//EN"\n\t"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"\n>',
    ],
  ])('%sで書いた標準の文書型宣言を標準の宣言とみなす', (_label, doctype) => {
    expect(scanSvgProlog(`${doctype}${ROOT}`)).toStrictEqual({
      rootStart: doctype.length,
      doctype: { start: 0, end: doctype.length },
    });
  });

  test.each([
    ['外部識別子の無い宣言', '<!DOCTYPE svg>'],
    ['空の内部サブセット', `${SVG_11_DOCTYPE.slice(0, -1)} []>`],
    [
      '実体を宣言する内部サブセット',
      `${SVG_11_DOCTYPE.slice(0, -1)} [<!ENTITY a "x">]>`,
    ],
    [
      'SYSTEMだけの外部識別子',
      '<!DOCTYPE svg SYSTEM "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">',
    ],
    [
      'システム識別子の無いPUBLIC',
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN">',
    ],
    [
      '他の公開識別子',
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">',
    ],
    [
      'SVG 1.1の公開識別子とSVG 1.0のシステム識別子の組',
      doctypeOf(
        '-//W3C//DTD SVG 1.1//EN',
        'http://www.w3.org/TR/2001/REC-SVG-20010904/DTD/svg10.dtd',
      ),
    ],
    [
      '他のホストのシステム識別子',
      doctypeOf('-//W3C//DTD SVG 1.1//EN', 'https://evil.example/svg11.dtd'),
    ],
    [
      '識別子の中の空白の揺れ',
      doctypeOf(
        '-//W3C//DTD  SVG 1.1//EN',
        'http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd',
      ),
    ],
    ['svg以外のルート名', SVG_11_DOCTYPE.replace('svg PUBLIC', 'html PUBLIC')],
    ['大文字のルート名', SVG_11_DOCTYPE.replace('svg PUBLIC', 'SVG PUBLIC')],
    ['小文字のdoctype', SVG_11_DOCTYPE.replace('DOCTYPE', 'doctype')],
    ['小文字のpublic', SVG_11_DOCTYPE.replace('PUBLIC', 'public')],
    ['対にならない引用符', SVG_11_DOCTYPE.replace('EN"', "EN'")],
    ['ルート名の前の空白の欠落', SVG_11_DOCTYPE.replace('DOCTYPE ', 'DOCTYPE')],
  ])(
    '%sは標準の宣言とみなさず、その位置をルートの位置として返す',
    (_label, doctype) => {
      expect(scanSvgProlog(`${doctype}${ROOT}`)).toStrictEqual({
        rootStart: 0,
        doctype: undefined,
      });
    },
  );

  test('2つ目の文書型宣言は標準の宣言でも読み飛ばさない', () => {
    expect(
      scanSvgProlog(`${SVG_11_DOCTYPE}\n${SVG_11_DOCTYPE}${ROOT}`),
    ).toStrictEqual({
      rootStart: SVG_11_DOCTYPE.length + 1,
      doctype: { start: 0, end: SVG_11_DOCTYPE.length },
    });
  });

  test('閉じていないコメント・処理命令があれば読み取れない', () => {
    expect(scanSvgProlog(`<!-- a ${ROOT}`)).toBeUndefined();
    expect(scanSvgProlog(`<?xml version="1.0" ${ROOT}`)).toBeUndefined();
  });

  test('結果を凍結して返す', () => {
    const prolog = scanSvgProlog(`${SVG_11_DOCTYPE}${ROOT}`);

    expect(Object.isFrozen(prolog)).toBe(true);
    expect(Object.isFrozen(prolog?.doctype)).toBe(true);
  });
});

describe('blankStandardSvgDoctype', () => {
  test('ルートの前の標準の文書型宣言を同じ長さの空白に置き換え、他の位置を変えない', () => {
    const before = '<?xml version="1.0"?>\n';
    const text = `${before}${SVG_11_DOCTYPE}\n${ROOT}`;

    const blanked = blankStandardSvgDoctype(text);

    expect(blanked).toBe(
      `${before}${' '.repeat(SVG_11_DOCTYPE.length)}\n${ROOT}`,
    );
    expect(blanked.length).toBe(text.length);
  });

  test.each([
    ['文書型宣言の無い文書', ROOT],
    ['標準でない文書型宣言', `<!DOCTYPE svg [<!ENTITY a "x">]>${ROOT}`],
    ['ルートの中の標準の文書型宣言', `<svg>${SVG_11_DOCTYPE}</svg>`],
    ['コメントの中の標準の文書型宣言', `<!-- ${SVG_11_DOCTYPE} -->${ROOT}`],
  ])('%sはそのまま返す', (_label, text) => {
    expect(blankStandardSvgDoctype(text)).toBe(text);
  });

  test('2つ目の文書型宣言は空白にせず残す', () => {
    const text = `${SVG_11_DOCTYPE}${SVG_11_DOCTYPE}${ROOT}`;

    expect(blankStandardSvgDoctype(text)).toBe(
      `${' '.repeat(SVG_11_DOCTYPE.length)}${SVG_11_DOCTYPE}${ROOT}`,
    );
  });
});
