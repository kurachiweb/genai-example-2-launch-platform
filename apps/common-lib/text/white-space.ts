const WHITE_SPACE_CHARACTER = /^\p{White_Space}$/u;

// \p{White_Space}の文字は全て基本多言語面にあるため、UTF-16の単位で1つずつ調べる。前後の空白の並びを正規表現の量指定子で除くと、途中の長い空白の並びで2乗の時間になる
const isWhiteSpaceAt = (text: string, index: number): boolean =>
  WHITE_SPACE_CHARACTER.test(text.charAt(index));

export const trimWhiteSpace = (text: string): string => {
  let start = 0;
  let end = text.length;
  while (start < end && isWhiteSpaceAt(text, start)) {
    start += 1;
  }
  while (end > start && isWhiteSpaceAt(text, end - 1)) {
    end -= 1;
  }
  return text.slice(start, end);
};
