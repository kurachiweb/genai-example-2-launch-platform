import { findHighlightRanges } from '../../../common-lib/search/highlight-ranges.ts';

export interface HighlightedTextProps {
  readonly text: string;
  readonly terms: readonly string[];
}

export function HighlightedText({ text, terms }: HighlightedTextProps) {
  const ranges = findHighlightRanges(text, terms);
  if (ranges.length === 0) {
    return text;
  }
  const segments = ranges.flatMap(({ start, end }, index) => [
    text.slice(ranges[index - 1]?.end ?? 0, start),
    // 親の文字色(控えめな文字色など)のままでは薄い塗りの上でコントラスト比4.5:1を下回るため、本文の色にそろえる
    <mark
      key={start}
      className="rounded-sm bg-primary/15 px-0.5 text-foreground dark:bg-primary/25"
    >
      {text.slice(start, end)}
    </mark>,
  ]);
  return [...segments, text.slice(ranges.at(-1)?.end ?? 0)];
}
