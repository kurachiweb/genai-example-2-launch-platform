import { describe, expect, test } from 'bun:test';

import { inspectSvg, type SvgViolation } from './svg-allowlist.ts';

// 判定用画像の描画器(resvg)が解釈せず、ブラウザの<img>だけが効かせる書き方は、判定用画像に写らない内容をブラウザで見せられるため違反にする

const PNG_DATA =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';

const svg = (body: string, attributes = ''): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"${attributes}>${body}</svg>`;

const violationsOf = (text: string): readonly SvgViolation[] => {
  const result = inspectSvg(text);
  return result.ok ? [] : result.violations;
};

const styleElement = (css: string): string =>
  svg(`<style>${css}</style><rect class="c" width="1" height="1"/>`);

const styleAttribute = (css: string): string =>
  svg(`<rect width="1" height="1" style="${css}"/>`);

describe('inspectSvg の描画器が解釈しないCSS', () => {
  test.each([
    '@media (prefers-color-scheme: dark){.c{display:none}}',
    '@media screen{.c{display:none}}',
    '@supports (display:grid){.c{display:none}}',
    '@layer a{.c{display:none}}',
    '@container (min-width: 1px){.c{display:none}}',
    '@MEDIA screen{.c{display:none}}',
    '\\40 media screen{.c{display:none}}',
    '<![CDATA[@media screen{.c{display:none}}]]>',
    '&#64;media screen{.c{display:none}}',
  ])('style要素の規則「%s」は違反として記録される', (css) => {
    expect(violationsOf(styleElement(css))).toEqual([
      { kind: 'unsupported-css', target: 'style' },
    ]);
  });

  test.each([
    ['!important', '.c{display:none !important}'],
    ['コメントを挟んだ!important', '.c{display:none !/**/ IMPORTANT}'],
    ['var()', ':root{--d:none}.c{display:var(--d)}'],
    ['calc()', '.c{width:calc(0px)}'],
    ['env()', '.c{opacity:env(x, 0)}'],
    ['単位付きのtranslate()', '.c{transform:translate(10000px,0)}'],
    ['rotate()', '.c{transform:rotate(90deg)}'],
    ['単位の無いrotate()', '.c{transform:rotate(180)}'],
    ['translateX()', '.c{transform:translateX(10px)}'],
    ['skewX()', '.c{transform:skewX(10deg)}'],
    ['-webkit-transform', '.c{-webkit-transform:matrix(0,0,0,0,0,0)}'],
    ['clip-pathのinset()', '.c{clip-path:inset(50%)}'],
    ['clip-pathのcircle()', '.c{clip-path:circle(0)}'],
    [
      'maskのグラデーション',
      '.c{mask:linear-gradient(transparent,transparent)}',
    ],
    ['CSSの幅', '.c{width:0}'],
    ['CSSの半径', '.c{r:0}'],
    ['display:contents', '.c{display:contents}'],
    ['空白区切りのrgb()', '.c{fill:rgb(0 0 255)}'],
    ['透明度付きのrgb()', '.c{fill:rgb(0,0,255 / 0)}'],
    ['透明度付きのhsl()', '.c{fill:hsl(240 100% 50% / 0)}'],
    ['oklch()', '.c{fill:oklch(0.5 0.2 260)}'],
    ['color-mix()', '.c{fill:color-mix(in srgb, blue 0%, transparent)}'],
    ['light-dark()', '.c{fill:light-dark(blue, transparent)}'],
    ['関数の擬似クラス', 'rect:not(.k){display:none}'],
  ])('style要素の%sは違反として記録される', (_label, css) => {
    expect(violationsOf(styleElement(css))).toEqual([
      { kind: 'unsupported-css', target: 'style' },
    ]);
  });

  test.each([
    'display:none !important',
    'transform:translate(10000px,0)',
    'TRANSFORM: rotate(90deg)',
    'transform:translateX(10px)',
    'clip-path:inset(50%)',
    'fill:rgb(0 0 255 / 0)',
    'width:calc(0px)',
    'height:0',
    'opacity:var(--o)',
    'mask-image:linear-gradient(transparent,transparent)',
    'tr\\61nsform:rotate(90deg)',
  ])('style属性の「%s」は違反として記録される', (css) => {
    expect(violationsOf(styleAttribute(css))).toEqual([
      { kind: 'unsupported-css', target: 'style' },
    ]);
  });

  test.each([
    ['fill', 'rgb(0 0 255 / 0)'],
    ['fill', 'hsl(240 100% 50% / 0)'],
    ['stroke', 'oklch(0.5 0.2 260)'],
    ['stop-color', 'color-mix(in srgb, blue 0%, transparent)'],
    ['clip-path', 'inset(50%)'],
    ['mask', 'linear-gradient(transparent,transparent)'],
    ['opacity', 'calc(0)'],
  ])('表示属性の%s="%s"は違反として記録される', (name, value) => {
    expect(
      violationsOf(svg(`<rect width="1" height="1" ${name}="${value}"/>`)),
    ).toEqual([{ kind: 'unsupported-css', target: name }]);
  });

  test.each([
    ['style要素の規則', styleElement('.c{fill:#f00;stroke:rgb(35,24,21)}')],
    [
      'style要素の擬似クラスの無いセレクター',
      styleElement('.x, rect.c, #a > .b{fill:rgba(0,0,255,0.5)}'),
    ],
    [
      'style属性の色・塗り・変形・フィルター',
      styleAttribute(
        "fill:url(#a);stroke:hsla(240,100%,50%,0.5);transform:matrix(1,0,0,1,0,0) scale(2);filter:opacity(0.5) blur(1px) drop-shadow(1px 1px 1px rgb(0,0,0));font-size:10.5833px;-inkscape-font-specification:'Sans'",
      ),
    ],
    [
      '表示属性の参照・色',
      svg(
        '<rect width="1" height="1" fill="rgb(255, 0, 0)" clip-path="url(#c)" mask="url(#m)" filter="url(#f)"/>',
      ),
    ],
    [
      '変形の属性の関数',
      svg(
        '<g transform="translate(10 10) rotate(45) skewX(10)"><linearGradient gradientTransform="rotate(90)"/></g>',
      ),
    ],
  ])('%sは許可される', (_label, text) => {
    expect(violationsOf(text)).toEqual([]);
  });
});

describe('inspectSvg の描画器が描かない埋め込み画像', () => {
  test.each(['webp', 'WEBP'])(
    'image要素のimage/%sのdata URIは許可外のdata URIとして記録される',
    (type) => {
      expect(
        violationsOf(
          svg(
            `<image width="1" height="1" href="data:image/${type};base64,${PNG_DATA}"/>`,
          ),
        ),
      ).toEqual([{ kind: 'disallowed-data-uri', target: 'href' }]);
    },
  );
});

describe('inspectSvg のルート以外のviewBox', () => {
  test.each([
    '0 0 100. 100.',
    '0 0 100 100,',
    '0 0 100 100 5',
    '0 0 100.5.5 100',
    '0 0 0 100',
    'none',
  ])(
    '入れ子のsvg・symbol・pattern・markerのブラウザが無効とするviewBox「%s」は違反として記録される',
    (viewBox) => {
      for (const element of ['svg', 'symbol', 'pattern', 'marker']) {
        expect(violationsOf(svg(`<${element} viewBox="${viewBox}"/>`))).toEqual(
          [{ kind: 'invalid-view-box', target: element }],
        );
      }
    },
  );

  test.each(['0 0 100 100', '0,0,100,100', '-0-0 100 100', '0&#44;0 1e2 100'])(
    '入れ子のsvgのブラウザが有効とするviewBox「%s」は許可される',
    (viewBox) => {
      expect(violationsOf(svg(`<svg viewBox="${viewBox}"/>`))).toEqual([]);
    },
  );

  test('ルートのviewBoxは描画の前に書き直すため、ブラウザが無効とする値でも違反にしない', () => {
    expect(violationsOf(svg('', ' viewBox="0 0 100. 100."'))).toEqual([]);
  });
});

describe('inspectSvg の閲覧者の言語で選ばれる内容', () => {
  test('switchの子のsystemLanguageは描画器と閲覧者で選ぶ子が食い違うため違反として記録される', () => {
    expect(
      violationsOf(svg('<switch><g systemLanguage="ja"/><g/></switch>')),
    ).toEqual([{ kind: 'disallowed-attribute', target: 'systemLanguage' }]);
  });
});
