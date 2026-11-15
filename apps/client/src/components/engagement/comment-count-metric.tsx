import { MessageSquareIcon } from 'lucide-react';

import { useDisplayPreferences } from '../../../lib/components/datetime/use-display-preferences.ts';
import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { formatNumber } from '../../../lib/utilities/number/number-format.ts';
import { productDetailHref } from '../layout/site-links.ts';
import { MATCH_HISTORY_HEADING_ID } from '../product-page/match-history-messages.ts';
import { commentCountMetricLabel } from './comment-messages.ts';

export interface CommentCountMetricProps {
  // プロダクトの全ローンチの表示できるコメントの合計
  readonly value: number;
  readonly productHandle: string;
  readonly productName: string;
}

// ディレクトリの一覧の項目に、吹き出しのアイコンと数を詳細ページのマッチ履歴とコメントの見出しへのリンクにして示す
export function CommentCountMetric({
  value,
  productHandle,
}: CommentCountMetricProps) {
  const preferences = useDisplayPreferences();
  const count = formatNumber(value, preferences);
  return (
    <PathLink
      href={`${productDetailHref(productHandle)}#${MATCH_HISTORY_HEADING_ID}`}
      className="inline-flex items-center gap-1 rounded-sm text-muted-foreground no-underline hover:text-foreground hover:underline"
    >
      <MessageSquareIcon aria-hidden="true" className="size-3.5" />
      {/* 前後の文字を視覚的に隠した要素に分けると読み上げで語の間に区切りが入るため、読み上げの文を1つにまとめ、画面の数は支援技術から隠す */}
      <span aria-hidden="true" className="tabular-nums">
        {count}
      </span>
      <span className="sr-only">{commentCountMetricLabel(count)}</span>
    </PathLink>
  );
}
