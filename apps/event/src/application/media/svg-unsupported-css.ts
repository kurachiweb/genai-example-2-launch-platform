// 判定用画像の描画器(resvg)が解釈せず、ブラウザの<img>だけが効かせるCSSの書き方を検出する。
// 覆いの要素をブラウザでだけ消す・動かす・透明にする書き方で、判定用画像に写らない内容をブラウザで見せられるため違反にする。
// 入力は文字参照とCSSのエスケープを戻して小文字にした値とする

export type CssContext = 'stylesheet' | 'declarations' | 'value';

// 描画器がブラウザと同じに解釈する関数(参照・カンマ区切りの色・変形の行列と拡大縮小・フィルターの関数)
const SUPPORTED_FUNCTIONS: ReadonlySet<string> = new Set([
  'url',
  'rgb',
  'rgba',
  'hsl',
  'hsla',
  'matrix',
  'scale',
  'blur',
  'brightness',
  'contrast',
  'drop-shadow',
  'grayscale',
  'hue-rotate',
  'invert',
  'opacity',
  'saturate',
  'sepia',
]);

const FUNCTION_PATTERN = /(?<![a-z0-9_-])(-?[a-z_][a-z0-9_-]*)\(/gu;
// 色の関数の引数がカンマ区切りでない(CSS Color 4の空白区切り・`/`の透明度)
const COLOR_FUNCTION_PATTERN = /(?<![a-z0-9_-])(?:rgba?|hsla?)\(([^)]*)\)/gu;
// 外部の読み込みとして別に検出する@importを除く、全てのat規則(@media・@supports・@layerなど)
const AT_RULE_PATTERN = /@(?!import)[a-z_-]/u;
const IMPORTANT_PATTERN = /!(?:\s|\/\*[\s\S]*?\*\/)*important/u;
const DECLARATION_BLOCK_PATTERN = /\{([^{}]*)\}/gu;
// ブラウザだけがCSSの宣言として効かせるもの: 幾何のプロパティ・-webkit-の接頭辞のプロパティ・display:contents
const DECLARATION_PATTERNS: readonly RegExp[] = [
  /(?:^|[;\s])(?:x|y|width|height|cx|cy|r|rx|ry|d)\s*:/u,
  /(?:^|[;\s])-webkit-[a-z-]+\s*:/u,
  /(?:^|[;\s])display\s*:\s*contents/u,
];

const hasUnsupportedFunction = (css: string): boolean =>
  [...css.matchAll(FUNCTION_PATTERN)].some(
    (match) => !SUPPORTED_FUNCTIONS.has(match[1] ?? ''),
  );

const hasUnsupportedColorSyntax = (css: string): boolean =>
  [...css.matchAll(COLOR_FUNCTION_PATTERN)].some((match) => {
    const argumentsText = match[1] ?? '';
    return argumentsText.includes('/') || !argumentsText.includes(',');
  });

const declarationsOf = (css: string, context: CssContext): string =>
  context === 'stylesheet'
    ? [...css.matchAll(DECLARATION_BLOCK_PATTERN)]
        .map((match) => match[1] ?? '')
        .join(';')
    : css;

export function hasUnsupportedCss(css: string, context: CssContext): boolean {
  if (hasUnsupportedFunction(css) || hasUnsupportedColorSyntax(css)) {
    return true;
  }
  if (context === 'value') {
    return false;
  }
  const declarations = declarationsOf(css, context);
  return (
    AT_RULE_PATTERN.test(css) ||
    IMPORTANT_PATTERN.test(css) ||
    DECLARATION_PATTERNS.some((pattern) => pattern.test(declarations))
  );
}
