import {
  type InfiniteData,
  infiniteQueryOptions,
  type QueryClient,
} from '@tanstack/react-query';

import type {
  PaymentRecordKind,
  PaymentRecordStatus,
} from '../../common-lib/payments/payment-record-values.ts';
import type { PurchaseKind } from '../../common-lib/payments/purchase-kinds.ts';
import { executeGraphQL } from '../../lib/start/graphql/execute-graphql.ts';
import { requireData } from '../../lib/utilities/graphql/graphql-result.ts';
import { graphqlQueryKey } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  ClientPaymentHistoryDocument,
  type ClientPaymentHistoryQuery,
  type ClientPaymentHistoryQueryVariables,
  type PaymentRecordKind as GraphQLPaymentRecordKind,
  type PaymentRecordStatus as GraphQLPaymentRecordStatus,
  type PurchaseKind as GraphQLPurchaseKind,
} from './generated/graphql.ts';
import type { ClientViewer } from './viewer.ts';

export const PAYMENT_HISTORY_PAGE_SIZE = 20;

// 金額は最小通貨単位の整数で、返金とチャージバックの引き落としは負
export interface PaymentHistoryEntry {
  readonly id: string;
  readonly kind: PaymentRecordKind;
  readonly purpose: PurchaseKind;
  readonly amount: number;
  readonly quantity: number | null;
  readonly status: PaymentRecordStatus;
  readonly occurredAt: string;
}

export type PaymentHistoryData = InfiniteData<
  ClientPaymentHistoryQuery,
  string | null
>;

const PAYMENT_RECORD_KIND_OF: Readonly<
  Record<GraphQLPaymentRecordKind, PaymentRecordKind>
> = Object.freeze({
  ONE_TIME: 'one_time',
  SUBSCRIPTION: 'subscription',
  REFUND: 'refund',
  DISPUTE: 'dispute',
});

const PURCHASE_KIND_OF: Readonly<Record<GraphQLPurchaseKind, PurchaseKind>> =
  Object.freeze({
    WEEK_TOURNAMENT_ENTRY: 'week_tournament_entry',
    YEAR_TOURNAMENT_ENTRY: 'year_tournament_entry',
    SPONSORSHIP: 'sponsorship',
    ULTRAS: 'ultras',
    PAYMENTS_SMOKE: 'payments_smoke',
  });

const PAYMENT_RECORD_STATUS_OF: Readonly<
  Record<GraphQLPaymentRecordStatus, PaymentRecordStatus>
> = Object.freeze({
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  PENDING: 'pending',
  DISPUTED: 'disputed',
  DISPUTE_WON: 'dispute_won',
  DISPUTE_LOST: 'dispute_lost',
});

const FIRST_PAGE_VARIABLES: ClientPaymentHistoryQueryVariables = Object.freeze({
  first: PAYMENT_HISTORY_PAGE_SIZE,
});

// 決済履歴はセッションの利用者のものであるため、同じタブで別の利用者がログインした後に前の利用者の一覧を使わないよう、共通の取得の補助のキーの後に閲覧者のIDを加える。続きのページは最後の記録のカーソルから読む
export const paymentHistoryQueryOptions = (viewerId: string) =>
  infiniteQueryOptions({
    queryKey: [
      ...graphqlQueryKey(ClientPaymentHistoryDocument, FIRST_PAGE_VARIABLES),
      viewerId,
    ],
    queryFn: async ({ pageParam, signal }) =>
      requireData(
        await executeGraphQL(
          ClientPaymentHistoryDocument,
          pageParam === null
            ? FIRST_PAGE_VARIABLES
            : { ...FIRST_PAGE_VARIABLES, after: pageParam },
          { signal },
        ),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: ({
      paymentHistory: { pageInfo },
    }: ClientPaymentHistoryQuery): string | undefined =>
      pageInfo.hasNextPage && pageInfo.endCursor !== null
        ? pageInfo.endCursor
        : undefined,
  });

export const toPaymentHistoryEntries = ({
  pages,
}: PaymentHistoryData): readonly PaymentHistoryEntry[] =>
  pages.flatMap(({ paymentHistory }) =>
    paymentHistory.nodes.map(
      ({ id, kind, purpose, amount, quantity, status, occurredAt }) => ({
        id,
        kind: PAYMENT_RECORD_KIND_OF[kind],
        purpose: PURCHASE_KIND_OF[purpose],
        amount: amount.amount,
        quantity,
        status: PAYMENT_RECORD_STATUS_OF[status],
        occurredAt,
      }),
    ),
  );

// 取得の失敗は設定のナビゲーションを残したまま一覧の中で再試行できるよう、例外にせずキャッシュに残す。続きのページはここで読み足さず、画面の「さらに表示」で読む
export async function loadPaymentHistory({
  context,
}: {
  readonly context: {
    readonly queryClient: QueryClient;
    readonly viewer: ClientViewer;
  };
}): Promise<void> {
  await context.queryClient
    .infiniteQuery(paymentHistoryQueryOptions(context.viewer.id))
    .catch(() => undefined);
}
