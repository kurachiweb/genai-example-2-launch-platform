import { type QueryClient, queryOptions } from '@tanstack/react-query';

import type { InquiryStatus } from '../../common-lib/inquiry/inquiry-status.ts';
import { executeGraphQL } from '../../lib/start/graphql/execute-graphql.ts';
import { requireData } from '../../lib/utilities/graphql/graphql-result.ts';
import { graphqlQueryKey } from '../../lib/utilities/graphql/persisted-document.ts';
import type { MediaImageView } from '../../lib/utilities/media/picture-sources.ts';
import type { MyInquirySearch } from '../components/inquiry/my-inquiry-search.ts';
import {
  ClientInquiryContactFormDocument,
  type ClientInquiryContactFormQuery,
  ClientMyInquiriesDocument,
  type ClientMyInquiriesQuery,
  type ClientMyInquiriesQueryVariables,
  type InquiryStatus as GraphQLInquiryStatus,
} from './generated/graphql.ts';
import type { ClientViewer } from './viewer.ts';

export interface InquiryCategoryOption {
  readonly id: string;
  readonly name: string;
}

export interface InquiryComposerView {
  readonly nickname: string;
  readonly avatar: MediaImageView | null;
}

export interface InquiryContactFormView {
  readonly categories: readonly InquiryCategoryOption[];
  // 停止していないログイン中の利用者だけが持つ
  readonly composer: InquiryComposerView | null;
}

export interface MyInquiryItem {
  readonly id: string;
  readonly categoryName: string;
  readonly status: InquiryStatus;
  readonly createdAt: string;
  readonly lastMessageAt: string;
}

export interface MyInquiryPage {
  readonly items: readonly MyInquiryItem[];
  readonly nextCursor: string | null;
}

const GUEST_SCOPE = 'guest';

const INQUIRY_STATUS_OF: Readonly<Record<GraphQLInquiryStatus, InquiryStatus>> =
  Object.freeze({
    OPEN: 'open',
    IN_PROGRESS: 'in_progress',
    RESOLVED: 'resolved',
    REJECTED: 'rejected',
  });

// 送信者の値はセッションの利用者と停止の状態で変わるため、同じタブでログイン・ログアウト・停止の解除をした後に前の状態の取得結果を使わないよう、共通の取得の補助のキーの後に閲覧者のIDと状態を加える
export const inquiryContactQueryOptions = (viewer: ClientViewer | null) =>
  queryOptions({
    queryKey: [
      ...graphqlQueryKey(ClientInquiryContactFormDocument, {}),
      viewer === null ? GUEST_SCOPE : `${viewer.id}:${viewer.status}`,
    ],
    queryFn: async ({ signal }) =>
      requireData(
        await executeGraphQL(ClientInquiryContactFormDocument, {}, { signal }),
      ),
  });

// 一覧はセッションの利用者のものであるため、同じタブで別の利用者がログインした後に前の利用者の一覧を使わないよう、共通の取得の補助のキーの後に閲覧者のIDを加える
export const myInquiriesQueryOptions = (
  viewerId: string,
  after: string | undefined,
) => {
  const variables: ClientMyInquiriesQueryVariables =
    after === undefined ? {} : { after };
  return queryOptions({
    queryKey: [
      ...graphqlQueryKey(ClientMyInquiriesDocument, variables),
      viewerId,
    ],
    queryFn: async ({ signal }) =>
      requireData(
        await executeGraphQL(ClientMyInquiriesDocument, variables, { signal }),
      ),
  });
};

export const toInquiryContactFormView = ({
  inquiryCategories,
  inquiryComposer,
}: ClientInquiryContactFormQuery): InquiryContactFormView => ({
  categories: inquiryCategories.map(({ id, name }) => ({ id, name })),
  composer:
    inquiryComposer === null
      ? null
      : {
          nickname: inquiryComposer.nickname,
          avatar:
            inquiryComposer.avatar === null
              ? null
              : { ...inquiryComposer.avatar },
        },
});

export const toMyInquiryPage = ({
  myInquiries,
}: ClientMyInquiriesQuery): MyInquiryPage => ({
  items: myInquiries.items.map(
    ({ id, category, status, createdAt, lastMessageAt }) => ({
      id,
      categoryName: category.name,
      status: INQUIRY_STATUS_OF[status],
      createdAt,
      lastMessageAt,
    }),
  ),
  nextCursor: myInquiries.nextCursor,
});

// カテゴリの選択肢が無ければフォームを表示できないため、その取得の失敗はエラーの画面にする。自分の問い合わせの一覧の取得の失敗は一覧の中で再試行できるよう、例外にせずキャッシュに残す。キャッシュにあればどちらも取得し直さない
export async function loadContactPage({
  context,
  deps,
}: {
  readonly context: {
    readonly queryClient: QueryClient;
    readonly viewer: ClientViewer | null;
  };
  readonly deps: MyInquirySearch;
}): Promise<void> {
  const { queryClient, viewer } = context;
  await Promise.all([
    queryClient.query({
      ...inquiryContactQueryOptions(viewer),
      staleTime: 'static',
    }),
    viewer === null
      ? undefined
      : queryClient
          .query({
            ...myInquiriesQueryOptions(viewer.id, deps.after),
            staleTime: 'static',
          })
          .catch(() => undefined),
  ]);
}
