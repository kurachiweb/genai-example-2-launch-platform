import { describe, expect, test } from 'bun:test';

import {
  intrinsicSizeOfSvg,
  readSvgRoot,
  type SvgLength,
  type SvgRoot,
  type SvgViewBoxValue,
} from './svg-root.ts';

const SVG_NS = 'xmlns="http://www.w3.org/2000/svg"';

const rootOf = (text: string): SvgRoot => {
  const root = readSvgRoot(text);
  if (root === undefined) {
    throw new Error('ルートを読めませんでした。');
  }
  return root;
};

const rootWith = (attributes: string): SvgRoot =>
  rootOf(`<svg ${SVG_NS} ${attributes}/>`);

const absolute = (pixels: number): SvgLength => ({ kind: 'absolute', pixels });

const box = (
  minX: number,
  minY: number,
  width: number,
  height: number,
): SvgViewBoxValue => ({
  kind: 'valid',
  box: { minX, minY, width, height },
});

describe('readSvgRoot', () => {
  test('XML宣言・処理命令・偽のsvg要素を含むコメント・空白の後のルートの開始タグの位置と属性を返す', () => {
    const prolog =
      '<?xml version="1.0"?>\n<?foo bar?>\n<!-- <svg width="10" height="10"> -->\n';
    const tag = `<svg ${SVG_NS}\n width = "8000" height='4000' aria-label="a &gt; b / c">`;

    expect(rootOf(`${prolog}${tag}<rect/></svg>`)).toStrictEqual({
      name: 'svg',
      start: prolog.length,
      end: prolog.length + tag.length,
      attributes: [
        {
          name: 'xmlns',
          value: 'http://www.w3.org/2000/svg',
          source: ` ${SVG_NS}`,
        },
        { name: 'width', value: '8000', source: '\n width = "8000"' },
        { name: 'height', value: '4000', source: " height='4000'" },
        {
          name: 'aria-label',
          value: 'a > b / c',
          source: ' aria-label="a &gt; b / c"',
        },
      ],
      selfClosing: false,
      width: absolute(8000),
      height: absolute(4000),
      viewBox: { kind: 'absent' },
    });
  });

  test('1,000文字・1MiBを超えるコメントの後のルートと、接頭辞付き・空要素のルートを読む', () => {
    expect(
      rootOf(
        `<!--${'x'.repeat(1_100_000)}--><svg ${SVG_NS} width="10" height="20">`,
      ),
    ).toMatchObject({ width: absolute(10), height: absolute(20) });
    expect(
      rootOf('<s:svg xmlns:s="http://www.w3.org/2000/svg" viewBox="0 0 4 2"/>'),
    ).toMatchObject({
      name: 's:svg',
      selfClosing: true,
      viewBox: box(0, 0, 4, 2),
    });
  });

  test('属性の値はXML 1.0の3.3.3どおり、空白の文字を空白にしてから文字参照と定義済み実体を戻す', () => {
    expect(
      rootWith(
        'data-a="a&#9;b\tc&#x41;&lt;&gt;&amp;&quot;&apos;" data-b="\r\nx"',
      ).attributes.slice(1),
    ).toStrictEqual([
      {
        name: 'data-a',
        value: 'a\tb cA<>&"\'',
        source: ' data-a="a&#9;b\tc&#x41;&lt;&gt;&amp;&quot;&apos;"',
      },
      { name: 'data-b', value: ' x', source: ' data-b="\r\nx"' },
    ]);
  });

  test.each(['&nbsp;', '&#0;', '&#xD800;', '&#x110000;', 'a & b', '&#;'])(
    '戻せない参照「%s」を含む属性の値は未設定にし、幅として解釈しない',
    (raw) => {
      const root = rootWith(`width="${raw}"`);
      expect(root.attributes[1]?.value).toBeUndefined();
      expect(root.width).toStrictEqual({ kind: 'invalid' });
    },
  );

  test.each<[string, number]>([
    ['10', 10],
    ['10.5', 10.5],
    ['.5', 0.5],
    ['+10', 10],
    ['1e3', 1000],
    ['1E3', 1000],
    ['1e+3', 1000],
    ['8e2px', 800],
    ['10px', 10],
    ['10PX', 10],
    ['1in', 96],
    ['2.54cm', 96],
    ['25.4mm', 96],
    ['101.6q', 96],
    ['101.6Q', 96],
    ['72pt', 96],
    ['6pc', 96],
    ['50Pc', 800],
    [' 10 ', 10],
    ['\t10\n', 10],
    ['1&#48;', 10],
    ['&#49;0px', 10],
  ])('幅「%s」をCSSの絶対的な長さ%dpxとして読む', (value, pixels) => {
    const { width } = rootWith(`width="${value}"`);
    expect(width.kind).toBe('absolute');
    expect(width.kind === 'absolute' ? width.pixels : 0).toBeCloseTo(pixels, 9);
  });

  test.each<[string, number, 'em' | 'rem' | 'ex' | 'ch']>([
    ['50em', 50, 'em'],
    ['50EM', 50, 'em'],
    ['2.5rem', 2.5, 'rem'],
    ['100ex', 100, 'ex'],
    ['100ch', 100, 'ch'],
  ])('幅「%s」を文字の大きさに対する長さとして読む', (value, number, unit) => {
    expect(rootWith(`width="${value}"`).width).toStrictEqual({
      kind: 'font-relative',
      value: number,
      unit,
    });
  });

  test.each<[string, SvgLength]>([
    ['100%', { kind: 'percentage' }],
    ['50vw', { kind: 'unsupported' }],
    ['50lh', { kind: 'unsupported' }],
    ['10m', { kind: 'invalid' }],
    ['0', { kind: 'invalid' }],
    ['-10', { kind: 'invalid' }],
    ['1e400', { kind: 'invalid' }],
    ['10.', { kind: 'invalid' }],
    ['8e', { kind: 'invalid' }],
    ['10 px', { kind: 'invalid' }],
    ['800px800', { kind: 'invalid' }],
    ['auto', { kind: 'invalid' }],
    ['', { kind: 'invalid' }],
    ['1.2.3', { kind: 'invalid' }],
  ])('幅「%s」は%o', (value, expected) => {
    expect(rootWith(`width="${value}"`).width).toStrictEqual(expected);
  });

  test('幅・高さ・viewBoxの属性が無ければ無いことを返す', () => {
    expect(rootWith('')).toMatchObject({
      width: { kind: 'absent' },
      height: { kind: 'absent' },
      viewBox: { kind: 'absent' },
    });
  });

  test.each<[string, readonly [number, number, number, number]]>([
    ['0 0 300 150', [0, 0, 300, 150]],
    ['0,0,300,150', [0, 0, 300, 150]],
    ['0, 0 ,300 , 150', [0, 0, 300, 150]],
    ['-10 -5.5 1e2 .5', [-10, -5.5, 100, 0.5]],
    ['+0 +0 1E2 1e+2', [0, 0, 100, 100]],
    ['  0\n0\t300  150 ', [0, 0, 300, 150]],
    ['-0-0 100 100', [-0, -0, 100, 100]],
    ['0 0 .5.5', [0, 0, 0.5, 0.5]],
    ['0&#44;0&#9;1&#48;0 100', [0, 0, 100, 100]],
    ['0&#x20;0 100 100', [0, 0, 100, 100]],
  ])(
    'viewBox「%s」をブラウザと同じく4つの数値として読む',
    (value, [minX, minY, width, height]) => {
      expect(rootWith(`viewBox="${value}"`).viewBox).toStrictEqual(
        box(minX, minY, width, height),
      );
    },
  );

  test.each([
    '0 0 100. 100.',
    '0 0 100 100,',
    ',0 0 100 100',
    '0,,0,100,100',
    '0 0 300',
    '0 0 300 150 1',
    '0 0 100.5.5 100',
    '0 0 300px 150px',
    '0\u00a00\u00a0100\u00a0100',
    '0&#160;0 100 100',
    '0 0 0x64 0x64',
    '0 0 Infinity 100',
    '0 0 1e400 100',
    '0 0 0 150',
    '0 0 300 -150',
    'none',
    '',
  ])('ブラウザが無効とするviewBox「%s」は無効にする', (value) => {
    expect(rootWith(`viewBox="${value}"`).viewBox).toStrictEqual({
      kind: 'invalid',
    });
  });

  test('名前の大文字小文字が違うviewbox属性はviewBoxとみなさない', () => {
    expect(rootWith('viewbox="0 0 1 1"').viewBox).toStrictEqual({
      kind: 'absent',
    });
  });

  test.each<[string, string]>([
    ['空の文書', ''],
    ['ルートがsvgでない文書', '<html><svg/></html>'],
    ['名前がsvgで始まる別の要素', '<svgx/>'],
    ['閉じていないコメント', `<!-- <svg ${SVG_NS}/>`],
    ['閉じていない処理命令', `<?xml version="1.0" <svg ${SVG_NS}/>`],
    ['閉じていない開始タグ', `<svg ${SVG_NS} width="1"`],
    ['引用符の無い属性', `<svg ${SVG_NS} width=1>`],
  ])('%sはルートを読めない', (_label, text) => {
    expect(readSvgRoot(text)).toBeUndefined();
  });
});

describe('intrinsicSizeOfSvg', () => {
  test.each<[string, string, number, number]>([
    ['幅と高さ', 'width="200.4" height="99.6" viewBox="0 0 1 1"', 200, 100],
    ['幅とviewBox', 'width="600" viewBox="0 0 300 140"', 600, 280],
    ['高さとviewBox', 'height="300" viewBox="0 0 140 300"', 140, 300],
    ['viewBoxだけ', 'viewBox="0 0 300.4 149.6"', 300, 150],
    ['カンマ区切りのviewBoxだけ', 'viewBox="0,0,300,150"', 300, 150],
    ['大文字の単位の幅と高さ', 'width="8000PX" height="4000Px"', 8000, 4000],
    ['pcの幅と高さ', 'width="500pc" height="250pc"', 8000, 4000],
    ['qの幅と高さ', 'width="1016q" height="508Q"', 960, 480],
    [
      '文字参照の入った幅と高さ',
      'width="8&#48;00" height="4&#x30;00"',
      8000,
      4000,
    ],
    ['emとremの幅と高さ(16px)', 'width="500em" height="250rem"', 8000, 4000],
    [
      '百分率の幅とviewBox',
      'width="100%" height="300" viewBox="0 0 100 50"',
      600,
      300,
    ],
    [
      '解釈できない幅とviewBox',
      'width="800px800" height="300" viewBox="0 0 100 50"',
      600,
      300,
    ],
    [
      'ブラウザが無効とするviewBoxと幅と高さ',
      'width="800" height="400" viewBox="0 0 100. 100."',
      800,
      400,
    ],
  ])('%sから表示される寸法を求める', (_label, attributes, width, height) => {
    expect(intrinsicSizeOfSvg(rootWith(attributes))).toStrictEqual({
      width,
      height,
    });
  });

  test.each<[string, string]>([
    ['幅だけ', 'width="200"'],
    ['百分率の幅と高さ', 'width="100%" height="100%"'],
    ['丸めると0になる幅と高さ', 'width="0.4" height="0.4"'],
    ['幅・高さ・viewBoxのいずれも無い', ''],
    ['ブラウザが無効とするviewBoxだけ', 'viewBox="0 0 300 150,"'],
    [
      '書体で長さが変わるexの幅',
      'width="100ex" height="100" viewBox="0 0 1 1"',
    ],
    [
      '書体で長さが変わるchの高さ',
      'width="100" height="100ch" viewBox="0 0 1 1"',
    ],
    ['解釈しない単位の幅', 'width="50vw" height="100" viewBox="0 0 1 1"'],
  ])('%sは寸法を求められない', (_label, attributes) => {
    expect(intrinsicSizeOfSvg(rootWith(attributes))).toBeUndefined();
  });
});
