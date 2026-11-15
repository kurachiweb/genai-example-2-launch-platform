import type {
  InquiryKind,
  InquiryStatus,
} from '../../../../../common-lib/inquiry/inquiry-status.ts';
import type { AdminProfileView } from '../../../../../lib/core/admin/ports.ts';
import type {
  AdminInquiryView,
  AdminMemberInquiryView,
} from '../../../../application/inquiry/inquiry-admin-service.ts';
import type { AdminInquiryCategoryView } from '../../../../application/inquiry/inquiry-category-service.ts';
import type { MemberInquiryView } from '../../../../application/inquiry/inquiry-chat-service.ts';
import type { InquiryReplyResult } from '../../../../application/inquiry/inquiry-reply-service.ts';
import type {
  AdminInquiryPage,
  AdminInquirySummary,
  InquirerProfile,
  InquiryCategoryRecord,
  InquiryMessageRecord,
  MemberInquiryPage,
  MemberInquiryRecord,
} from '../../../../application/inquiry/ports.ts';

export type InquiryStatusValue =
  'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'REJECTED';

export type InquiryKindValue = 'MEMBER' | 'GUEST';

export type InquirySenderValue = 'USER' | 'ADMIN';

export const INQUIRY_STATUS_VALUES: Readonly<
  Record<InquiryStatus, InquiryStatusValue>
> = Object.freeze({
  open: 'OPEN',
  in_progress: 'IN_PROGRESS',
  resolved: 'RESOLVED',
  rejected: 'REJECTED',
});

const INQUIRY_STATUSES_BY_VALUE: Readonly<
  Record<InquiryStatusValue, InquiryStatus>
> = Object.freeze({
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  RESOLVED: 'resolved',
  REJECTED: 'rejected',
});

export const INQUIRY_KIND_VALUES: Readonly<
  Record<InquiryKind, InquiryKindValue>
> = Object.freeze({ member: 'MEMBER', guest: 'GUEST' });

const INQUIRY_KINDS_BY_VALUE: Readonly<Record<InquiryKindValue, InquiryKind>> =
  Object.freeze({ MEMBER: 'member', GUEST: 'guest' });

const INQUIRY_SENDER_VALUES: Readonly<
  Record<InquiryMessageRecord['sender'], InquirySenderValue>
> = Object.freeze({ user: 'USER', admin: 'ADMIN' });

export const inquiryStatusOf = (value: InquiryStatusValue): InquiryStatus =>
  INQUIRY_STATUSES_BY_VALUE[value];

export const inquiryKindOf = (value: InquiryKindValue): InquiryKind =>
  INQUIRY_KINDS_BY_VALUE[value];

export interface InquiryCategoryModel {
  readonly id: string;
  readonly name: string;
  readonly systemDefault: boolean;
}

export interface AdminInquiryCategoryModel extends InquiryCategoryModel {
  readonly linkedCount: number;
}

// 添付・返信した管理者・プロフィール画像は項目のリゾルバが一括読み込みで引くため、IDだけを持たせる
export interface InquiryMessageModel {
  readonly id: string;
  readonly sender: InquirySenderValue;
  readonly body: string;
  readonly fileIds: readonly string[];
  readonly adminId: string | null;
  readonly createdAt: Date;
}

export interface InquiryReplyAuthorModel {
  readonly nickname: string | null;
  readonly avatarFileId: string | null;
  readonly deleted: boolean;
}

export interface InquiryComposerModel {
  readonly nickname: string;
  readonly avatarFileId: string | null;
}

// カテゴリは項目のリゾルバが一括読み込みで引くため、IDだけを持たせる
export interface MemberInquirySummaryModel {
  readonly id: string;
  readonly categoryId: string;
  readonly status: InquiryStatusValue;
  readonly createdAt: Date;
  readonly lastMessageAt: Date;
}

// 生成したリゾルバの型のリストは読み取り専用の配列を受け付けないため、配列は写して渡す
export interface MemberInquiryModel extends MemberInquirySummaryModel {
  readonly messages: InquiryMessageModel[];
  readonly canPost: boolean;
}

export interface MemberInquiryPageModel {
  readonly items: MemberInquirySummaryModel[];
  readonly nextCursor: string | null;
}

export interface AdminInquirySummaryModel extends MemberInquirySummaryModel {
  readonly kind: InquiryKindValue;
  readonly senderName: string;
  readonly withdrawn: boolean;
}

export interface AdminInquiryPageModel {
  readonly entries: AdminInquirySummaryModel[];
  readonly nextCursor: string | null;
}

export interface AdminInquiryMemberModel {
  readonly userId: string;
  readonly nickname: string;
  readonly handle: string;
  readonly avatarFileId: string | null;
}

export interface AdminInquiryGuestModel {
  readonly nickname: string;
  readonly email: string;
  readonly body: string;
}

export interface AdminInquiryModel extends MemberInquirySummaryModel {
  readonly kind: InquiryKindValue;
  readonly statusChangedAt: Date;
  readonly withdrawn: boolean;
  readonly member: AdminInquiryMemberModel | null;
  readonly guest: AdminInquiryGuestModel | null;
  readonly messages: InquiryMessageModel[];
}

export interface InquiryReplyResultModel {
  readonly message: InquiryMessageModel;
  readonly notificationQueued: boolean;
}

export const toInquiryCategory = (
  category: InquiryCategoryRecord,
): InquiryCategoryModel => ({
  id: category.id,
  name: category.name,
  systemDefault: category.systemDefault,
});

export const toAdminInquiryCategory = (
  category: AdminInquiryCategoryView,
): AdminInquiryCategoryModel => ({
  ...toInquiryCategory(category),
  linkedCount: category.linkedCount,
});

export const toInquiryMessage = (
  message: InquiryMessageRecord,
): InquiryMessageModel => ({
  id: message.id,
  sender: INQUIRY_SENDER_VALUES[message.sender],
  body: message.body,
  fileIds: message.fileIds,
  adminId: message.adminId,
  createdAt: message.createdAt,
});

// 照会口が返さない管理者は、削除済みの管理者として表示する
export const toInquiryReplyAuthor = (
  profile: AdminProfileView | undefined,
): InquiryReplyAuthorModel =>
  profile === undefined
    ? { nickname: null, avatarFileId: null, deleted: true }
    : {
        nickname: profile.nickname,
        avatarFileId: profile.avatarFileId,
        deleted: false,
      };

export const toInquiryComposer = (
  profile: Pick<InquirerProfile, 'nickname' | 'avatarFileId'>,
): InquiryComposerModel => ({
  nickname: profile.nickname,
  avatarFileId: profile.avatarFileId,
});

export const toMemberInquirySummary = (
  inquiry: MemberInquiryRecord,
): MemberInquirySummaryModel => ({
  id: inquiry.id,
  categoryId: inquiry.categoryId,
  status: INQUIRY_STATUS_VALUES[inquiry.status],
  createdAt: inquiry.createdAt,
  lastMessageAt: inquiry.lastMessageAt,
});

export const toMemberInquiry = (
  view: MemberInquiryView,
): MemberInquiryModel => ({
  ...toMemberInquirySummary(view.inquiry),
  messages: view.messages.map(toInquiryMessage),
  canPost: view.canPost,
});

export const toMemberInquiryPage = (
  page: MemberInquiryPage,
): MemberInquiryPageModel => ({
  items: page.items.map(toMemberInquirySummary),
  nextCursor: page.nextCursor,
});

export const toAdminInquirySummary = (
  summary: AdminInquirySummary,
): AdminInquirySummaryModel => ({
  id: summary.id,
  kind: INQUIRY_KIND_VALUES[summary.kind],
  categoryId: summary.categoryId,
  status: INQUIRY_STATUS_VALUES[summary.status],
  senderName: summary.senderName,
  withdrawn: summary.withdrawn,
  createdAt: summary.createdAt,
  lastMessageAt: summary.lastMessageAt,
});

export const toAdminInquiryPage = (
  page: AdminInquiryPage,
): AdminInquiryPageModel => ({
  entries: page.items.map(toAdminInquirySummary),
  nextCursor: page.nextCursor,
});

const toAdminInquiryMember = (
  profile: InquirerProfile | undefined,
): AdminInquiryMemberModel | null =>
  profile === undefined
    ? null
    : {
        userId: profile.userId,
        nickname: profile.nickname,
        handle: profile.handle,
        avatarFileId: profile.avatarFileId,
      };

const toAdminMemberInquiry = (
  view: AdminMemberInquiryView,
): AdminInquiryModel => ({
  ...toMemberInquirySummary(view.inquiry),
  kind: 'MEMBER',
  statusChangedAt: view.inquiry.statusChangedAt,
  withdrawn: view.withdrawn,
  member: toAdminInquiryMember(view.member),
  guest: null,
  messages: view.messages.map(toInquiryMessage),
});

// 未ログインの問い合わせは本文を1件だけ持ち、メッセージの表を使わないため、受付時の利用者のメッセージとして本文を返す
export const toAdminInquiry = (view: AdminInquiryView): AdminInquiryModel => {
  if (view.kind === 'member') {
    return toAdminMemberInquiry(view);
  }
  const { inquiry } = view;
  return {
    id: inquiry.id,
    kind: 'GUEST',
    categoryId: inquiry.categoryId,
    status: INQUIRY_STATUS_VALUES[inquiry.status],
    statusChangedAt: inquiry.statusChangedAt,
    withdrawn: false,
    createdAt: inquiry.createdAt,
    lastMessageAt: inquiry.createdAt,
    member: null,
    guest: {
      nickname: inquiry.nickname,
      email: inquiry.email,
      body: inquiry.body,
    },
    messages: [
      {
        id: inquiry.id,
        sender: 'USER',
        body: inquiry.body,
        fileIds: [],
        adminId: null,
        createdAt: inquiry.createdAt,
      },
    ],
  };
};

export const toInquiryReplyResult = (
  result: InquiryReplyResult,
): InquiryReplyResultModel => ({
  message: toInquiryMessage(result.message),
  notificationQueued: result.notificationQueued,
});
