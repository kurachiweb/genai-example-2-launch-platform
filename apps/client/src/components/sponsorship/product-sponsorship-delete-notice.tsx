import { useQuery } from '@tanstack/react-query';
import { TriangleAlertIcon } from 'lucide-react';

import { activeSponsorshipCountQueryOptions } from '../../graphql/sponsorship.ts';
import type { ClientViewer } from '../../graphql/viewer.ts';
import { useViewer } from '../auth/use-viewer.ts';
import { PRODUCT_SPONSORSHIP_DELETE_NOTICE } from './sponsorship-messages.ts';

interface NoticeContentProps {
  readonly viewer: ClientViewer;
  readonly productHandle: string;
}

// 注記は削除の確認を補う情報で、取得の失敗を示すと確認そのものの失敗と紛れるため、取得前と失敗では置き場所の境界へ渡さずに何も描かない
function ProductSponsorshipDeleteNoticeContent({
  viewer,
  productHandle,
}: NoticeContentProps) {
  const { data } = useQuery(
    activeSponsorshipCountQueryOptions(viewer, productHandle),
  );
  if (data === undefined || data.activeSponsorshipCount < 1) {
    return null;
  }
  return (
    <p className="flex gap-2 rounded-xl border border-warning/50 bg-warning/10 px-4 py-3 text-sm">
      <TriangleAlertIcon
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-warning-strong"
      />
      {PRODUCT_SPONSORSHIP_DELETE_NOTICE}
    </p>
  );
}

// プロダクトの削除の確認で、掲載中・掲載予定のスポンサー広告があるときだけ、広告が終了し返金されないことを知らせる
export function ProductSponsorshipDeleteNotice({
  productHandle,
}: {
  readonly productHandle: string;
}) {
  const viewer = useViewer();
  if (viewer === null) {
    return null;
  }
  return (
    <ProductSponsorshipDeleteNoticeContent
      viewer={viewer}
      productHandle={productHandle}
    />
  );
}
