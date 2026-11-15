import { describe, expect, test } from 'bun:test';

import { prepareSvgForRendering } from './svg-render-size.ts';

const SVG_NS = 'xmlns="http://www.w3.org/2000/svg"';
const OVERRIDES = 'display:inline;transform:none';

const prepare = (svg: string): string => {
  const result = prepareSvgForRendering(new TextEncoder().encode(svg));
  if (result.kind !== 'svg') {
    throw new Error(`描画用に整えられませんでした: ${result.kind}`);
  }
  return result.text;
};

const rootOf = (attributes: string): string =>
  prepare(`<svg ${SVG_NS} ${attributes}><rect/></svg>`).replace(
    /<rect\/><\/svg>$/,
    '',
  );

const kindOf = (bytes: Uint8Array): string =>
  prepareSvgForRendering(bytes).kind;

describe('prepareSvgForRendering', () => {
  test('ルートの幅・高さ・viewBoxをブラウザの解釈で書き直し、他の属性・子要素・プロローグを変えない', () => {
    expect(
      prepare(
        `\uFEFF<?xml version="1.0"?>\n<!-- <svg width="1"> -->\n<svg ${SVG_NS} fill="red"\n width = "8000PX" height='50pc' viewBox="0,0&#44;1&#48;0 100"><rect width="1" height="1"/></svg>`,
      ),
    ).toBe(
      `<?xml version="1.0"?>\n<!-- <svg width="1"> -->\n<svg ${SVG_NS} fill="red" width="8000" height="800" viewBox="0 0 100 100" style="${OVERRIDES}"><rect width="1" height="1"/></svg>`,
    );
  });

  test.each<[string, string, string]>([
    [
      'q・in・mmの長さ',
      'width="101.6Q" height="1in"',
      'width="96" height="96"',
    ],
    ['emの長さ', 'width="50EM" height="10em"', 'width="50em" height="10em"'],
    ['remの長さ', 'width="2rem" height="3rem"', 'width="2em" height="3em"'],
    ['exの長さ', 'width="2ex" height="3EX"', 'width="2ex" height="3ex"'],
  ])(
    '%sは描画器が同じ大きさに解釈する書き方にする',
    (_label, attributes, expected) => {
      expect(rootOf(attributes)).toBe(
        `<svg ${SVG_NS} ${expected} style="${OVERRIDES}">`,
      );
    },
  );

  test.each<[string, string]>([
    ['百分率の幅と高さ', 'width="100%" height="50%"'],
    ['解釈しない単位の幅と高さ', 'width="10vw" height="10ch"'],
    ['0と負の幅と高さ', 'width="0" height="-10"'],
    ['ブラウザが無効とする幅と高さ', 'width="10." height="800px800"'],
    ['ブラウザが無効とする末尾の`.`のviewBox', 'viewBox="0 0 100. 100."'],
    ['ブラウザが無効とする5つの数値のviewBox', 'viewBox="0 0 100 100 5"'],
    ['幅が0のviewBox', 'viewBox="0 0 0 100"'],
  ])('%sは描画器が別の解釈をしないよう取り除く', (_label, attributes) => {
    expect(rootOf(attributes)).toBe(`<svg ${SVG_NS} style="${OVERRIDES}">`);
  });

  test('ルートの変形・非表示の属性を取り除き、styleの変形・非表示の宣言を打ち消す', () => {
    expect(
      rootOf(
        `transform="rotate(180)" display="none" style="fill:lime; DISPLAY : none !important;transform:matrix(-1,0,0,-1,0,0);stroke:url(&quot;#a;b&quot;)"`,
      ),
    ).toBe(
      `<svg ${SVG_NS} style="fill:lime;stroke:url(&quot;#a;b&quot;);${OVERRIDES}">`,
    );
  });

  test.each<[string, string, string]>([
    ['閉じていないコメント', 'fill:lime;/* display:none', 'fill:lime'],
    ['閉じていない文字列', "fill:lime;content:'a;b", 'fill:lime'],
    [
      'かっこの中の`;`',
      'fill:lime;clip-path:path(&quot;M0 0;&quot;)',
      'fill:lime;clip-path:path(&quot;M0 0;&quot;)',
    ],
    ['空の宣言', ';;fill:lime;;', 'fill:lime'],
    ['`<`と`&`', 'font-family:&lt;a&amp;b&gt;', 'font-family:&lt;a&amp;b>'],
  ])(
    'styleの%sは完全な宣言だけを残して打ち消しの宣言を後ろに足す',
    (_label, style, kept) => {
      expect(rootOf(`style="${style}"`)).toBe(
        `<svg ${SVG_NS} style="${kept};${OVERRIDES}">`,
      );
    },
  );

  test('接頭辞付き・空要素のルートも書き直す', () => {
    expect(
      prepare(
        '<s:svg xmlns:s="http://www.w3.org/2000/svg" width="10pc" height="10pc"/>',
      ),
    ).toBe(
      `<s:svg xmlns:s="http://www.w3.org/2000/svg" width="160" height="160" style="${OVERRIDES}"/>`,
    );
  });

  test('1MiBを超えるコメントの後のルートも書き直す', () => {
    const prolog = `<!--${'x'.repeat(1_100_000)}-->`;
    expect(prepare(`${prolog}<svg ${SVG_NS} width="5pc" height="5pc"/>`)).toBe(
      `${prolog}<svg ${SVG_NS} width="80" height="80" style="${OVERRIDES}"/>`,
    );
  });

  test.each<[string, string]>([
    ['ルートがsvgでない文書', '<html><svg/></html>'],
    ['名前がsvgで始まる別の要素', '<svgx viewBox="0 0 1 1"/>'],
    ['閉じていないコメント', `<!-- <svg ${SVG_NS}/>`],
    ['閉じていない開始タグ', `<svg ${SVG_NS} viewBox="0 0 1 1"`],
  ])('%sはルートを読めない', (_label, text) => {
    expect(kindOf(new TextEncoder().encode(text))).toBe('unreadable');
  });

  test.each<[string, Uint8Array]>([
    [
      'PNGのシグネチャ',
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ],
    ['空の本文', new Uint8Array(0)],
  ])('%sはSVGとして扱わない', (_label, bytes) => {
    expect(kindOf(bytes)).toBe('not-svg');
  });
});
