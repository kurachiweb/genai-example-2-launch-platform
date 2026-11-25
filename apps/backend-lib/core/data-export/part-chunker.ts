export interface PartChunker {
  push(chunk: Uint8Array): readonly Uint8Array[];
  flush(): Uint8Array | undefined;
}

// R2のマルチパートアップロードは最後以外の部分が同じ大きさでなければならないため、任意の大きさの断片をちょうどpartBytesの部分へ区切り直す
export function createPartChunker(partBytes: number): PartChunker {
  if (!Number.isSafeInteger(partBytes) || partBytes <= 0) {
    throw new RangeError('部分の大きさは正の整数でなければなりません');
  }

  let buffer: Uint8Array | undefined;
  let filled = 0;

  return {
    push(chunk) {
      const parts: Uint8Array[] = [];
      let offset = 0;
      while (offset < chunk.length) {
        buffer ??= new Uint8Array(partBytes);
        const copied = Math.min(partBytes - filled, chunk.length - offset);
        buffer.set(chunk.subarray(offset, offset + copied), filled);
        filled += copied;
        offset += copied;
        if (filled === partBytes) {
          // 満ちたバッファは呼び出し側へ渡し切り、次の部分には新しいバッファを使う
          parts.push(buffer);
          buffer = undefined;
          filled = 0;
        }
      }
      return parts;
    },

    flush() {
      if (buffer === undefined || filled === 0) {
        return undefined;
      }
      const last = buffer.slice(0, filled);
      buffer = undefined;
      filled = 0;
      return last;
    },
  };
}
