import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { notify } from '../../../lib/components/feedback/notify.ts';
import {
  invalidateMyDataExports,
  requestDataExportMutationOptions,
} from '../../graphql/data-export.ts';
import {
  type DataExportRequestErrorView,
  dataExportRequestErrorOf,
} from './data-export-errors.ts';
import { DATA_EXPORT_REQUESTED_MESSAGE } from './data-export-messages.ts';

export interface RequestDataExport {
  // 送信中の押下は無視する
  readonly request: () => void;
  readonly pending: boolean;
  // 直近の要求の失敗。次の要求を送ると消える
  readonly error: DataExportRequestErrorView | undefined;
}

// 受け付けた旨をトーストで示し、一覧を取り直して作成中の要求を加える。取り直しが終わるまでを送信中とし、一覧の更新の前に再び押せないようにする
export function useRequestDataExport(): RequestDataExport {
  const queryClient = useQueryClient();
  const [error, setError] = useState<DataExportRequestErrorView>();
  const mutation = useMutation({
    ...requestDataExportMutationOptions(),
    onSuccess: async () => {
      notify.success(DATA_EXPORT_REQUESTED_MESSAGE);
      await invalidateMyDataExports(queryClient);
    },
    onError: (failure) => {
      setError(dataExportRequestErrorOf(failure));
    },
  });

  return {
    request: () => {
      if (mutation.isPending) {
        return;
      }
      setError(undefined);
      mutation.mutate({ variables: {} });
    },
    pending: mutation.isPending,
    error,
  };
}
