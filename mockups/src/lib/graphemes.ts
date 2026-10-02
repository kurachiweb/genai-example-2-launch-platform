const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });

// 文字数は書記素(ユーザーが1文字と認識する単位)で数える
export function countGraphemes(text: string): number {
  return Array.from(segmenter.segment(text)).length;
}

export function truncateGraphemes(text: string, max: number): string {
  let result = '';
  let count = 0;
  for (const { segment } of segmenter.segment(text)) {
    if (count >= max) break;
    result += segment;
    count += 1;
  }
  return result;
}
