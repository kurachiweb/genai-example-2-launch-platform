import { type QueryClient, queryOptions } from '@tanstack/react-query';
import { notFound } from '@tanstack/react-router';

import type { InquiryStatus } from '../../common-lib/inquiry/inquiry-status.ts';
import type { InquiryAttachmentView } from '../../lib/components/inquiry/inquiry-attachment-list.tsx';
import { executeGraphQL } from '../../lib/start/graphql/execute-graphql.ts';
import {
  GraphQLClientError,
  requireData,
} from '../../lib/utilities/graphql/graphql-result.ts';
import { graphqlQueryKey } from '../../lib/utilities/graphql/persisted-document.ts';
import type { MediaImageView } from '../../lib/utilities/media/picture-sources.ts';
import {
  ClientMemberInquiryDocument,
  type ClientMemberInquiryQuery,
} from './generated/graphql.ts';
import { INQUIRY_STATUS_OF } from './inquiry-contact.ts';
import type { ClientViewer } from './viewer.ts';

export type InquiryChatSender =
  | { readonly kind: 'self' }
  | {
      readonly kind: 'admin';
      readonly nickname: string;
      readonly avatar: MediaImageView | null;
    }
  | { readonly kind: 'deleted-admin' };

export interface InquiryChatMessage {
  readonly id: string;
  readonly sender: InquiryChatSender;
  // プレーンテキスト
  readonly body: string;
  readonly attachments: readonly InquiryAttachmentView[];
  readonly createdAt: string;
}

export interface InquiryChat {
  readonly id: string;
  readonly categoryName: string;
  readonly status: InquiryStatus;
  readonly createdAt: string;
  // 送信日時の古い順
  readonly messages: readonly InquiryChatMessage[];
  // 停止中の利用者では偽
  readonly canPost: boolean;
}

type MessageResult = NonNullable<
  ClientMemberInquiryQuery['memberInquiry']
>['messages'][number];

const senderOf = ({ sender, admin }: MessageResult): InquiryChatSender => {
  if (sender === 'USER') {
    return { kind: 'self' };
  }
  if (admin === null || admin.deleted || admin.nickname === null) {
    return { kind: 'deleted-admin' };
  }
  return {
    kind: 'admin',
    nickname: admin.nickname,
    avatar: admin.avatar === null ? null : { ...admin.avatar },
  };
};

// チャットはセッションの利用者のもので、送信できるかは利用者の停止の状態で変わるため、同じタブで別の利用者のログインや停止の解除をした後に前の取得結果を使わないよう、共通の取得の補助のキーの後に閲覧者のIDと状態を加える
export const memberInquiryQueryOptions = (
  viewer: ClientViewer,
  inquiryId: string,
) => {
  const variables = { id: inquiryId };
  return queryOptions({
    queryKey: [
      ...graphqlQueryKey(ClientMemberInquiryDocument, variables),
      `${viewer.id}:${viewer.status}`,
    ],
    queryFn: async ({ signal }) =>
      requireData(
        await executeGraphQL(ClientMemberInquiryDocument, variables, {
          signal,
        }),
      ),
  });
};

export const toInquiryChat = ({
  memberInquiry,
}: ClientMemberInquiryQuery): InquiryChat | undefined =>
  memberInquiry === null
    ? undefined
    : {
        id: memberInquiry.id,
        categoryName: memberInquiry.category.name,
        status: INQUIRY_STATUS_OF[memberInquiry.status],
        createdAt: memberInquiry.createdAt,
        canPost: memberInquiry.canPost,
        messages: memberInquiry.messages.map((message) => ({
          id: message.id,
          sender: senderOf(message),
          body: message.body,
          createdAt: message.createdAt,
          attachments: message.attachments.map(
            ({ id, originalFileName, contentType, byteSize }) => ({
              id,
              originalFileName,
              contentType,
              byteSize,
            }),
          ),
        })),
      };

const VALIDATION_ERROR = 'validation_error';

const INQUIRY_ID_FIELD = 'id';

// APIサーバーはIDの上限を超える形式の違反をnullではなく入力の検証の失敗で返すため、他人・不在と同じ見つからない表示にして、形式で存在の有無を区別させない
const isMalformedInquiryId = (error: unknown): boolean =>
  error instanceof GraphQLClientError &&
  error.code === VALIDATION_ERROR &&
  (error.details ?? []).some(({ field }) => field === INQUIRY_ID_FIELD);

// チャットが無ければページを表示できないため、取得の失敗はエラーの画面にする。部品は表示した時点では取り直さず定期再取得に任せるため、別のページから戻った時も最新を示すよう、loaderはキャッシュの鮮度によらず毎回取得する。本人の問い合わせでなければ、存在を明かさずに見つからない旨を示す
export async function loadInquiryChatPage({
  context,
  params,
}: {
  readonly context: {
    readonly queryClient: QueryClient;
    readonly viewer: ClientViewer;
  };
  readonly params: { readonly inquiryId: string };
}): Promise<void> {
  const data = await context.queryClient
    .query({
      ...memberInquiryQueryOptions(context.viewer, params.inquiryId),
      staleTime: 0,
    })
    .catch((error: unknown) => {
      if (isMalformedInquiryId(error)) {
        throw notFound();
      }
      throw error;
    });
  if (data.memberInquiry === null) {
    throw notFound();
  }
}
