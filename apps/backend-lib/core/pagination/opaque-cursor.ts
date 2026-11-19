import type { z } from 'zod';

import { invalidCursorError } from '../errors/invalid-cursor.ts';

const BASE64URL_OPTIONS = {
  alphabet: 'base64url',
  omitPadding: true,
} as const;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });

export function encodeCursor(
  position: Readonly<Record<string, string | number>>,
): string {
  return textEncoder
    .encode(JSON.stringify(position))
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

export function decodeCursor<T>(schema: z.ZodType<T>, cursor: string): T {
  const text = decodeCursorText(cursor);
  if (text === undefined) {
    throw invalidCursorError();
  }
  const result = schema.safeParse(parseJson(text));
  if (!result.success) {
    throw invalidCursorError();
  }
  return result.data;
}
