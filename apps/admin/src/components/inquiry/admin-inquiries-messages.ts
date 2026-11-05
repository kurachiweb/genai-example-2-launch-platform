import type { InquiryKind } from '../../../common-lib/inquiry/inquiry-status.ts';

export const INQUIRIES_TITLE = '問い合わせ';

export const INQUIRIES_DESCRIPTION =
  'ログインと未ログインの問い合わせを、受付日時の新しい順に表示します。';

export const INQUIRY_LIST_CAPTION = '問い合わせの一覧';

export const INQUIRY_LIST_EMPTY_MESSAGE =
  '条件に一致する問い合わせはありません。';

export const INQUIRY_LIST_COLUMNS = Object.freeze({
  createdAt: '受付日時',
  kind: '種別',
  category: 'カテゴリ',
  status: '対応ステータス',
  sender: '送信者',
  lastMessageAt: '最後のメッセージ',
});

export const INQUIRY_KIND_LABELS: Readonly<Record<InquiryKind, string>> =
  Object.freeze({
    member: 'ログイン',
    guest: '未ログイン',
  });

export const WITHDRAWN_LABEL = '退会済み';

export const STATUS_FILTER_LABEL = '対応ステータス';

export const ALL_STATUSES_LABEL = 'すべてのステータス';

export const KIND_FILTER_LABEL = '種別';

export const ALL_KINDS_LABEL = 'すべての種別';

export const CATEGORY_FILTER_LABEL = 'カテゴリ';

export const ALL_CATEGORIES_LABEL = 'すべてのカテゴリ';

export const RECEIVED_FROM_FILTER_LABEL = '受付日の開始日';

export const RECEIVED_TO_FILTER_LABEL = '受付日の終了日';

export const INQUIRY_DETAIL_TITLE = '問い合わせの詳細';

export const KIND_LABEL = '種別';

export const SENDER_LABEL = '送信者';

export const CATEGORY_LABEL = 'カテゴリ';

export const STATUS_LABEL = '対応ステータス';

export const RECEIVED_AT_LABEL = '受付日時';

export const GUEST_NICKNAME_LABEL = 'ニックネーム';

export const CONTACT_EMAIL_LABEL = '連絡先メールアドレス';

export const GUEST_BODY_LABEL = 'メッセージ';

export const INQUIRY_MESSAGES_TITLE = 'メッセージ';

export const DELETED_ADMIN_LABEL = '削除済みの管理者';

export const UNREADABLE_MEMBER_LABEL = '表示できない利用者';

export const GUEST_REPLY_NOTICE =
  'この問い合わせへの回答は、連絡先メールアドレスへシステム外のメールで行ってください。';

export const handleLabel = (handle: string): string => `@${handle}`;
