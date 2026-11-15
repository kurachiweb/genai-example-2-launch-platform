import type { FieldErrorDetail } from '../../../lib/utilities/graphql/graphql-result.ts';

export const INQUIRY_FILE_IDS_FIELD = 'fileIds';

const ATTACHMENT_POSITION_PREFIX = `${INQUIRY_FILE_IDS_FIELD}.`;

export const NO_INVALID_FILE_IDS: ReadonlySet<string> = new Set();

export interface InquiryAttachmentErrors {
  // サーバーが添付できないと返したファイル
  readonly invalidFileIds: ReadonlySet<string>;
  // 添付の欄に示す最初の文言。添付の位置の詳細が無ければundefined
  readonly message: string | undefined;
  // 添付の位置の詳細を除いた、欄に対応しない詳細
  readonly others: readonly FieldErrorDetail[];
}

// 添付の無効なファイルの詳細は位置ごとの経路で届き、位置ごとの入力欄は無いため、送った値のその位置のファイルを取り出して添付の欄でまとめて示せるようにする
export const inquiryAttachmentErrorsOf = (
  unmatched: readonly FieldErrorDetail[],
  sentFileIds: readonly string[],
): InquiryAttachmentErrors => {
  const attachmentDetails = unmatched.filter(({ field }) =>
    field.startsWith(ATTACHMENT_POSITION_PREFIX),
  );
  return {
    invalidFileIds: new Set(
      attachmentDetails.flatMap(({ field }) => {
        const fileId =
          sentFileIds[Number(field.slice(ATTACHMENT_POSITION_PREFIX.length))];
        return fileId === undefined ? [] : [fileId];
      }),
    ),
    message: attachmentDetails[0]?.message,
    others: unmatched.filter(
      ({ field }) => !field.startsWith(ATTACHMENT_POSITION_PREFIX),
    ),
  };
};
