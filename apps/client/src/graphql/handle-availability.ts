import type { QueryClient } from '@tanstack/react-query';

import { graphqlQueryOptions } from '../../lib/start/graphql/graphql-query-options.ts';
import { reportUnexpectedErrorInBrowser } from '../../lib/start/observability/browser-error-reporting.ts';
import { isExpectedFailure } from '../../lib/utilities/graphql/graphql-result.ts';
import {
  ClientHandleAvailabilityDocument,
  type HandleAvailability,
} from './generated/graphql.ts';

// 画面の確認は保存の可否を決めず、サーバーが保存の時に判定し直すため、確認に失敗した時は結果なしで返す。同じ値でも他の利用者の保存で変わるため、結果を保持せず毎回問い合わせる
export async function fetchHandleAvailability(
  queryClient: QueryClient,
  handle: string,
): Promise<HandleAvailability | undefined> {
  try {
    const data = await queryClient.query({
      ...graphqlQueryOptions(ClientHandleAvailabilityDocument, { handle }),
      staleTime: 0,
      gcTime: 0,
    });
    return data.handleAvailability;
  } catch (error) {
    if (!isExpectedFailure(error)) {
      reportUnexpectedErrorInBrowser(error, 'render');
    }
    return undefined;
  }
}
