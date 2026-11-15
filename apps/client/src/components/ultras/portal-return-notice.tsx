import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { viewerUltrasQueryOptions } from '../../graphql/ultras.ts';
import type { ClientViewer } from '../../graphql/viewer.ts';
import {
  PORTAL_RETURN_DELAYED_MESSAGE,
  PORTAL_RETURN_PENDING_MESSAGE,
} from './plan-messages.ts';
import {
  portalRecheckIntervalOf,
  portalRechecksRemain,
  updateCountOf,
} from './portal-return-rules.ts';

export interface PortalReturnNoticeProps {
  readonly viewer: ClientViewer;
}

// Customer Portalでの操作はWebhookで遅れて反映されるため、戻った直後は加入状態の照会だけを回数を限って取り直す。何も変えずに戻った場合と区別できないため、反映が済んだかどうかは判定しない
export function PortalReturnNotice({ viewer }: PortalReturnNoticeProps) {
  const queryClient = useQueryClient();
  const options = viewerUltrasQueryOptions(viewer);
  // 開いた時点までの取得は数えず、戻った後の取り直しだけを上限まで数える
  const [baseline] = useState(() =>
    updateCountOf(queryClient.getQueryState(options.queryKey)),
  );
  useQuery({
    ...options,
    refetchInterval: (query) =>
      portalRecheckIntervalOf(updateCountOf(query.state), baseline),
    refetchIntervalInBackground: false,
    // 取得の結果は更新の回数を持たないため、成功と失敗の日時の変化で描き直し、回数は照会の状態から読む
    notifyOnChangeProps: ['dataUpdatedAt', 'errorUpdatedAt'],
  });
  const remaining = portalRechecksRemain(
    updateCountOf(queryClient.getQueryState(options.queryKey)),
    baseline,
  );

  return (
    <p
      role="status"
      className="rounded-lg border border-border bg-muted px-4 py-3 text-sm font-medium"
    >
      {remaining
        ? PORTAL_RETURN_PENDING_MESSAGE
        : PORTAL_RETURN_DELAYED_MESSAGE}
    </p>
  );
}
