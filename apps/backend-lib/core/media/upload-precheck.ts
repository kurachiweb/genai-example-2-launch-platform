import type { UploadErrorCode } from '../../../common-lib/media/media-error-codes.ts';
import {
  MEDIA_TYPE_LABELS,
  type MediaType,
  parseMediaType,
} from '../../../common-lib/media/media-types.ts';
import type { AppErrorKind } from '../errors/app-error.ts';
import type { MediaStorage, UploadPurpose } from './upload-purpose.ts';

export interface UploadRejection {
  readonly kind: Extract<
    AppErrorKind,
    | 'bad_request'
    | 'unauthenticated'
    | 'forbidden'
    | 'not_found'
    | 'length_required'
    | 'payload_too_large'
    | 'unsupported_media_type'
    | 'unprocessable'
    | 'unavailable'
  >;
  readonly code: UploadErrorCode;
  readonly message: string;
  readonly retryAfterSeconds?: number;
}

export type PrecheckResult =
  | {
      readonly ok: true;
      readonly declaredLength: number;
      readonly mediaType: MediaType;
    }
  | { readonly ok: false; readonly rejection: UploadRejection };

export interface UploadRequestHeaders {
  readonly contentLength: string | null;
  readonly contentType: string | null;
}

// Content-Lengthの文法は1*DIGITのため、符号・小数・空白・複数の値の結合を数値として扱わない
const CONTENT_LENGTH_PATTERN = /^[0-9]+$/u;

export const UPLOAD_RESEND_MESSAGE =
  'ファイルを送信できませんでした。もう一度お試しください。';

const BYTES_PER_KB = 1024;

const BYTES_PER_MB = 1024 * 1024;

const SUBJECT_BY_STORAGE: Readonly<Record<MediaStorage, string>> =
  Object.freeze({
    images: '画像',
    files: 'ファイル',
  });

const reject = (rejection: UploadRejection): PrecheckResult =>
  Object.freeze({ ok: false, rejection: Object.freeze(rejection) });

// 文言規則の容量の単位(1,024を基数とするkB・MB)で割り切れる上限だけを単位付きで表す
const formatByteLimit = (bytes: number): string => {
  if (bytes % BYTES_PER_MB === 0) {
    return `${String(bytes / BYTES_PER_MB)}MB`;
  }
  if (bytes % BYTES_PER_KB === 0) {
    return `${String(bytes / BYTES_PER_KB)}kB`;
  }
  return `${bytes.toLocaleString('ja-JP')}バイト`;
};

const tooLargeMessage = (purpose: UploadPurpose): string =>
  `${formatByteLimit(purpose.maxBytes)}以内の${SUBJECT_BY_STORAGE[purpose.storage]}を選択してください。`;

const unsupportedTypeMessage = (purpose: UploadPurpose): string =>
  `${purpose.allowedTypes.map((type) => MEDIA_TYPE_LABELS[type]).join('・')}の${SUBJECT_BY_STORAGE[purpose.storage]}を選択してください。`;

export function precheckUpload(
  purpose: UploadPurpose,
  headers: UploadRequestHeaders,
): PrecheckResult {
  if (headers.contentLength === null) {
    return reject({
      kind: 'length_required',
      code: 'content_length_required',
      message: UPLOAD_RESEND_MESSAGE,
    });
  }
  const declaredLength = CONTENT_LENGTH_PATTERN.test(headers.contentLength)
    ? Number(headers.contentLength)
    : 0;
  if (declaredLength < 1) {
    return reject({
      kind: 'bad_request',
      code: 'invalid_content_length',
      message: UPLOAD_RESEND_MESSAGE,
    });
  }
  if (declaredLength > purpose.maxBytes) {
    return reject({
      kind: 'payload_too_large',
      code: 'file_too_large',
      message: tooLargeMessage(purpose),
    });
  }
  const mediaType = parseMediaType(headers.contentType);
  if (mediaType === undefined || !purpose.allowedTypes.includes(mediaType)) {
    return reject({
      kind: 'unsupported_media_type',
      code: 'unsupported_file_type',
      message: unsupportedTypeMessage(purpose),
    });
  }
  return Object.freeze({ ok: true, declaredLength, mediaType });
}
