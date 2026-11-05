import { type QueryClient, queryOptions } from '@tanstack/react-query';

import { executeGraphQL } from '../../lib/start/graphql/execute-graphql.ts';
import { requireData } from '../../lib/utilities/graphql/graphql-result.ts';
import { graphqlQueryKey } from '../../lib/utilities/graphql/persisted-document.ts';
import type { MediaImageView } from '../../lib/utilities/media/picture-sources.ts';
import {
  ClientInquiryContactFormDocument,
  type ClientInquiryContactFormQuery,
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

const GUEST_SCOPE = 'guest';

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

// カテゴリの選択肢が無ければフォームを表示できないため、取得の失敗はエラーの画面にする。キャッシュにあれば取得し直さない
export async function loadContactPage({
  context,
}: {
  readonly context: {
    readonly queryClient: QueryClient;
    readonly viewer: ClientViewer | null;
  };
}): Promise<void> {
  await context.queryClient.query({
    ...inquiryContactQueryOptions(context.viewer),
    staleTime: 'static',
  });
}
