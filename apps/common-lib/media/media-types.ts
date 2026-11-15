export type RasterImageMediaType =
  'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

export type ImageMediaType = RasterImageMediaType | 'image/svg+xml';

export type DocumentMediaType = 'application/pdf' | 'text/plain';

export type MediaType = ImageMediaType | DocumentMediaType;

export type FallbackFormat = 'jpg' | 'png' | 'svg';

export const IMAGE_MEDIA_TYPES: readonly ImageMediaType[] = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]);

export const ATTACHMENT_MEDIA_TYPES: readonly MediaType[] = Object.freeze([
  ...IMAGE_MEDIA_TYPES,
  'application/pdf',
  'text/plain',
]);

export const MEDIA_TYPE_LABELS: Readonly<Record<MediaType, string>> =
  Object.freeze({
    'image/jpeg': 'JPEG',
    'image/png': 'PNG',
    'image/gif': 'GIF',
    'image/webp': 'WebP',
    'image/svg+xml': 'SVG',
    'application/pdf': 'PDF',
    'text/plain': 'テキスト',
  });

// 画面に出す上限の表記(20MB)は1,024を基数とするため、その値ちょうどまで受け付ける
export const MAX_UPLOAD_BYTES = 20_971_520;

// 画像の変換の入力上限「20MB」は基数が明記されていないため、1,000を基数とする値を安全側の上限にする
export const IMAGE_STORAGE_MAX_BYTES = 20_000_000;

const KNOWN_MEDIA_TYPES: ReadonlySet<string> = new Set(ATTACHMENT_MEDIA_TYPES);

const IMAGE_MEDIA_TYPE_SET: ReadonlySet<MediaType> = new Set(IMAGE_MEDIA_TYPES);

const TEXT_MEDIA_TYPE = 'text/plain';

const CHARSET_PARAMETER_NAME = 'charset';

const UTF8_CHARSET = 'utf-8';

const QUOTE = '"';

const isKnownMediaType = (type: string): type is MediaType =>
  KNOWN_MEDIA_TYPES.has(type);

const unquote = (value: string): string | undefined => {
  if (!value.startsWith(QUOTE)) {
    return value;
  }
  return value.length >= 2 && value.endsWith(QUOTE)
    ? value.slice(1, -1)
    : undefined;
};

const isAcceptableTextParameter = (parameter: string): boolean => {
  const separatorIndex = parameter.indexOf('=');
  if (separatorIndex === -1) {
    return true;
  }
  const name = parameter.slice(0, separatorIndex).trim().toLowerCase();
  if (name !== CHARSET_PARAMETER_NAME) {
    return true;
  }
  return (
    unquote(parameter.slice(separatorIndex + 1).trim())?.toLowerCase() ===
    UTF8_CHARSET
  );
};

export const parseMediaType = (
  header: string | null,
): MediaType | undefined => {
  if (header === null) {
    return undefined;
  }
  const [essence = '', ...parameters] = header.split(';');
  const type = essence.trim().toLowerCase();
  if (!isKnownMediaType(type)) {
    return undefined;
  }
  // テキストは内容をUTF-8として検査するため、別の文字符号化の申告を受け付けない
  if (
    type === TEXT_MEDIA_TYPE &&
    !parameters.every(isAcceptableTextParameter)
  ) {
    return undefined;
  }
  return type;
};

export const isImageMediaType = (type: MediaType): type is ImageMediaType =>
  IMAGE_MEDIA_TYPE_SET.has(type);

export const fallbackFormatOf = (type: ImageMediaType): FallbackFormat => {
  switch (type) {
    case 'image/jpeg': {
      return 'jpg';
    }
    case 'image/svg+xml': {
      return 'svg';
    }
    default: {
      return 'png';
    }
  }
};
