import { invalidCursorError } from '../../../lib/core/errors/invalid-cursor.ts';
import {
  type BusinessDate,
  parseBusinessDate,
} from '../../../lib/core/time/business-time.ts';
import type { UpvoteHistoryPosition } from './ports.ts';

const CURSOR_PATTERN = /^(\d{4}-\d{2}-\d{2}):([0-9A-Z]{26})$/u;

const BASE64URL_OPTIONS = {
  alphabet: 'base64url',
  omitPadding: true,
} as const;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });

export function encodeUpvoteHistoryCursor(
  position: UpvoteHistoryPosition,
): string {
  return textEncoder
    .encode(`${position.matchDate}:${position.matchId}`)
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

function toBusinessDate(value: string): BusinessDate | undefined {
  try {
    return parseBusinessDate(value);
  } catch {
    return undefined;
  }
}

export function decodeUpvoteHistoryCursor(
  cursor: string,
): UpvoteHistoryPosition {
  const [, date, matchId] =
    CURSOR_PATTERN.exec(decodeCursorText(cursor) ?? '') ?? [];
  const matchDate = date === undefined ? undefined : toBusinessDate(date);
  if (matchDate === undefined || matchId === undefined) {
    throw invalidCursorError();
  }
  return { matchDate, matchId };
}
