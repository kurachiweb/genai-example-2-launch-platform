export type ExtraHeaders = Readonly<Record<string, string>>;

export type HeaderValidationFailureReason =
  'not-allowed' | 'invalid-value' | 'too-many' | 'too-large';

export type HeaderValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: HeaderValidationFailureReason };

export const ALLOWED_EXTRA_HEADERS = Object.freeze([
  'List-Unsubscribe',
  'List-Unsubscribe-Post',
  'List-Id',
  'Auto-Submitted',
  'Precedence',
] as const);

type AllowedExtraHeader = (typeof ALLOWED_EXTRA_HEADERS)[number];

export const MAX_EXTRA_HEADER_VALUE_BYTES = 2048;
export const MAX_EXTRA_HEADERS_TOTAL_BYTES = 16 * 1024;

const ONE_CLICK_UNSUBSCRIBE = 'List-Unsubscribe=One-Click';

// 送信プロバイダはヘッダー名を大文字小文字を区別せずに照合するため、同じ規則で許可リストを引く
const ALLOWED_BY_LOWER_NAME: ReadonlyMap<string, AllowedExtraHeader> = new Map(
  ALLOWED_EXTRA_HEADERS.map((name) => [name.toLowerCase(), name]),
);

const ANGLE_BRACKETED_URI_PATTERN = /^<([^<>\s]+)>$/u;
const LINE_BREAK_PATTERN = /[\r\n]/u;

const textEncoder = new TextEncoder();

const OK: HeaderValidation = Object.freeze({ ok: true });

function fail(reason: HeaderValidationFailureReason): HeaderValidation {
  return { ok: false, reason };
}

function isHttpsUri(uri: string): boolean {
  try {
    const url = new URL(uri);
    return url.protocol === 'https:' && url.hostname !== '';
  } catch {
    return false;
  }
}

// 「<URI>」をカンマで区切った並びのうち、HTTPSを1つ以上含み、HTTPSとmailto以外を含まないものだけを受け付ける
function isValidListUnsubscribe(value: string): boolean {
  let hasHttpsUri = false;
  for (const part of value.split(',')) {
    const uri = ANGLE_BRACKETED_URI_PATTERN.exec(part.trim())?.[1];
    if (uri === undefined) {
      return false;
    }
    if (isHttpsUri(uri)) {
      hasHttpsUri = true;
    } else if (!uri.toLowerCase().startsWith('mailto:')) {
      return false;
    }
  }
  return hasHttpsUri;
}

function isValidValue(name: AllowedExtraHeader, value: string): boolean {
  if (value.trim() === '' || LINE_BREAK_PATTERN.test(value)) {
    return false;
  }
  switch (name) {
    case 'List-Unsubscribe':
      return isValidListUnsubscribe(value);
    case 'List-Unsubscribe-Post':
      return value === ONE_CLICK_UNSUBSCRIBE;
    default:
      return true;
  }
}

export function validateExtraHeaders(headers: ExtraHeaders): HeaderValidation {
  const seen = new Set<AllowedExtraHeader>();
  let totalBytes = 0;
  for (const [rawName, value] of Object.entries(headers)) {
    const name = ALLOWED_BY_LOWER_NAME.get(rawName.toLowerCase());
    if (name === undefined) {
      return fail('not-allowed');
    }
    if (seen.has(name)) {
      return fail('too-many');
    }
    seen.add(name);
    if (!isValidValue(name, value)) {
      return fail('invalid-value');
    }
    const valueBytes = textEncoder.encode(value).byteLength;
    if (valueBytes > MAX_EXTRA_HEADER_VALUE_BYTES) {
      return fail('too-large');
    }
    // 送信プロバイダの数え方が文書に無いため、ヘッダー行として送る大きさ(名前+「: 」+値+改行)で多めに数える
    totalBytes += textEncoder.encode(rawName).byteLength + 2 + valueBytes + 2;
  }
  if (seen.has('List-Unsubscribe-Post') && !seen.has('List-Unsubscribe')) {
    return fail('invalid-value');
  }
  if (totalBytes > MAX_EXTRA_HEADERS_TOTAL_BYTES) {
    return fail('too-large');
  }
  return OK;
}
