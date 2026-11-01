import type { MediaType } from './media-types.ts';

export const UPLOAD_RELAY_PREFIX = '/_bff/uploads/';

export const FILE_RELAY_PREFIX = '/_bff/files/';

export const UPLOAD_FILE_NAME_HEADER = 'x-upload-file-name';

export interface UploadedFile {
  readonly fileId: string;
  readonly originalFileName: string;
  readonly contentType: MediaType;
  readonly byteSize: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly objectKey: string | null;
}

// ヘッダーの値に書けるのはASCIIだけのため、百分率符号化で渡す。孤立したサロゲートは符号化できないため置換文字にする
export const encodeFileNameHeader = (name: string): string =>
  encodeURIComponent(name.toWellFormed());

export const decodeFileNameHeader = (
  value: string | null,
): string | undefined => {
  if (value === null) {
    return undefined;
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
};

export const downloadPathOf = (fileId: string): string =>
  `${FILE_RELAY_PREFIX}${encodeURIComponent(fileId)}`;
