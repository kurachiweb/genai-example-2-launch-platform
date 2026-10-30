const graphemeSegmenter = new Intl.Segmenter('und', {
  granularity: 'grapheme',
});

export const countGraphemes = (text: string): number =>
  Array.from(graphemeSegmenter.segment(text)).length;
