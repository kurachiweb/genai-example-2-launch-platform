import type { InquiryStatus } from '../../../common-lib/inquiry/inquiry-status.ts';

export const INQUIRY_EXPORT_PAGE_SIZE = 20;

export interface InquiryExportAttachment {
  // fileIdとoriginalFileNameはデータエクスポートが実体の読み出しとZIP内のパスの組み立てに使い、JSONには書かない
  readonly fileId: string;
  readonly originalFileName: string;
  readonly contentType: string;
  readonly size: number;
}

export interface InquiryExportMessage {
  readonly id: string;
  readonly sender: 'user' | 'admin';
  // 削除済みの管理者の返信と利用者のメッセージはnull
  readonly adminNickname: string | null;
  readonly body: string;
  // 紐付けの位置の順。管理者の返信は常に空
  readonly attachments: readonly InquiryExportAttachment[];
  readonly createdAt: string;
}

export interface InquiryExportItem {
  readonly id: string;
  // 削除されたカテゴリの問い合わせは付け替え先の「その他」になる
  readonly category: string;
  readonly status: InquiryStatus;
  readonly createdAt: string;
  // 送信日時の古い順
  readonly messages: readonly InquiryExportMessage[];
}

export interface InquiryExportPage {
  readonly items: readonly InquiryExportItem[];
  // 次の呼び出しのafter。最後のページはnull
  readonly nextCursor: string | null;
}

export interface InquiryExport {
  // 論理削除されていない本人のログインの問い合わせを、IDの昇順にINQUIRY_EXPORT_PAGE_SIZE件ずつ返す。日時はミリ秒までのUTCのISO 8601
  listPage(
    userId: string,
    after: string | undefined,
  ): Promise<InquiryExportPage>;
}
