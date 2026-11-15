import { invalidCursorError } from '../../../lib/core/errors/invalid-cursor.ts';
import type { PaymentRecordCursor } from '../../../lib/core/payments/ports.ts';

const CURSOR_PATTERN = /^(\d{1,15}):([0-9A-Z]{26})$/u;

const BASE64URL_OPTIONS = {
  alphabet: 'base64url',
  omitPadding: true,
} as const;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });

export function encodePaymentHistoryCursor(
  position: PaymentRecordCursor,
): string {
  return textEncoder
    .encode(`${String(position.occurredAt.getTime())}:${position.id}`)
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
  if (bytes.toBase64(BASE64URL_OPTIONS) !== cursor) {
    return undefined;
  }
  try {
    return textDecoder.decode(bytes);
  } catch {
    return undefined;
  }
}

export function decodePaymentHistoryCursor(
  cursor: string,
): PaymentRecordCursor {
  const [, at, id] = CURSOR_PATTERN.exec(decodeCursorText(cursor) ?? '') ?? [];
  if (at === undefined || id === undefined) {
    throw invalidCursorError();
  }
  return { occurredAt: new Date(Number(at)), id };
}
