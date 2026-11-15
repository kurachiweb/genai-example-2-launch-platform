export interface PlaceholderAppearance {
  readonly initial: string;
  // CSSの値(配色のトークンの参照)
  readonly background: string;
  readonly foreground: string;
}

export interface PlaceholderInput {
  // 先頭1文字を取り出す名前(ニックネーム・プロダクト名など)
  readonly label: string;
  // 配色を決めるID
  readonly seed: string;
}

export interface PlaceholderColorToken {
  readonly background: string;
  readonly foreground: string;
}

const PLACEHOLDER_COLOR_COUNT = 12;

const colorTokenOf = (index: number): PlaceholderColorToken => {
  const name = `--placeholder-${String(index + 1)}`;
  return Object.freeze({ background: name, foreground: `${name}-foreground` });
};

// 値はstyles/tokens.cssのライト・ダークの配色にあり、組ごとのコントラスト比は単体テストが確かめる
export const PLACEHOLDER_COLOR_TOKENS: readonly PlaceholderColorToken[] =
  Object.freeze(
    Array.from({ length: PLACEHOLDER_COLOR_COUNT }, (_, index) =>
      colorTokenOf(index),
    ),
  );

const MISSING_INITIAL = '?';

const HASH_MULTIPLIER = 31;

const graphemeSegmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });

const firstGraphemeOf = (text: string): string | undefined =>
  graphemeSegmenter.segment(text).containing(0)?.segment;

// 大文字にすると複数の文字になる書記素(ßなど)は、正方形に1文字で収めるため元のまま使う
const initialOf = (label: string): string => {
  const first = firstGraphemeOf(label.trim());
  if (first === undefined) {
    return MISSING_INITIAL;
  }
  const upper = first.toUpperCase();
  return firstGraphemeOf(upper) === upper ? upper : first;
};

const hashOf = (seed: string): number => {
  let hash = 0;
  for (const character of seed) {
    hash = (hash * HASH_MULTIPLIER + (character.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash;
};

export const placeholderAppearanceOf = (
  input: PlaceholderInput,
): PlaceholderAppearance => {
  const token = colorTokenOf(hashOf(input.seed) % PLACEHOLDER_COLOR_COUNT);
  return {
    initial: initialOf(input.label),
    background: `var(${token.background})`,
    foreground: `var(${token.foreground})`,
  };
};
