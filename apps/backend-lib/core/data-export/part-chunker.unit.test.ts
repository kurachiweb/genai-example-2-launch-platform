import { describe, expect, test } from 'bun:test';

import { ARCHIVE_PART_BYTES } from './archive-limits.ts';
import { createPartChunker } from './part-chunker.ts';

function bytesOf(length: number, seed = 0): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (index + seed) % 251);
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

describe('createPartChunker', () => {
  test.each([[0], [-1], [1.5], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    '部分の大きさが正の整数でない%sは拒否する',
    (partBytes) => {
      expect(() => createPartChunker(partBytes)).toThrow(RangeError);
    },
  );

  test('何も押し込まなければ最後の部分も無い', () => {
    const chunker = createPartChunker(4);

    expect(chunker.flush()).toBeUndefined();
  });

  test('部分の大きさに満たない断片は満ちた部分を返さず、最後の部分として取り出せる', () => {
    const chunker = createPartChunker(4);

    expect(chunker.push(bytesOf(3))).toEqual([]);
    expect(chunker.flush()).toEqual(bytesOf(3));
  });

  test('ちょうど部分の大きさの断片は1つの部分になり、空の最後の部分を返さない', () => {
    const chunker = createPartChunker(4);

    const parts = chunker.push(bytesOf(4));

    expect(parts).toEqual([bytesOf(4)]);
    expect(chunker.flush()).toBeUndefined();
  });

  test('部分の大きさを1バイト超えると、満ちた部分と1バイトの最後の部分に分かれる', () => {
    const chunker = createPartChunker(4);

    const parts = chunker.push(bytesOf(5));

    expect(parts).toEqual([bytesOf(5).subarray(0, 4)]);
    expect(chunker.flush()).toEqual(bytesOf(5).subarray(4));
  });

  test('10MiBの部分でも、ちょうどの断片は満ちた1部分、1バイト超えは1バイトの最後の部分を残す', () => {
    const exact = createPartChunker(ARCHIVE_PART_BYTES);
    const exactParts = exact.push(new Uint8Array(ARCHIVE_PART_BYTES));
    const over = createPartChunker(ARCHIVE_PART_BYTES);
    const overParts = over.push(new Uint8Array(ARCHIVE_PART_BYTES + 1));

    expect(exactParts.map((part) => part.length)).toEqual([ARCHIVE_PART_BYTES]);
    expect(exact.flush()).toBeUndefined();
    expect(overParts.map((part) => part.length)).toEqual([ARCHIVE_PART_BYTES]);
    expect(over.flush()?.length).toBe(1);
  });

  test('複数の部分をまたぐ断片では、最後以外の部分が全て同じ大きさになる', () => {
    const chunker = createPartChunker(4);

    const parts = chunker.push(bytesOf(10));
    const last = chunker.flush();

    expect(parts.map((part) => part.length)).toEqual([4, 4]);
    expect(last?.length).toBe(2);
    expect(concat([...parts, last as Uint8Array])).toEqual(bytesOf(10));
  });

  test('小さな断片を重ねて部分を満たし、順序とバイト列を保つ', () => {
    const chunker = createPartChunker(4);
    const emitted: Uint8Array[] = [];

    for (const [index, size] of [1, 2, 3, 1, 5, 4, 2].entries()) {
      emitted.push(...chunker.push(bytesOf(size, index * 7)));
    }
    const last = chunker.flush();
    if (last !== undefined) {
      emitted.push(last);
    }

    const expected = concat(
      [1, 2, 3, 1, 5, 4, 2].map((size, index) => bytesOf(size, index * 7)),
    );
    expect(emitted.slice(0, -1).every((part) => part.length === 4)).toBe(true);
    expect(emitted.at(-1)?.length).toBeLessThanOrEqual(4);
    expect(concat(emitted)).toEqual(expected);
  });

  test('空の断片は何も返さず、部分の境界も動かさない', () => {
    const chunker = createPartChunker(4);

    expect(chunker.push(new Uint8Array(0))).toEqual([]);
    expect(chunker.push(bytesOf(2))).toEqual([]);
    expect(chunker.push(new Uint8Array(0))).toEqual([]);
    expect(chunker.flush()).toEqual(bytesOf(2));
  });

  test('返した部分は内部のバッファを再利用せず、後の押し込みで書き換わらない', () => {
    const chunker = createPartChunker(4);
    const [first] = chunker.push(bytesOf(4, 10));
    const snapshot = Uint8Array.from(first as Uint8Array);

    chunker.push(bytesOf(4, 99));
    chunker.push(bytesOf(3, 50));

    expect(first).toEqual(snapshot);
  });

  test('押し込んだ断片を後から書き換えても、返した部分と最後の部分は変わらない', () => {
    const chunker = createPartChunker(4);
    const source = bytesOf(6);
    const [first] = chunker.push(source);
    source.fill(0);
    const last = chunker.flush();

    expect(first).toEqual(bytesOf(6).subarray(0, 4));
    expect(last).toEqual(bytesOf(6).subarray(4));
  });

  test('取り出した後は最初の状態に戻り、続けて使える', () => {
    const chunker = createPartChunker(4);
    chunker.push(bytesOf(3));
    chunker.flush();

    expect(chunker.push(bytesOf(4, 1))).toEqual([bytesOf(4, 1)]);
    expect(chunker.flush()).toBeUndefined();
  });

  test('1万件の小さな断片でも、最後以外の全ての部分が同じ大きさで総バイト数が一致する', () => {
    const partBytes = 1_000;
    const chunker = createPartChunker(partBytes);
    const parts: Uint8Array[] = [];

    for (let index = 0; index < 10_000; index += 1) {
      parts.push(...chunker.push(bytesOf(7, index)));
    }
    const last = chunker.flush();
    if (last !== undefined) {
      parts.push(last);
    }

    expect(parts.slice(0, -1).every((part) => part.length === partBytes)).toBe(
      true,
    );
    expect(parts.reduce((sum, part) => sum + part.length, 0)).toBe(70_000);
    expect(parts).toHaveLength(70);
  });
});
