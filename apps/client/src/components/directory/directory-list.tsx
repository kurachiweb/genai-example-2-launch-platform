import type { DirectoryQuery } from '../../../common-lib/directory/directory-query-rules.ts';
import { RecoverableSlot } from '../../../lib/components/state/recoverable-slot.tsx';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import { CONTACT_HREF } from '../layout/site-links.ts';
import { DirectoryItem } from './directory-item.tsx';
import type { DirectoryItemData } from './directory-item-types.ts';
import { layoutDirectoryList } from './directory-section-order.ts';
import type {
  DirectoryItemMetric,
  DirectoryListInsert,
} from './directory-section-types.ts';

export interface DirectoryListProps {
  readonly items: readonly DirectoryItemData[];
  // URLから正規化した現在の条件
  readonly query: DirectoryQuery;
  readonly searchTerms: readonly string[];
  readonly metrics: readonly DirectoryItemMetric[];
  readonly inserts: readonly DirectoryListInsert[];
}

// 差し込みが描けた間(目印の要素がある間)は境界の枠をdisplay:contentsにし、差し込みの要素そのものを一覧の項目の中身にする。
// display:contentsの要素はフォーカスできないため、再試行の後に枠へフォーカスを移す読み込み中と失敗の間は通常の箱のまま残す
const INSERT_SLOT_CLASS = 'has-[>[data-directory-insert-rendered]]:contents';

// 1列の一覧に、登録された差し込みを指定の件数ごとに一覧の項目として挟み、差し込みごとにエラーの境界で包む
export function DirectoryList({
  items,
  query,
  searchTerms,
  metrics,
  inserts,
}: DirectoryListProps) {
  return (
    <ul className="flex flex-col gap-3">
      {layoutDirectoryList(items, inserts).map((entry) => {
        if (entry.kind === 'item') {
          return (
            <li key={entry.item.handle}>
              <DirectoryItem
                item={entry.item}
                query={query}
                searchTerms={searchTerms}
                metricRegistrations={metrics}
              />
            </li>
          );
        }
        const { id, component: Insert } = entry.insert;
        return (
          <li key={`${id}:${String(entry.position)}`} data-directory-insert="">
            <RecoverableSlot
              className={INSERT_SLOT_CLASS}
              contactAvailable={CLIENT_PROFILE.contactAvailable}
              contactHref={CONTACT_HREF}
            >
              <Insert position={entry.position} />
              <span hidden data-directory-insert-rendered="" />
            </RecoverableSlot>
          </li>
        );
      })}
    </ul>
  );
}
