import type { CommentThreadPageInput } from '../../../lib/core/engagement/ports.ts';
import { invalidCursorError } from '../../../lib/core/errors/invalid-cursor.ts';

export type CommentThreadPosition = NonNullable<
  CommentThreadPageInput['after']
>;

const COMMENT_ID_PATTERN = /^[0-9A-Z]{26}$/u;

const BASE64URL_OPTIONS = {
  alphabet: 'base64url',
  omitPadding: true,
} as const;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });

export function encodeCommentThreadCursor(
  position: CommentThreadPosition,
): string {
  return textEncoder
    .encode(
      JSON.stringify({
        createdAt: position.createdAt,
        commentId: position.commentId,
      }),
    )
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

function toPosition(value: unknown): CommentThreadPosition | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  if (Object.keys(value).toSorted().join(',') !== 'commentId,createdAt') {
    return undefined;
  }
  const createdAt: unknown = Reflect.get(value, 'createdAt');
  const commentId: unknown = Reflect.get(value, 'commentId');
  if (
    typeof createdAt !== 'number' ||
    !Number.isSafeInteger(createdAt) ||
    createdAt < 0 ||
    typeof commentId !== 'string' ||
    !COMMENT_ID_PATTERN.test(commentId)
  ) {
    return undefined;
  }
  return { createdAt, commentId };
}

export function decodeCommentThreadCursor(
  cursor: string,
): CommentThreadPosition {
  const text = decodeCursorText(cursor);
  const position = text === undefined ? undefined : toPosition(parseJson(text));
  if (position === undefined) {
    throw invalidCursorError();
  }
  return position;
}
