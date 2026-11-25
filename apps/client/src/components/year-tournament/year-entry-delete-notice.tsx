import { useSuspenseQuery } from '@tanstack/react-query';
import { TriangleAlertIcon } from 'lucide-react';

import { myYearEntryQueryOptions } from '../../graphql/year-tournament.ts';
import type { ClientViewer } from '../../graphql/viewer.ts';
import { useViewer } from '../auth/use-viewer.ts';
import { YEAR_ENTRY_DELETE_NOTICE } from './year-entry-messages.ts';
import { hasYearEntryDeleteNotice } from './year-entry-view.ts';

interface NoticeContentProps {
  readonly viewer: ClientViewer;
  readonly productHandle: string;
}

function YearEntryDeleteNoticeContent({
  viewer,
  productHandle,
}: NoticeContentProps) {
  const { data } = useSuspenseQuery(
    myYearEntryQueryOptions(viewer, productHandle),
  );
  if (!hasYearEntryDeleteNotice(data.myYearEntry)) {
    return null;
  }
  return (
    <p className="flex gap-2 rounded-xl border border-warning/50 bg-warning/10 px-4 py-3 text-sm">
      <TriangleAlertIcon
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-warning-strong"
      />
      {YEAR_ENTRY_DELETE_NOTICE}
    </p>
  );
}

// プロダクトの削除の確認で、直近のローンチのWeek優勝の参加の枠が組み合わせ決定の前で受付中か参加資格を得ている間だけ、参加資格の喪失と返金を知らせる。
// 取得の失敗と読み込み中は置き場所のエラーの境界に任せる
export function YearEntryDeleteNotice({
  productHandle,
}: {
  readonly productHandle: string;
}) {
  const viewer = useViewer();
  if (viewer === null) {
    return null;
  }
  return (
    <YearEntryDeleteNoticeContent
      viewer={viewer}
      productHandle={productHandle}
    />
  );
}
