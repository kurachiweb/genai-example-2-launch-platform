import { invalidCursorError } from '../../../lib/core/errors/invalid-cursor.ts';
import {
  type BusinessDate,
  parseBusinessDate,
} from '../../../lib/core/time/business-time.ts';
import type { ProductListPosition } from './ports.ts';

const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const PRODUCT_ID_PATTERN = /^[0-9A-Z]{26}$/u;

const BASE64URL_OPTIONS = {
  alphabet: 'base64url',
  omitPadding: true,
} as const;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });

export function encodeMyProductsCursor(position: ProductListPosition): string {
  return textEncoder
    .encode(JSON.stringify({ d: position.latestLaunchDate, id: position.id }))
    .toBase64(BASE64URL_OPTIONS);
}

function decodeCursorText(cursor: string): string | undefined {
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.fromBase64(cursor, { alphabet: 'base64url' });
  } catch {
    return undefined;
  }
  // デコードは空白・パディング・末尾の余りのビットを許すため、再エンコードして同じ表記のものだけを受け付ける
  if (bytes.length === 0 || bytes.toBase64(BASE64URL_OPTIONS) !== cursor) {
    return undefined;
  }
  try {
    return textDecoder.decode(bytes);
  } catch {
    return undefined;
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function toBusinessDate(value: unknown): BusinessDate | undefined {
  if (typeof value !== 'string' || !BUSINESS_DATE_PATTERN.test(value)) {
    return undefined;
  }
  try {
    return parseBusinessDate(value);
  } catch {
    return undefined;
  }
}

function toPosition(value: unknown): ProductListPosition | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  if (Object.keys(value).toSorted().join(',') !== 'd,id') {
    return undefined;
  }
  const latestLaunchDate = toBusinessDate(Reflect.get(value, 'd'));
  const id: unknown = Reflect.get(value, 'id');
  if (
    latestLaunchDate === undefined ||
    typeof id !== 'string' ||
    !PRODUCT_ID_PATTERN.test(id)
  ) {
    return undefined;
  }
  return { latestLaunchDate, id };
}

export function decodeMyProductsCursor(cursor: string): ProductListPosition {
  const text = decodeCursorText(cursor);
  const position = text === undefined ? undefined : toPosition(parseJson(text));
  if (position === undefined) {
    throw invalidCursorError();
  }
  return position;
}
