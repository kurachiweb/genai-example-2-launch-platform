import { HistoryIcon } from 'lucide-react';

import type { Product } from '#/lib/mock-data';

import type { CommentNode } from '../-model/comments';
import type { LaunchView } from '../-model/launches';
import { LaunchBlock } from './launch-block';
import { SectionTitle } from './section-title';

type Props = {
  launches: LaunchView[];
  product: Product;
  comments: Record<string, CommentNode[]>;
};

// マッチ履歴とコメントをローンチ単位でまとめ、新しいローンチから並べる
export function LaunchHistory({ launches, product, comments }: Props) {
  const matchCount = launches.reduce((sum, l) => sum + l.matches.length, 0);
  const latestStarted = launches.find((l) => l.state !== 'scheduled');

  return (
    <section aria-labelledby="history-heading">
      <SectionTitle
        id="history-heading"
        icon={HistoryIcon}
        title="マッチ履歴とコメント"
        meta={`${launches.length}ローンチ・${matchCount}マッチ`}
      />
      <div className="mt-4 space-y-5">
        {launches.map((launch) => (
          <LaunchBlock
            key={launch.id}
            launch={launch}
            product={product}
            comments={comments[launch.id] as CommentNode[] | undefined}
            commentsOpen={launch === latestStarted}
          />
        ))}
      </div>
    </section>
  );
}
