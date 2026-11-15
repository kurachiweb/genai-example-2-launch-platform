import { toProductAwardView } from '../../graphql/product-launch.ts';
import { AwardBadgeList } from '../launch-history/award-badge-list.tsx';
import type { DirectoryAwardData } from './directory-item-types.ts';

export interface AwardBadgesProps {
  readonly awards: readonly DirectoryAwardData[];
  readonly className?: string;
}

// ローンチ履歴の項目と同じ見た目にするため、受賞の表示はローンチ履歴の部品に任せる
export function AwardBadges({ awards, className }: AwardBadgesProps) {
  return (
    <AwardBadgeList
      awards={awards.map(toProductAwardView)}
      className={className}
    />
  );
}
