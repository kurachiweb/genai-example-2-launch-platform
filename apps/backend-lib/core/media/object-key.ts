const OBJECT_KEY_BYTES = 16;

const toHex = (byte: number): string => byte.toString(16).padStart(2, '0');

export function generateObjectKey(
  randomBytes: (length: number) => Uint8Array,
): string {
  const bytes = randomBytes(OBJECT_KEY_BYTES);
  // 乱数源の不具合で短いキーを作ると推測できる空間が狭まるため、長さが違えば採番しない
  if (bytes.length !== OBJECT_KEY_BYTES) {
    throw new Error(
      `乱数源が${String(bytes.length)}バイトを返しました(期待は${String(OBJECT_KEY_BYTES)}バイト)`,
    );
  }
  return Array.from(bytes, toHex).join('');
}
