import { useSuspenseQuery } from '@tanstack/react-query';
import { TriangleAlertIcon } from 'lucide-react';

import { myWeekEntryQueryOptions } from '../../graphql/week-tournament.ts';
import type { ClientViewer } from '../../graphql/viewer.ts';
import { useViewer } from '../auth/use-viewer.ts';
import { WEEK_ENTRY_DELETE_NOTICE } from './week-entry-messages.ts';
import { hasWeekEntryDeleteNotice } from './week-entry-model.ts';

interface NoticeContentProps {
  readonly viewer: ClientViewer;
  readonly productHandle: string;
}

function WeekEntryDeleteNoticeContent({
  viewer,
  productHandle,
}: NoticeContentProps) {
  const { data } = useSuspenseQuery(
    myWeekEntryQueryOptions(viewer, productHandle),
  );
  if (!hasWeekEntryDeleteNotice(data.myWeekEntry)) {
    return null;
  }
  return (
    <p className="flex gap-2 rounded-xl border border-warning/50 bg-warning/10 px-4 py-3 text-sm">
      <TriangleAlertIcon
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-warning-strong"
      />
      {WEEK_ENTRY_DELETE_NOTICE}
    </p>
  );
}

// プロダクトの削除の確認で、直近のローンチの参加の枠が組み合わせ決定の前で受付中か参加資格を得ている間だけ、参加資格の喪失と返金を知らせる。
// 取得の失敗と読み込み中は置き場所のエラーの境界に任せる
export function WeekEntryDeleteNotice({
  productHandle,
}: {
  readonly productHandle: string;
}) {
  const viewer = useViewer();
  if (viewer === null) {
    return null;
  }
  return (
    <WeekEntryDeleteNoticeContent
      viewer={viewer}
      productHandle={productHandle}
    />
  );
}
