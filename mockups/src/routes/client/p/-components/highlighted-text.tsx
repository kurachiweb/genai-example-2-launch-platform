import { splitByMatches } from '../-model/text';

type Props = { text: string; query: string | undefined };

// 検索語と一致した箇所を<mark>で強調する。大文字小文字・全角半角・発音区別符号の違いは無視する
export function HighlightedText({ text, query }: Props) {
  if (!query) return text;
  return splitByMatches(text, query).map((segment, index) =>
    segment.match ? (
      <mark
        key={index}
        className="rounded-sm bg-primary/15 px-0.5 text-inherit dark:bg-primary/25"
      >
        {segment.text}
      </mark>
    ) : (
      segment.text
    ),
  );
}
