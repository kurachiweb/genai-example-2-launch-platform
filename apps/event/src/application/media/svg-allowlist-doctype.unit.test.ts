import { describe, expect, test } from 'bun:test';

import { inspectSvg, type SvgViolation } from './svg-allowlist.ts';

const SVG_11_DOCTYPE =
  '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">';

const svg = (body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

const violationsOf = (text: string): readonly SvgViolation[] => {
  const result = inspectSvg(text);
  return result.ok ? [] : result.violations;
};

describe('inspectSvg の文書型宣言', () => {
  test.each([
    ['SVG 1.1', SVG_11_DOCTYPE],
    [
      'SVG 1.0',
      "<!DOCTYPE svg PUBLIC '-//W3C//DTD SVG 1.0//EN'\n  'http://www.w3.org/TR/2001/REC-SVG-20010904/DTD/svg10.dtd'>",
    ],
  ])(
    'XML宣言とコメントの後の%sの標準の文書型宣言は違反にしない',
    (_, doctype) => {
      expect(
        inspectSvg(
          `<?xml version="1.0"?>\n<!-- Generator: x -->\n${doctype}\n${svg('<rect width="1" height="1"/>')}`,
        ),
      ).toEqual({ ok: true });
    },
  );

  test('標準の文書型宣言の後の要素も許可リストで検査する', () => {
    expect(violationsOf(`${SVG_11_DOCTYPE}${svg('<script/>')}`)).toEqual([
      { kind: 'disallowed-element', target: 'script' },
    ]);
  });

  test.each([
    ['内部サブセットを持つ文書型宣言', `${SVG_11_DOCTYPE.slice(0, -1)} []>`],
    [
      'SYSTEMだけの文書型宣言',
      '<!DOCTYPE svg SYSTEM "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">',
    ],
    [
      '他の公開識別子の文書型宣言',
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">',
    ],
    ['2つ目の文書型宣言', `${SVG_11_DOCTYPE}${SVG_11_DOCTYPE}`],
  ])('%sは宣言として記録される', (_, prolog) => {
    expect(violationsOf(`${prolog}${svg('')}`)).toEqual([
      { kind: 'declaration', target: 'DOCTYPE' },
    ]);
  });

  test('内部サブセットで実体を宣言する文書型宣言は、文書型宣言と実体の宣言として記録される', () => {
    expect(
      violationsOf(
        `${SVG_11_DOCTYPE.slice(0, -1)} [<!ENTITY a "b">]>${svg('<text>&a;</text>')}`,
      ),
    ).toEqual([
      { kind: 'declaration', target: 'DOCTYPE' },
      { kind: 'declaration', target: 'ENTITY' },
    ]);
  });

  test('標準の文書型宣言があってもルートの中の実体の宣言は宣言として記録される', () => {
    expect(violationsOf(`${SVG_11_DOCTYPE}${svg('<!ENTITY a "b">')}`)).toEqual([
      { kind: 'declaration', target: 'ENTITY' },
    ]);
  });
});
