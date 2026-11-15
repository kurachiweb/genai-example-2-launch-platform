const graphemeSegmenter = new Intl.Segmenter('und', {
  granularity: 'grapheme',
});

export const countGraphemes = (text: string): number =>
  Array.from(graphemeSegmenter.segment(text)).length;

export const truncateGraphemes = (
  text: string,
  maxGraphemes: number,
): string => {
  let truncated = '';
  let count = 0;
  for (const { segment } of graphemeSegmenter.segment(text)) {
    if (count >= maxGraphemes) {
      break;
    }
    truncated += segment;
    count += 1;
  }
  return truncated;
};
