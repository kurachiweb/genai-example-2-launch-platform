import type { UploadErrorCode } from '../../../common-lib/media/media-error-codes.ts';
import {
  isImageMediaType,
  MEDIA_TYPE_LABELS,
} from '../../../common-lib/media/media-types.ts';
import { formatFileSize } from './file-size-label.ts';
import type {
  SelectionViolation,
  UploadConstraints,
} from './upload-constraints.ts';

export interface UploadRejection {
  readonly message: string;
  readonly retryable: boolean;
}

// 中継の415は全用途の許可形式の範囲での拒否で、利用者にとってはAPIの用途ごとの形式の拒否と同じ意味のため同じ文言にする
type RejectionCode =
  | Exclude<UploadErrorCode, 'upload_purpose_not_found' | 'storage_unavailable'>
  | 'unsupported_media_type';

export const UPLOAD_UNAVAILABLE_MESSAGE =
  '現在ご利用いただけません。しばらく待ってから再度お試しください。';

export const UPLOAD_RATE_LIMITED_MESSAGE =
  '操作が集中しています。しばらく待ってから再度お試しください。';

export const UPLOAD_NETWORK_ERROR_MESSAGE =
  '通信に失敗しました。時間をおいて再度お試しください。';

const SEND_FAILED_MESSAGE =
  'ファイルを送信できませんでした。もう一度お試しください。';

const UNREADABLE_FILE_MESSAGE =
  'ファイルを読み込めませんでした。ファイルが壊れていないか確認して、もう一度選択してください。';

const countFormatter = new Intl.NumberFormat('ja-JP');

const acceptsOnlyImages = (constraints: UploadConstraints): boolean =>
  constraints.allowedTypes.every(isImageMediaType);

const fileNounOf = (constraints: UploadConstraints): string =>
  acceptsOnlyImages(constraints) ? '画像' : 'ファイル';

const fileTypeMessage = (constraints: UploadConstraints): string =>
  `${constraints.allowedTypes.map((type) => MEDIA_TYPE_LABELS[type]).join('・')}の${fileNounOf(constraints)}を選択してください。`;

const fileTooLargeMessage = (constraints: UploadConstraints): string =>
  `${constraints.subjectLabel}は${formatFileSize(constraints.maxBytes)}以内の${fileNounOf(constraints)}を選択してください。`;

const requireLimit = (limit: number | undefined, name: string): number => {
  if (limit === undefined) {
    throw new RangeError(`上限(${name})の無い用途に違反は起きません。`);
  }
  return limit;
};

const countMessage = (constraints: UploadConstraints): string => {
  const limit = countFormatter.format(
    requireLimit(constraints.maxCount, 'maxCount'),
  );
  return acceptsOnlyImages(constraints)
    ? `画像は${limit}枚以内で選択してください。`
    : `ファイルは${limit}個以内で選択してください。`;
};

const totalMessage = (constraints: UploadConstraints): string =>
  `ファイルは合計${formatFileSize(requireLimit(constraints.maxTotalBytes, 'maxTotalBytes'))}以内で選択してください。`;

export const selectionViolationMessage = (
  violation: SelectionViolation,
  constraints: UploadConstraints,
): string => {
  switch (violation.kind) {
    case 'type': {
      return fileTypeMessage(constraints);
    }
    case 'size': {
      return fileTooLargeMessage(constraints);
    }
    case 'count': {
      return countMessage(constraints);
    }
    case 'total': {
      return totalMessage(constraints);
    }
  }
};

export const croppedFileTooLargeMessage = (
  constraints: UploadConstraints,
): string =>
  `編集後の画像が${formatFileSize(constraints.maxBytes)}を超えました。切り取る範囲を狭めるか、別の画像を選択してください。`;

const reselect = (message: string): UploadRejection => ({
  message,
  retryable: false,
});

const resend: UploadRejection = {
  message: SEND_FAILED_MESSAGE,
  retryable: true,
};

const unreadable = reselect(UNREADABLE_FILE_MESSAGE);

const REJECTIONS: Readonly<
  Record<RejectionCode, (constraints: UploadConstraints) => UploadRejection>
> = Object.freeze({
  unauthenticated: () =>
    reselect('ログインし直してから、もう一度お試しください。'),
  upload_forbidden: () => reselect('この操作はできません。'),
  account_unavailable: () =>
    reselect(
      'このアカウントは現在ご利用いただけません。詳しくはお問い合わせください。',
    ),
  email_not_verified: () =>
    reselect(
      'この操作にはメールアドレスの確認が必要です。確認メールをご確認ください。',
    ),
  content_length_required: () => resend,
  invalid_content_length: () => resend,
  content_length_mismatch: () => resend,
  file_too_large: (constraints) => reselect(fileTooLargeMessage(constraints)),
  unsupported_file_type: (constraints) =>
    reselect(fileTypeMessage(constraints)),
  unsupported_media_type: (constraints) =>
    reselect(fileTypeMessage(constraints)),
  file_type_mismatch: () => unreadable,
  invalid_svg: () => unreadable,
  invalid_text_file: () => unreadable,
  image_unreadable: () => unreadable,
  svg_declaration_not_allowed: () =>
    reselect(
      'このSVGは読み込めません。編集ソフトでSVGとして書き出し直してから選択してください。',
    ),
  image_dimensions_exceeded: () =>
    reselect(
      '画像の縦横の大きさが上限を超えています。小さくしてから選択してください。',
    ),
});

const isRejectionCode = (code: string): code is RejectionCode =>
  Object.hasOwn(REJECTIONS, code);

// エラーの表で選び直し・送り直しの拒否に当たらないコードは対応を返さず、呼び出し元が想定外の応答として扱う
export const rejectionOf = (
  code: string,
  constraints: UploadConstraints,
): UploadRejection | undefined =>
  isRejectionCode(code) ? REJECTIONS[code](constraints) : undefined;
