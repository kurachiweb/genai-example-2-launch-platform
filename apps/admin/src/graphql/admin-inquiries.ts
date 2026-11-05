import { environmentManager, type QueryClient } from '@tanstack/react-query';
import { notFound } from '@tanstack/react-router';

import type {
  InquiryKind,
  InquiryStatus,
} from '../../common-lib/inquiry/inquiry-status.ts';
import type { InquiryAttachmentView } from '../../lib/components/inquiry/inquiry-attachment-list.tsx';
import { graphqlQueryOptions } from '../../lib/start/graphql/graphql-query-options.ts';
import {
  appRuntimeOf,
  type RouterContext,
} from '../../lib/start/router-context.ts';
import { resolveBrowserDisplayPreferences } from '../../lib/utilities/datetime/display-preferences.ts';
import { GraphQLClientError } from '../../lib/utilities/graphql/graphql-result.ts';
import type { MediaImageView } from '../../lib/utilities/media/picture-sources.ts';
import {
  type AdminInquirySearch,
  adminInquiryVariablesOf,
} from '../components/inquiry/admin-inquiry-search.ts';
import type { InquiryDetailActionContext } from '../composition/inquiry-detail-actions.ts';
import {
  AdminInquiriesDocument,
  type AdminInquiriesQuery,
  type AdminInquiriesQueryVariables,
  AdminInquiryCategoryOptionsDocument,
  type AdminInquiryCategoryOptionsQuery,
  AdminInquiryDocument,
  type AdminInquiryQuery,
  type InquiryKind as GraphQLInquiryKind,
  type InquiryStatus as GraphQLInquiryStatus,
} from './generated/graphql.ts';

export interface InquiryCategoryOption {
  readonly value: string;
  readonly label: string;
}

export interface AdminInquiryListEntry {
  readonly id: string;
  readonly kind: InquiryKind;
  readonly categoryName: string;
  readonly status: InquiryStatus;
  readonly senderName: string;
  readonly withdrawn: boolean;
  readonly createdAt: string;
  readonly lastMessageAt: string;
}

export interface AdminInquiryListPage {
  readonly entries: readonly AdminInquiryListEntry[];
  readonly nextCursor: string | null;
}

export type AdminInquiryMessageSender =
  | { readonly kind: 'user' }
  | {
      readonly kind: 'admin';
      readonly nickname: string;
      readonly avatar: MediaImageView | null;
    }
  | { readonly kind: 'deleted-admin' };

export interface AdminInquiryMessageView {
  readonly id: string;
  readonly sender: AdminInquiryMessageSender;
  // プレーンテキスト
  readonly body: string;
  readonly attachments: readonly InquiryAttachmentView[];
  readonly createdAt: string;
}

export interface AdminInquiryMemberView {
  readonly userId: string;
  readonly nickname: string;
  readonly handle: string;
  readonly avatar: MediaImageView | null;
}

interface AdminInquiryDetailBase {
  readonly id: string;
  readonly categoryName: string;
  readonly status: InquiryStatus;
  readonly createdAt: string;
}

export interface AdminMemberInquiryView extends AdminInquiryDetailBase {
  readonly kind: 'member';
  readonly withdrawn: boolean;
  // 送った利用者を読めなければnull
  readonly member: AdminInquiryMemberView | null;
  // 送信日時の古い順
  readonly messages: readonly AdminInquiryMessageView[];
}

export interface AdminGuestInquiryView extends AdminInquiryDetailBase {
  readonly kind: 'guest';
  readonly guest: {
    readonly nickname: string;
    readonly email: string;
    // プレーンテキスト
    readonly body: string;
  };
}

export type AdminInquiryDetailView =
  AdminMemberInquiryView | AdminGuestInquiryView;

export const INQUIRY_STATUS_OF: Readonly<
  Record<GraphQLInquiryStatus, InquiryStatus>
> = Object.freeze({
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  RESOLVED: 'resolved',
  REJECTED: 'rejected',
});

export const INQUIRY_KIND_OF: Readonly<
  Record<GraphQLInquiryKind, InquiryKind>
> = Object.freeze({ MEMBER: 'member', GUEST: 'guest' });

export const adminInquiriesQueryOptions = (
  variables: AdminInquiriesQueryVariables,
) => graphqlQueryOptions(AdminInquiriesDocument, variables);

export const adminInquiryCategoryOptionsQueryOptions = () =>
  graphqlQueryOptions(AdminInquiryCategoryOptionsDocument, {});

export const adminInquiryQueryOptions = (id: string) =>
  graphqlQueryOptions(AdminInquiryDocument, { id });

export const toAdminInquiryListPage = ({
  adminInquiries,
}: AdminInquiriesQuery): AdminInquiryListPage => ({
  entries: adminInquiries.entries.map((entry) => ({
    id: entry.id,
    kind: INQUIRY_KIND_OF[entry.kind],
    categoryName: entry.category.name,
    status: INQUIRY_STATUS_OF[entry.status],
    senderName: entry.senderName,
    withdrawn: entry.withdrawn,
    createdAt: entry.createdAt,
    lastMessageAt: entry.lastMessageAt,
  })),
  nextCursor: adminInquiries.nextCursor,
});

export const toInquiryCategoryOptions = ({
  adminInquiryCategories,
}: AdminInquiryCategoryOptionsQuery): readonly InquiryCategoryOption[] =>
  adminInquiryCategories.map(({ id, name }) => ({ value: id, label: name }));

type Detail = NonNullable<AdminInquiryQuery['adminInquiry']>;

type MessageResult = Detail['messages'][number];

const senderOf = ({
  sender,
  admin,
}: MessageResult): AdminInquiryMessageSender => {
  if (sender === 'USER') {
    return { kind: 'user' };
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

const toMessage = (message: MessageResult): AdminInquiryMessageView => ({
  id: message.id,
  sender: senderOf(message),
  body: message.body,
  attachments: message.attachments.map(
    ({ id, originalFileName, contentType, byteSize }) => ({
      id,
      originalFileName,
      contentType,
      byteSize,
    }),
  ),
  createdAt: message.createdAt,
});

const toMember = (member: Detail['member']): AdminInquiryMemberView | null =>
  member === null
    ? null
    : {
        userId: member.userId,
        nickname: member.nickname,
        handle: member.handle,
        avatar: member.avatar === null ? null : { ...member.avatar },
      };

// 未ログインの問い合わせのメッセージは本文の1件だけのため、詳細には本文として持たせ、メッセージの一覧を作らない
export const toAdminInquiryDetail = ({
  adminInquiry: detail,
}: AdminInquiryQuery): AdminInquiryDetailView | undefined => {
  if (detail === null) {
    return undefined;
  }
  const base: AdminInquiryDetailBase = {
    id: detail.id,
    categoryName: detail.category.name,
    status: INQUIRY_STATUS_OF[detail.status],
    createdAt: detail.createdAt,
  };
  if (detail.kind === 'GUEST' && detail.guest !== null) {
    return {
      kind: 'guest',
      ...base,
      guest: {
        nickname: detail.guest.nickname,
        email: detail.guest.email,
        body: detail.guest.body,
      },
    };
  }
  return {
    kind: 'member',
    ...base,
    withdrawn: detail.withdrawn,
    member: toMember(detail.member),
    messages: detail.messages.map(toMessage),
  };
};

export const inquiryDetailActionContextOf = (
  detail: AdminInquiryDetailView,
): InquiryDetailActionContext =>
  detail.kind === 'member'
    ? {
        inquiryId: detail.id,
        kind: 'member',
        userId: detail.member?.userId ?? null,
        withdrawn: detail.withdrawn,
        contactEmail: null,
      }
    : {
        inquiryId: detail.id,
        kind: 'guest',
        userId: null,
        withdrawn: false,
        contactEmail: detail.guest.email,
      };

type InquiriesPageContext = Pick<RouterContext, 'queryClient' | 'runtime'>;

// 部品は日時の表示と同じ地域の暦(描画中とハイドレーションはサーバーの表示設定、その後はブラウザの地域)で期間を決めるため、先に取得するキーも同じ地域で作る
const periodTimeZoneOf = (context: InquiriesPageContext): string =>
  environmentManager.isServer()
    ? appRuntimeOf(context).display.timeZone
    : resolveBrowserDisplayPreferences().timeZone;

// カテゴリの選択肢が無ければ絞り込めないため、その取得の失敗はルートのエラーの画面に任せる。一覧の取得の失敗は一覧の中で再試行できるよう、例外にせずキャッシュに残す
export async function loadAdminInquiriesPage({
  context,
  deps,
}: {
  readonly context: InquiriesPageContext;
  readonly deps: AdminInquirySearch;
}): Promise<void> {
  await Promise.all([
    context.queryClient.query(adminInquiryCategoryOptionsQueryOptions()),
    context.queryClient
      .query(
        adminInquiriesQueryOptions(
          adminInquiryVariablesOf(deps, periodTimeZoneOf(context)),
        ),
      )
      .catch(() => undefined),
  ]);
}

const VALIDATION_ERROR = 'validation_error';

const INQUIRY_ID_FIELD = 'id';

// APIサーバーはIDの上限を超える形式の違反をnullではなく入力の検証の失敗で返すため、不在と同じ見つからない表示にする
const isMalformedInquiryId = (error: unknown): boolean =>
  error instanceof GraphQLClientError &&
  error.code === VALIDATION_ERROR &&
  (error.details ?? []).some(({ field }) => field === INQUIRY_ID_FIELD);

// 詳細が無ければページを表示できないため、取得の失敗はルートのエラーの画面に任せる。部品は表示した時点では取り直さず定期再取得に任せるため、別のページから戻った時も最新を示すよう、キャッシュの鮮度によらず毎回取得する
export async function loadAdminInquiryPage({
  context,
  params,
}: {
  readonly context: { readonly queryClient: QueryClient };
  readonly params: { readonly inquiryId: string };
}): Promise<void> {
  const data = await context.queryClient
    .query({ ...adminInquiryQueryOptions(params.inquiryId), staleTime: 0 })
    .catch((error: unknown) => {
      if (isMalformedInquiryId(error)) {
        throw notFound();
      }
      throw error;
    });
  if (data.adminInquiry === null) {
    throw notFound();
  }
}
